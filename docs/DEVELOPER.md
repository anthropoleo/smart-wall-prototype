# Developer Guide

Technical reference for contributors working on firmware, backend, and UI.

## Overview

The project has three runtime components:

- ESP32-C3 firmware (`src/main.cpp`)
- FastAPI backend (`python-stuff/server.py`)
- Browser UI (`python-stuff/web/*`)

The backend is the bridge between UI and ESP32 transport.

## Architecture

- Firmware exposes the line protocol over:
  - USB serial (`115200`)
  - HTTP `GET /cmd?q=<COMMAND>` on the ESP32 LAN IP
- Backend exposes `/api/*` and forwards commands via:
  - `LedSerialController` (`python-stuff/ledwall/serial_controller.py`)
  - `LedWifiController` (`python-stuff/ledwall/wifi_controller.py`)
- UI calls backend APIs only (never talks directly to serial).

## Firmware Wi-Fi Mode (Station)

The ESP32 joins an existing 2.4 GHz Wi-Fi network.

- Credentials are loaded from `include/wifi_secrets.h`:
  - `#define WIFI_SSID "..."`
  - `#define WIFI_PASSWORD "..."`
- `include/wifi_secrets.h` is gitignored.
- Template file: `include/wifi_secrets.example.h`

When no credentials are present, firmware still runs serial protocol but HTTP stays disabled until Wi-Fi connects.

## Wi-Fi Secrets: Why And How

This is the part that protects your real Wi-Fi password from public GitHub.

### Why we do it this way

- `include/wifi_secrets.h` contains private data (your SSID/password).
- The repo is public, so private data must never be committed.
- `.gitignore` blocks that file from being tracked.
- `include/wifi_secrets.example.h` is safe to commit because it contains placeholders only.

### Setup steps (exact)

1. Copy the template:

```bash
cp include/wifi_secrets.example.h include/wifi_secrets.h
```

2. Edit `include/wifi_secrets.h`:

```c
#pragma once
#define WIFI_SSID "your-network-name"
#define WIFI_PASSWORD "your-password"
```

3. Build and upload:

```bash
pio run -t upload
```

4. Open serial monitor and check for:
- `Wi-Fi connected, IP: ...`
- `HTTP server started, IP: ...`

### What to do if it does not connect

- Confirm the network is 2.4 GHz.
- Confirm SSID/password are exact (case-sensitive).
- Confirm signal is strong enough near the wall.
- Reboot ESP32 and check serial logs again.

### Safety checks before pushing code

Run this and confirm no secrets file is staged:

```bash
git status --short
```

You should not see `include/wifi_secrets.h` in staged/committed files.

## Command Protocol

All commands are ASCII line commands and return one line beginning with `OK` or `ERR`.

- `PING`
- `INFO`
- `BRIGHT <0-255>`
- `FILL <r> <g> <b>`
- `SET <i> <r> <g> <b>`
- `SETN <i> <r> <g> <b>`
- `SHOW`
- `CLEAR`

## UI Grid Mapping

UI is a 5x7 logical grid (35 LEDs) using right-to-left vertical serpentine mapping.

- UI labels LEDs as 1-based
- API/firmware indices are 0-based physical strip order
- Mapping code: `python-stuff/web/app.js` (`gridToIndex`)

## Backend API Notes

Primary endpoints:

- `POST /api/connect`
  - Serial: `{"transport":"serial","port":"..."}`
  - Wi-Fi: `{"transport":"wifi","host":"<esp32-ip>"}`
- `GET /api/status`
- `POST /api/set`, `POST /api/fill`, `POST /api/clear`, `POST /api/brightness`
- Route APIs under `/api/routes/*`

Connection state is held in-process (`ctrl`, `transport`, `last_info`) in `server.py`.

## Local Development

### Firmware

```bash
cp include/wifi_secrets.example.h include/wifi_secrets.h
pio run -t upload
```

Optional serial monitor:

```bash
pio device monitor
```

### Backend + UI

```bash
cd python-stuff
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 -m uvicorn server:app --reload --port 8000
```

Open `http://127.0.0.1:8000/`.

## Repository Documentation Policy

- Keep `README.md` concise and user-facing.
- Keep deep technical contributor details in this file.
- Keep `AGENTS.md` for AI agent instructions, not primary human documentation.
