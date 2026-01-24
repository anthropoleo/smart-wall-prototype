import os
import logging
import sys
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from serial.tools import list_ports

from ledwall import LedSerialController, SerialNotConnectedError


ROOT = Path(__file__).resolve().parent
WEB_DIR = ROOT / "web"
log = logging.getLogger("ledwall")

app = FastAPI(title="LED Wall Controller", version="0.1.0")
ctrl = LedSerialController(port=os.getenv("LED_PORT"))
last_info: dict | None = None

app.mount("/static", StaticFiles(directory=str(WEB_DIR)), name="static")


class ConnectRequest(BaseModel):
    port: str | None = None


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
    global last_info
    try:
        port = ctrl.connect(req.port)
        warning = None
        try:
            info = ctrl.info()
            last_info = info.__dict__
        except Exception as e:
            # Don’t fail connect if INFO isn’t supported or serial is flaky yet.
            last_info = None
            warning = f"Connected, but INFO failed: {e.__class__.__name__}: {e}"
        return {"ok": True, "port": port, "info": last_info, "warning": warning}
    except Exception as e:
        hint = "Click Refresh, pick the ESP32 serial port, then Connect."
        raise _http_error(e, status_code=400, hint=hint)


@app.post("/api/disconnect")
def disconnect():
    global last_info
    ctrl.close()
    last_info = None
    return {"ok": True}


@app.get("/api/status")
def status():
    return {"connected": ctrl.port is not None, "port": ctrl.port, "info": last_info}


@app.get("/api/info")
def info():
    global last_info
    _require_connected()
    try:
        last_info = ctrl.info().__dict__
        return {"ok": True, "info": last_info}
    except Exception as e:
        raise _http_error(e, status_code=400)


def _require_connected():
    if not ctrl.port:
        raise HTTPException(status_code=409, detail="Not connected. POST /api/connect first.")


@app.post("/api/brightness")
def set_brightness(req: BrightnessRequest):
    _require_connected()
    try:
        ctrl.brightness(req.value)
        return {"ok": True}
    except SerialNotConnectedError as e:
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
        ctrl.fill(req.r, req.g, req.b)
        return {"ok": True}
    except Exception as e:
        raise _http_error(e, status_code=400)


@app.post("/api/set")
def set_pixel(req: SetRequest):
    _require_connected()
    try:
        ctrl.set_pixel(req.index, req.r, req.g, req.b, show=True)
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
            colors.append((int(r), int(g), int(b)))
        ctrl.set_frame(colors)
        return {"ok": True}
    except Exception as e:
        raise _http_error(e, status_code=400)
