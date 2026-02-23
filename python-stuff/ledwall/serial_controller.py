"""
Serial transport + command wrapper for the ESP32 LED strip firmware.

This module:
- Finds a likely ESP32 serial port (or uses a user-provided one)
- Opens the port at 115200 baud
- Sends ASCII line commands (e.g. "SET 0 255 0 0") and waits for "OK"/"ERR"

It’s the single place that understands the serial protocol details; higher layers
(FastAPI, CLI tools) call these methods instead of dealing with raw bytes.
"""

import time
import threading
from dataclasses import dataclass

import serial
from serial.tools import list_ports
import sys


BAUD = 115200
_FRAME_FAST_FALLBACK_THRESHOLD = 16


class SerialNotConnectedError(RuntimeError):
    pass


@dataclass(frozen=True)
class DeviceInfo:
    num_leds: int | None = None
    brightness: int | None = None
    raw: str | None = None


def pick_port(preferred: str | None) -> str:
    ports = list(list_ports.comports())
    if not ports:
        raise RuntimeError("No serial ports found. Plug in the ESP32.")

    devices = [p.device for p in ports]

    def normalize(device: str) -> str:
        # On macOS, prefer /dev/cu.* for outbound connections. If a user selects
        # /dev/tty.* but the corresponding /dev/cu.* exists, transparently swap.
        if sys.platform == "darwin" and device.startswith("/dev/tty."):
            cu = "/dev/cu." + device[len("/dev/tty.") :]
            if cu in devices:
                return cu
        return device

    if preferred:
        preferred = normalize(preferred)
        for p in ports:
            if p.device.upper() == preferred.upper():
                return p.device
        available = ", ".join(p.device for p in ports)
        raise RuntimeError(f"Requested port {preferred} not found. Available: {available}")

    keywords = ("usb", "cp210", "ch340", "silicon", "esp")
    # Prefer /dev/cu.* entries on macOS to avoid /dev/tty.* call-in semantics.
    ordered = sorted(
        ports,
        key=lambda p: (
            0
            if (sys.platform == "darwin" and str(p.device).startswith("/dev/cu."))
            else 1
        ),
    )
    for p in ordered:
        desc = (p.description or "").lower()
        if any(k in desc for k in keywords):
            return normalize(p.device)
    return normalize(ordered[0].device)


