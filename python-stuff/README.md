# Python app (prototype)

This folder contains a small Python backend + web UI to control the ESP32 LED strip over serial.

## Firmware protocol (serial)

The ESP32 speaks a simple line-based protocol (115200 baud). Commands:

- `PING` → `OK`
- `INFO` → `OK NUM_LEDS <n> BRIGHT <0-255>`
- `BRIGHT <0-255>` → `OK`
- `FILL <r> <g> <b>` → `OK`
- `SET <i> <r> <g> <b>` → `OK` (sets + shows)
- `SETN <i> <r> <g> <b>` → `OK` (sets without show)
- `SHOW` → `OK`
- `CLEAR` → `OK`

## Quick start (web app)

1) Flash the ESP32 with PlatformIO (from repo root):

```sh
pio run -t upload
```

2) Set up Python deps:

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

3) Run the backend (from this folder):

```sh
python3 -m uvicorn server:app --reload --port 8000
```

4) Open the UI:

- Visit `http://127.0.0.1:8000/`
- Click **Refresh**, pick your serial port, then **Connect**

## CLI smoke test

From repo root:

```sh
python3 python-stuff/controller.py
```

