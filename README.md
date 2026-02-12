# LED Wall Controller

ESP32 + FastAPI + Web UI controller for a 35-LED climbing wall prototype.

## Current architecture

- **Firmware (`../src/main.cpp`)**
  - Drives a 5x7 wall (35 LEDs) with FastLED.
  - Accepts the same command protocol over:
    - USB serial (`115200`)
    - HTTP on ESP32 AP (`GET /cmd?q=<COMMAND>`)
- **Backend (`server.py`)**
  - Serves UI and forwards API requests to either serial or Wi‑Fi transport.
  - Transport drivers:
    - `ledwall/serial_controller.py`
    - `ledwall/wifi_controller.py`
- **Frontend (`web/`)**
  - 5x7 clickable grid with serpentine index mapping.
  - Transport selector: `Serial (USB)` or `Wi‑Fi (ESP32 AP)`.

## ESP32 AP defaults

- SSID: `LED-WALL-ESP32`
- Password: `climbsafe123` YES, I'M POSTING THE PASSWORD ON GITHUG, ARREST ME 
- Host IP: usually `192.168.4.1`

## Command protocol

All commands return one line starting with `OK` or `ERR`.

- `PING`
- `INFO`
- `BRIGHT <0-255>`
- `FILL <r> <g> <b>`
- `SET <i> <r> <g> <b>`
- `SETN <i> <r> <g> <b>`
- `SHOW`
- `CLEAR`

## Run locally

From `python-stuff/`:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 -m uvicorn server:app --reload --port 8000
```

Open: `http://127.0.0.1:8000/`

## Flash firmware

From repo root:

```bash
pio run -t upload
```

## Backend API highlights

- `GET /api/ports` list serial ports
- `POST /api/connect` connect transport
  - Serial: `{"transport":"serial","port":"/dev/cu.usbmodem..."}`
  - Wi‑Fi: `{"transport":"wifi","host":"192.168.4.1"}`
- `POST /api/disconnect`
- `GET /api/status`
- `GET/POST /api/color-order` (`rgb`, `grb`, `gbr`, etc.)
- `POST /api/brightness`, `POST /api/fill`, `POST /api/set`, `POST /api/frame`, `POST /api/clear`
