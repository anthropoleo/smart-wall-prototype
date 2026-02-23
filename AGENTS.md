# LED Controller (Smart Climbing Wall Prototype)

## Goal

Build a mini climbing “smart wall”: an ESP32 drives a 35‑LED addressable wall (5x7), and a Python app provides an API + UI to control individual LEDs (future: hold routes, animations, timed problems).

## Architecture

- **ESP32 firmware (PlatformIO / Arduino / FastLED)**: line-based command protocol exposed on both USB serial and HTTP (`/cmd`) while running as an AP.
- **Python backend (FastAPI)**: talks to the ESP32 over serial or Wi‑Fi and exposes HTTP endpoints.
- **Web UI**: served by the backend with two routes:
  - Dashboard (`/`): route browsing/apply + wall preview
  - Admin (`/admin`): transport connection, manual LED control, and route editing

## Key Files

- Firmware: `src/main.cpp`
- Python serial driver: `python-stuff/ledwall/serial_controller.py`
- Python Wi‑Fi driver: `python-stuff/ledwall/wifi_controller.py`
- API server: `python-stuff/server.py`
- Web UI: `python-stuff/web/index.html`, `python-stuff/web/admin.html`, `python-stuff/web/app.js`, `python-stuff/web/style.css`

## Device Command Protocol (ESP32)

All commands are ASCII lines. Responses are single lines starting with `OK` or `ERR`.

- Serial transport: `115200` baud
- Wi‑Fi transport: `GET /cmd?q=<COMMAND>`

- `PING` → `OK`
- `INFO` → `OK NUM_LEDS <n> BRIGHT <0-255>`
- `BRIGHT <0-255>` → `OK`
- `FILL <r> <g> <b>` → `OK`
- `SET <i> <r> <g> <b>` → `OK` (sets and shows)
- `SETN <i> <r> <g> <b>` → `OK` (sets without show)
- `SHOW` → `OK`
- `CLEAR` → `OK`

## Wi‑Fi AP Defaults (Firmware)

- SSID: `LED-WALL-ESP32`
- Password: `climbsafe123`
- Host IP: `192.168.4.1` (default SoftAP IP)

## Dev Workflow

- Flash firmware: `pio run -t upload`
- Start backend/UI:
  - `cd python-stuff`
  - `python3 -m venv .venv && source .venv/bin/activate`
  - `pip install -r requirements.txt`
  - `python3 -m uvicorn server:app --reload --port 8000`
  - Open dashboard: `http://127.0.0.1:8000/`
  - Open admin controls: `http://127.0.0.1:8000/admin`
  - In admin UI, choose:
    - **Serial (USB)** + port, or
    - **Wi‑Fi (ESP32 AP)** + host `192.168.4.1`

## UI Notes

- LEDs are displayed as a **5x7 grid** (35 total) using a right-to-left vertical serpentine map.
- Dashboard (`/`) is read-only preview + route apply.
- Admin (`/admin`) allows manual LED clicks and route editing.
- Clicking an LED in admin sends `/api/set` with a 0-based physical index; UI labels are 1-based.

## Next Steps (Roadmap)

- Add freestyle mode where people create their own route with own colours. This doesn't need a "save" feature
- Add pin to access admin dashboard
