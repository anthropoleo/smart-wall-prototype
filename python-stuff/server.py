"""
FastAPI backend for the LED wall prototype.

Serves:
- A dashboard UI under `/`, admin UI under `/admin`, and freestyle UI under
  `/freestyle`
  (files in `python-stuff/web/`)
- JSON API endpoints under `/api/*` that translate browser actions into LED
  commands sent to the ESP32 (via serial or Wi-Fi transport)

This process runs on the host computer; it talks to the microcontroller over the
USB serial port or LAN Wi-Fi.
"""

import os
import logging
import secrets
import sys
import threading
import time
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from serial.tools import list_ports

from ledwall import (
    LedSerialController,
    LedWifiController,
    SerialNotConnectedError,
    WifiNotConnectedError,
)
from ledwall.routes_store import RouteStore


ROOT = Path(__file__).resolve().parent
WEB_DIR = ROOT / "web"


def _load_local_env_file():
    env_file = ROOT / ".env"
    if not env_file.exists():
        return
    try:
        for raw in env_file.read_text().splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip()
            if (
                (value.startswith('"') and value.endswith('"'))
                or (value.startswith("'") and value.endswith("'"))
            ) and len(value) >= 2:
                value = value[1:-1]
            if key:
                os.environ.setdefault(key, value)
    except Exception as e:
        log = logging.getLogger("ledwall")
        log.warning("Failed to parse %s: %s", env_file, e)


_load_local_env_file()

routes_path = Path(os.getenv("LED_ROUTES_FILE", str(ROOT / "data" / "routes.json"))).expanduser()
if not routes_path.is_absolute():
    routes_path = (ROOT / routes_path).resolve()

log = logging.getLogger("ledwall")

app = FastAPI(title="LED Wall Controller", version="0.1.0")
serial_ctrl = LedSerialController(port=os.getenv("LED_PORT"))
wifi_ctrl = LedWifiController(host=os.getenv("LED_WIFI_HOST"))
route_store = RouteStore(path=routes_path, num_leds=35)
admin_pin = os.getenv("LED_ADMIN_PIN", os.getenv("LED_ROUTE_EDITOR_PIN", "2468"))
try:
    admin_token_ttl_seconds = max(300, int(os.getenv("LED_ADMIN_SESSION_TTL_SECONDS", "43200")))
except ValueError:
    admin_token_ttl_seconds = 43200
admin_tokens: dict[str, float] = {}
admin_tokens_lock = threading.Lock()
ctrl = serial_ctrl
transport: Literal["serial", "wifi"] = "serial"
last_info: dict | None = None
device_lock = threading.Lock()
CHANNEL_ORDERS: dict[str, tuple[int, int, int]] = {
    "rgb": (0, 1, 2),
    "rbg": (0, 2, 1),
    "grb": (1, 0, 2),
    "gbr": (1, 2, 0),
    "brg": (2, 0, 1),
    "bgr": (2, 1, 0),
}
color_order = os.getenv("LED_COLOR_ORDER", "brg").lower()
if color_order not in CHANNEL_ORDERS:
    color_order = "brg"

app.mount("/static", StaticFiles(directory=str(WEB_DIR)), name="static")


