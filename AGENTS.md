# LED Controller (Smart Climbing Wall Prototype)

## Goal

Build a mini “smart wall” prototype: an ESP32 drives a 15‑LED addressable strip, and a Python app provides an API + UI to control individual LEDs (future: hold routes, animations, timed problems).

## Architecture

- **ESP32 firmware (PlatformIO / Arduino / FastLED)**: line-based serial command protocol.
- **Python backend (FastAPI)**: talks to the ESP32 over serial and exposes HTTP endpoints.
- **Web UI**: served by the backend; lets you click LEDs (1–15) and set colors/brightness.

## Key Files

- Firmware: `src/main.cpp`
- Python serial driver: `python-stuff/ledwall/serial_controller.py`
- API server: `python-stuff/server.py`
- Web UI: `python-stuff/web/index.html`, `python-stuff/web/app.js`, `python-stuff/web/style.css`

## Serial Protocol (ESP32)

All commands are ASCII lines at **115200 baud**. Responses are single lines starting with `OK` or `ERR`.

- `PING` → `OK`
- `INFO` → `OK NUM_LEDS <n> BRIGHT <0-255>`
- `BRIGHT <0-255>` → `OK`
- `FILL <r> <g> <b>` → `OK`
- `SET <i> <r> <g> <b>` → `OK` (sets and shows)
- `SETN <i> <r> <g> <b>` → `OK` (sets without show)
- `SHOW` → `OK`
- `CLEAR` → `OK`

## Dev Workflow

- Flash firmware: `pio run -t upload`
- Start backend/UI:
  - `cd python-stuff`
  - `python3 -m venv .venv && source .venv/bin/activate`
  - `pip install -r requirements.txt`
  - `python3 -m uvicorn server:app --reload --port 8000`
  - Open `http://127.0.0.1:8000/`

## UI Notes

- LEDs are displayed **vertically** (top to bottom) and labeled **1–15**.
- Clicking a LED sends `/api/set` with a 0-based index; the UI shows 1-based labels.

## Next Steps (Roadmap)

- Add “routes”: save named patterns (which holds/LEDs light up).
- Add timers / countdowns / difficulty presets.
- Add Wi‑Fi transport (ESP32 HTTP/WebSocket) to remove the serial tether for the prototype.