class LedSerialController:
    """Thread-safe serial client for the firmware’s line-based protocol."""

    def __init__(self, port: str | None = None, baud: int = BAUD):
        self._preferred_port = port
        self._baud = baud
        self._ser: serial.Serial | None = None
        self._lock = threading.Lock()
        self._last_non_ok: str | None = None
        self._frame_cache: list[tuple[int, int, int]] | None = None
        self._supports_frame_cmd = True

    @property
    def port(self) -> str | None:
        return self._ser.port if self._ser else None

    def connect(self, port: str | None = None) -> str:
        chosen = pick_port(port or self._preferred_port)
        ser = serial.Serial(chosen, self._baud, timeout=0.3)

        # Avoid holding some boards in reset/boot.
        ser.dtr = False
        ser.rts = False
        time.sleep(0.1)

        # Opening serial often resets the MCU; give it time to boot.
        time.sleep(2.5)
        ser.reset_input_buffer()

        with self._lock:
            if self._ser:
                try:
                    self._ser.close()
                except Exception:
                    pass
            self._ser = ser
            self._frame_cache = None
            self._supports_frame_cmd = True

        # Best-effort handshake.
        self._wait_for_ready(timeout_s=2.0)
        try:
            self.ping()
        except Exception:
            pass
        return chosen

    def close(self) -> None:
        with self._lock:
            if not self._ser:
                return
            self._ser.close()
            self._ser = None
            self._frame_cache = None
            self._supports_frame_cmd = True

    def _require(self) -> serial.Serial:
        if not self._ser:
            raise SerialNotConnectedError("Not connected. Call connect() first.")
        return self._ser

    def _set_cached_pixel(self, index: int, r: int, g: int, b: int) -> None:
        if self._frame_cache is None:
            return
        if index < 0 or index >= len(self._frame_cache):
            self._frame_cache = None
            return
        self._frame_cache[index] = (int(r), int(g), int(b))

    def _wait_for_ready(self, timeout_s: float) -> bool:
        ser = self._ser
        if not ser:
            return False
        t0 = time.time()
        while time.time() - t0 < timeout_s:
            line = ser.readline().decode("utf-8", errors="replace").strip()
            if not line:
                continue
            if line == "READY":
                return True
        return False

    def send(self, cmd: str, timeout_s: float = 6.0) -> str:
        cmd = cmd.strip()
        with self._lock:
            ser = self._require()
            # Drop boot noise / partial lines before sending.
            try:
                ser.reset_input_buffer()
            except Exception:
                pass
            ser.write((cmd + "\r\n").encode("utf-8"))
            ser.flush()

            t0 = time.time()
            saw_any = False
            last_line = None
            while time.time() - t0 < timeout_s:
                resp = ser.readline().decode("utf-8", errors="replace").strip()
                if not resp:
                    continue
                saw_any = True
                last_line = resp
                if not (resp.startswith("OK") or resp.startswith("ERR")):
                    self._last_non_ok = resp
                if resp.startswith("OK") or resp.startswith("ERR"):
                    return resp

            raw_tail = b""
            try:
                n = ser.in_waiting
                if n:
                    raw_tail = ser.read(n)
            except Exception:
                pass

            detail = []
            if saw_any and last_line:
                detail.append(f"last_line={last_line!r}")
            if self._last_non_ok:
                detail.append(f"last_non_ok={self._last_non_ok!r}")
            if raw_tail:
                detail.append(f"raw_tail={raw_tail!r}")
            extra = (" (" + ", ".join(detail) + ")") if detail else ""
            raise TimeoutError(f"No OK/ERR response for {cmd!r}{extra}")

    def _frame_hex(self, colors: list[tuple[int, int, int]]) -> str:
        return "".join(f"{r:02X}{g:02X}{b:02X}" for (r, g, b) in colors)

    def ping(self) -> None:
        resp = self.send("PING")
        if not resp.startswith("OK"):
            raise RuntimeError(resp)

    def info(self) -> DeviceInfo:
        resp = self.send("INFO")
        info = DeviceInfo(raw=resp)
        if not resp.startswith("OK"):
            return info

        # OK NUM_LEDS 15 BRIGHT 32
        parts = resp.split()
        try:
            for i, tok in enumerate(parts):
                if tok == "NUM_LEDS" and i + 1 < len(parts):
                    info = DeviceInfo(
                        num_leds=int(parts[i + 1]),
                        brightness=info.brightness,
                        raw=resp,
                    )
                if tok == "BRIGHT" and i + 1 < len(parts):
                    info = DeviceInfo(
                        num_leds=info.num_leds,
                        brightness=int(parts[i + 1]),
                        raw=resp,
                    )
        except Exception:
            return DeviceInfo(raw=resp)
        return info

    def brightness(self, value: int) -> None:
        resp = self.send(f"BRIGHT {int(value)}")
        if not resp.startswith("OK"):
            raise RuntimeError(resp)

    def clear(self) -> None:
        resp = self.send("CLEAR")
        if not resp.startswith("OK"):
            raise RuntimeError(resp)
        if self._frame_cache is not None:
            self._frame_cache = [(0, 0, 0) for _ in self._frame_cache]

    def fill(self, r: int, g: int, b: int) -> None:
        resp = self.send(f"FILL {int(r)} {int(g)} {int(b)}")
        if not resp.startswith("OK"):
            raise RuntimeError(resp)
        if self._frame_cache is not None:
            color = (int(r), int(g), int(b))
            self._frame_cache = [color for _ in self._frame_cache]

    def set_pixel(self, index: int, r: int, g: int, b: int, show: bool = True) -> None:
        cmd = "SET" if show else "SETN"
        resp = self.send(f"{cmd} {int(index)} {int(r)} {int(g)} {int(b)}")
        if not resp.startswith("OK"):
            raise RuntimeError(resp)
        self._set_cached_pixel(index, r, g, b)

    def show(self) -> None:
        resp = self.send("SHOW")
        if not resp.startswith("OK"):
            raise RuntimeError(resp)

    def set_frame(self, colors: list[tuple[int, int, int]]) -> None:
        desired = [(int(r), int(g), int(b)) for (r, g, b) in colors]
        if self._frame_cache is not None and len(self._frame_cache) == len(desired):
            changed_indices = [i for i, color in enumerate(desired) if self._frame_cache[i] != color]
        else:
            changed_indices = list(range(len(desired)))

        if not changed_indices:
            return

        if self._supports_frame_cmd and len(changed_indices) >= _FRAME_FAST_FALLBACK_THRESHOLD:
            try:
                resp = self.send(f"FRAME {self._frame_hex(desired)}", timeout_s=8.0)
                if not resp.startswith("OK"):
                    raise RuntimeError(resp)
                self._frame_cache = list(desired)
                return
            except Exception:
                # Older firmware may not support FRAME; permanently fall back after first failure.
                self._supports_frame_cmd = False

        try:
            for i in changed_indices:
                r, g, b = desired[i]
                self.set_pixel(i, r, g, b, show=False)
            self.show()
        except Exception:
            self._frame_cache = None
            raise

        self._frame_cache = list(desired)
