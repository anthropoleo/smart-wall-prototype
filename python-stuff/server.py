"""
FastAPI backend for the LED wall prototype.

Serves:
- A small static web UI under `/` (files in `python-stuff/web/`)
- JSON API endpoints under `/api/*` that translate browser actions into LED
  commands sent to the ESP32 (via serial or Wi-Fi transport)

This process runs on the host computer; it talks to the microcontroller over the
USB serial port or ESP32 AP over Wi-Fi.
"""

import os
import logging
import sys
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from serial.tools import list_ports

from ledwall import (
    LedSerialController,
    LedWifiController,
    SerialNotConnectedError,
    WifiNotConnectedError,
)


ROOT = Path(__file__).resolve().parent
WEB_DIR = ROOT / "web"
log = logging.getLogger("ledwall")

app = FastAPI(title="LED Wall Controller", version="0.1.0")
serial_ctrl = LedSerialController(port=os.getenv("LED_PORT"))
wifi_ctrl = LedWifiController(host=os.getenv("LED_WIFI_HOST"))
ctrl = serial_ctrl
transport: Literal["serial", "wifi"] = "serial"
last_info: dict | None = None
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


def _device_rgb(r: int, g: int, b: int) -> tuple[int, int, int]:
    channels = (int(r), int(g), int(b))
    i0, i1, i2 = CHANNEL_ORDERS[color_order]
    return channels[i0], channels[i1], channels[i2]


def _http_error(e: Exception, status_code: int = 400, hint: str | None = None) -> HTTPException:
    log.exception("Request failed: %s", e)
    detail: dict = {"type": e.__class__.__name__, "message": str(e)}
    if hint:
        detail["hint"] = hint
    return HTTPException(status_code=status_code, detail=detail)


@app.get("/")
def index():
    return FileResponse(WEB_DIR / "index.html")


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
            hint = "Connect Mac to ESP32 AP, then use host 192.168.4.1 and Connect."
        else:
            hint = "Click Refresh, pick the ESP32 serial port, then Connect."
        raise _http_error(e, status_code=400, hint=hint)


@app.post("/api/disconnect")
def disconnect():
    global ctrl, transport, last_info
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
    _require_connected()
    try:
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


@app.post("/api/brightness")
def set_brightness(req: BrightnessRequest):
    global last_info
    _require_connected()
    try:
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
    _require_connected()
    try:
        ctrl.clear()
        return {"ok": True}
    except Exception as e:
        raise _http_error(e, status_code=400)


@app.post("/api/fill")
def fill(req: FillRequest):
    _require_connected()
    try:
        r, g, b = _device_rgb(req.r, req.g, req.b)
        ctrl.fill(r, g, b)
        return {"ok": True}
    except Exception as e:
        raise _http_error(e, status_code=400)


@app.post("/api/set")
def set_pixel(req: SetRequest):
    _require_connected()
    try:
        r, g, b = _device_rgb(req.r, req.g, req.b)
        ctrl.set_pixel(req.index, r, g, b, show=True)
        return {"ok": True}
    except Exception as e:
        raise _http_error(e, status_code=400)


@app.post("/api/frame")
def set_frame(req: FrameRequest):
    _require_connected()
    try:
        colors: list[tuple[int, int, int]] = []
        for row in req.colors:
            if len(row) != 3:
                raise ValueError("Each color must be [r,g,b].")
            r, g, b = row
            colors.append(_device_rgb(r, g, b))
        ctrl.set_frame(colors)
        return {"ok": True}
    except Exception as e:
        raise _http_error(e, status_code=400)