@app.middleware("http")
async def static_no_cache(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


class ConnectRequest(BaseModel):
    transport: Literal["serial", "wifi"] = "serial"
    port: str | None = None
    host: str | None = None


class BrightnessRequest(BaseModel):
    value: int = Field(ge=0, le=255)


class FillRequest(BaseModel):
    r: int = Field(ge=0, le=255)
    g: int = Field(ge=0, le=255)
    b: int = Field(ge=0, le=255)


class SetRequest(FillRequest):
    index: int = Field(ge=0)


class FrameRequest(BaseModel):
    colors: list[list[int]] = Field(
        description="List of [r,g,b] rows (length should match NUM_LEDS)."
    )


class ColorOrderRequest(BaseModel):
    order: Literal["rgb", "rbg", "grb", "gbr", "brg", "bgr"]


class SaveRouteRequest(BaseModel):
    name: str = Field(min_length=1, max_length=48)
    frame: list[list[int]] = Field(
        description="List of [r,g,b] rows (length must match the route LED count)."
    )


class AdminUnlockRequest(BaseModel):
    pin: str = Field(min_length=1, max_length=64)


def _device_rgb(r: int, g: int, b: int) -> tuple[int, int, int]:
    channels = (int(r), int(g), int(b))
    i0, i1, i2 = CHANNEL_ORDERS[color_order]
    return channels[i0], channels[i1], channels[i2]


def _device_frame(frame: list[list[int]]) -> list[tuple[int, int, int]]:
    colors: list[tuple[int, int, int]] = []
    for row in frame:
        if len(row) != 3:
            raise ValueError("Each color must be [r,g,b].")
        r, g, b = row
        colors.append(_device_rgb(r, g, b))
    return colors


def _http_error(e: Exception, status_code: int = 400, hint: str | None = None) -> HTTPException:
    log.exception("Request failed: %s", e)
    detail: dict = {"type": e.__class__.__name__, "message": str(e)}
    if hint:
        detail["hint"] = hint
    return HTTPException(status_code=status_code, detail=detail)


@app.get("/")
def dashboard():
    return FileResponse(WEB_DIR / "index.html")


@app.get("/admin")
def admin(request: Request):
    cache_headers = {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "Pragma": "no-cache",
        "Expires": "0",
    }
    if admin_pin and not _has_admin_token(request.query_params.get("token", "")):
        return FileResponse(WEB_DIR / "admin-lock.html", headers=cache_headers)
    return FileResponse(WEB_DIR / "admin.html", headers=cache_headers)


@app.get("/freestyle")
def freestyle():
    return FileResponse(WEB_DIR / "freestyle.html")


@app.get("/api/admin/session")
def admin_session(request: Request):
    return {"ok": True, "pin_required": bool(admin_pin), "unlocked": _has_admin_token(_request_admin_token(request))}


@app.post("/api/admin/unlock")
def admin_unlock(req: AdminUnlockRequest):
    if not admin_pin:
        return {"ok": True, "pin_required": False, "unlocked": True, "token": None}
    if req.pin != admin_pin:
        raise HTTPException(status_code=403, detail="Invalid admin PIN.")

    token = _create_admin_token()
    return JSONResponse(
        {
            "ok": True,
            "pin_required": True,
            "unlocked": True,
            "token": token,
            "expires_in": admin_token_ttl_seconds,
        }
    )


@app.post("/api/admin/logout")
def admin_logout(request: Request):
    token = _request_admin_token(request)
    if token:
        with admin_tokens_lock:
            admin_tokens.pop(token, None)
    return {"ok": True}


@app.get("/api/ports")
def ports():
    ports = list(list_ports.comports())
    devices = [p.device for p in ports]

    def normalize(device: str) -> str:
        if sys.platform == "darwin" and device.startswith("/dev/tty."):
            cu = "/dev/cu." + device[len("/dev/tty.") :]
            if cu in devices:
                return cu
        return device

    seen = set()
    out = []
    for p in ports:
        dev = normalize(p.device)
        if dev in seen:
            continue
        seen.add(dev)
        out.append({"device": dev, "description": p.description or "", "hwid": p.hwid or ""})

    out.sort(
        key=lambda x: (0 if (sys.platform == "darwin" and x["device"].startswith("/dev/cu.")) else 1, x["device"])
    )
    return out


@app.post("/api/connect")
def connect(req: ConnectRequest):
    global ctrl, transport, last_info
    try:
        with device_lock:
            target = req.transport
            target_ctrl = wifi_ctrl if target == "wifi" else serial_ctrl
            if target == "wifi":
                if not req.host:
                    raise ValueError("host is required for wifi transport")
                serial_ctrl.close()
                endpoint = target_ctrl.connect(req.host)
            else:
                wifi_ctrl.close()
                endpoint = target_ctrl.connect(req.port)

            ctrl = target_ctrl
            transport = target

            warning = None
            try:
                info = ctrl.info()
                last_info = info.__dict__
            except Exception as e:
                # Don’t fail connect if INFO isn’t supported or serial is flaky yet.
                last_info = None
                warning = f"Connected, but INFO failed: {e.__class__.__name__}: {e}"
        return {
            "ok": True,
            "transport": transport,
            "endpoint": endpoint,
            "info": last_info,
            "warning": warning,
        }
    except Exception as e:
        if req.transport == "wifi":
            hint = "Use the ESP32's LAN IP on the same Wi-Fi network as this server (for example 192.168.1.120)."
        else:
            hint = "Click Refresh, pick the ESP32 serial port, then Connect."
        raise _http_error(e, status_code=400, hint=hint)


@app.post("/api/disconnect")
def disconnect():
    global ctrl, transport, last_info
    with device_lock:
        serial_ctrl.close()
        wifi_ctrl.close()
        ctrl = serial_ctrl
        transport = "serial"
        last_info = None
    return {"ok": True}


@app.get("/api/status")
def status():
    return {
        "connected": ctrl.port is not None,
        "transport": transport,
        "endpoint": ctrl.port,
        "info": last_info,
    }


@app.get("/api/info")
def info():
    global last_info
    try:
        with device_lock:
            _require_connected()
            last_info = ctrl.info().__dict__
        return {"ok": True, "info": last_info}
    except Exception as e:
        raise _http_error(e, status_code=400)


@app.get("/api/color-order")
def get_color_order():
    return {"ok": True, "order": color_order}


@app.post("/api/color-order")
def set_color_order(req: ColorOrderRequest):
    global color_order
    color_order = req.order
    return {"ok": True, "order": color_order}


def _require_connected():
    if not ctrl.port:
        raise HTTPException(status_code=409, detail="Not connected. POST /api/connect first.")


def _purge_expired_admin_tokens(now: float):
    expired_tokens = [token for token, expiry in admin_tokens.items() if expiry <= now]
    for token in expired_tokens:
        admin_tokens.pop(token, None)


def _create_admin_token() -> str:
    token = secrets.token_urlsafe(32)
    now = time.time()
    expires_at = now + admin_token_ttl_seconds
    with admin_tokens_lock:
        _purge_expired_admin_tokens(now)
        admin_tokens[token] = expires_at
    return token


def _has_admin_token(token: str) -> bool:
    if not token:
        return False
    now = time.time()
    with admin_tokens_lock:
        _purge_expired_admin_tokens(now)
        expiry = admin_tokens.get(token)
        return bool(expiry and expiry > now)


def _request_admin_token(request: Request) -> str:
    token = request.headers.get("X-Admin-Token", "").strip()
    if token:
        return token
    return request.query_params.get("token", "").strip()


def _require_admin_session(request: Request):
    if admin_pin and not _has_admin_token(_request_admin_token(request)):
        raise HTTPException(status_code=403, detail="Admin PIN required.")


@app.get("/api/routes")
def list_routes():
    return {"ok": True, **route_store.catalog()}


@app.get("/api/routes/{level}/{slot}")
def get_route(level: int, slot: int):
    try:
        route = route_store.get_route(level=level, slot=slot)
        return {"ok": True, "route": route}
    except Exception as e:
        raise _http_error(e, status_code=400)


@app.post("/api/routes/{level}/{slot}/apply")
def apply_route(level: int, slot: int):
    try:
        route = route_store.get_route(level=level, slot=slot)
        with device_lock:
            _require_connected()
            ctrl.set_frame(_device_frame(route["frame"]))
        return {"ok": True, "route": route}
    except Exception as e:
        raise _http_error(e, status_code=400)


@app.put("/api/routes/{level}/{slot}")
def save_route(level: int, slot: int, req: SaveRouteRequest, request: Request):
    try:
        _require_admin_session(request)
        route = route_store.save_route(level=level, slot=slot, name=req.name, frame=req.frame)
        return {"ok": True, "route": route}
    except HTTPException:
        raise
    except Exception as e:
        raise _http_error(e, status_code=400)


@app.post("/api/brightness")
def set_brightness(req: BrightnessRequest):
    global last_info
    try:
        with device_lock:
            _require_connected()
            ctrl.brightness(req.value)
            if isinstance(last_info, dict):
                last_info["brightness"] = int(req.value)
            else:
                last_info = {"brightness": int(req.value)}
        return {"ok": True, "info": last_info}
    except SerialNotConnectedError as e:
        raise _http_error(e, status_code=409)
    except WifiNotConnectedError as e:
        raise _http_error(e, status_code=409)
    except Exception as e:
        raise _http_error(e, status_code=400)


@app.post("/api/clear")
def clear():
    try:
        with device_lock:
            _require_connected()
            ctrl.clear()
        return {"ok": True}
    except Exception as e:
        raise _http_error(e, status_code=400)


@app.post("/api/fill")
def fill(req: FillRequest):
    try:
        r, g, b = _device_rgb(req.r, req.g, req.b)
        with device_lock:
            _require_connected()
            ctrl.fill(r, g, b)
        return {"ok": True}
    except Exception as e:
        raise _http_error(e, status_code=400)


@app.post("/api/set")
def set_pixel(req: SetRequest):
    try:
        r, g, b = _device_rgb(req.r, req.g, req.b)
        with device_lock:
            _require_connected()
            ctrl.set_pixel(req.index, r, g, b, show=True)
        return {"ok": True}
    except Exception as e:
        raise _http_error(e, status_code=400)


@app.post("/api/frame")
def set_frame(req: FrameRequest):
    try:
        with device_lock:
            _require_connected()
            ctrl.set_frame(_device_frame(req.colors))
        return {"ok": True}
    except Exception as e:
        raise _http_error(e, status_code=400)
