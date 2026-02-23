"""
Wi-Fi transport + command wrapper for the ESP32 LED strip firmware.

Uses the same line-based command protocol as serial transport, but sends
commands to the ESP32 over HTTP (`/cmd?q=<COMMAND>`).
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.parse import quote_plus
from urllib.request import urlopen


class WifiNotConnectedError(RuntimeError):
    pass


@dataclass(frozen=True)
class DeviceInfo:
    num_leds: int | None = None
    brightness: int | None = None
    raw: str | None = None


class LedWifiController:
    """Thread-safe Wi-Fi client for the firmware's line-based protocol."""

    def __init__(
        self,
        host: str | None = None,
        timeout_s: float = 3.5,
        retries: int = 1,
        retry_delay_s: float = 0.05,
    ):
        self._host = (host or "").strip()
        self._timeout_s = timeout_s
        self._retries = max(0, int(retries))
        self._retry_delay_s = max(0.0, float(retry_delay_s))
        self._lock = threading.Lock()

    @property
    def port(self) -> str | None:
        return self._host or None

    def connect(self, host: str | None = None) -> str:
        chosen = (host or self._host).strip()
        if not chosen:
            raise RuntimeError("No Wi-Fi host provided.")

        prev = self._host
        self._host = chosen
        try:
            self.ping()
        except Exception:
            self._host = prev
            raise
        return chosen

    def close(self) -> None:
        self._host = ""

    def _require(self) -> str:
        if not self._host:
            raise WifiNotConnectedError("Not connected. Call connect() first.")
        return self._host

    def _url(self, cmd: str) -> str:
        host = self._require()
        return f"http://{host}/cmd?q={quote_plus(cmd.strip())}"

    def send(self, cmd: str) -> str:
        cmd = cmd.strip()
        url = self._url(cmd)
        attempts = self._retries + 1
        last_error: Exception | None = None

        with self._lock:
            for attempt in range(attempts):
                try:
                    with urlopen(url, timeout=self._timeout_s) as response:
                        payload = response.read().decode("utf-8", errors="replace").strip()
                    if not payload:
                        raise RuntimeError(f"Empty response for {cmd!r}")
                    return payload
                except HTTPError as e:
                    payload = e.read().decode("utf-8", errors="replace").strip()
                    if payload:
                        return payload
                    raise RuntimeError(f"HTTP {e.code} for {cmd!r}") from e
                except URLError as e:
                    reason = getattr(e, "reason", e)
                    last_error = RuntimeError(f"Failed to reach ESP32 at {self._host}: {reason}")
                except TimeoutError:
                    last_error = RuntimeError(f"Timed out waiting for ESP32 response to {cmd!r}")

                if attempt + 1 < attempts:
                    time.sleep(self._retry_delay_s)

        if last_error is not None:
            raise last_error
        raise RuntimeError(f"Failed to send command {cmd!r}")

    def ping(self) -> None:
        resp = self.send("PING")
        if not resp.startswith("OK"):
            raise RuntimeError(resp)

    def info(self) -> DeviceInfo:
        resp = self.send("INFO")
        info = DeviceInfo(raw=resp)
        if not resp.startswith("OK"):
            return info

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

    def fill(self, r: int, g: int, b: int) -> None:
        resp = self.send(f"FILL {int(r)} {int(g)} {int(b)}")
        if not resp.startswith("OK"):
            raise RuntimeError(resp)

    def set_pixel(self, index: int, r: int, g: int, b: int, show: bool = True) -> None:
        cmd = "SET" if show else "SETN"
        resp = self.send(f"{cmd} {int(index)} {int(r)} {int(g)} {int(b)}")
        if not resp.startswith("OK"):
            raise RuntimeError(resp)

    def show(self) -> None:
        resp = self.send("SHOW")
        if not resp.startswith("OK"):
            raise RuntimeError(resp)

    def set_frame(self, colors: list[tuple[int, int, int]]) -> None:
        for i, (r, g, b) in enumerate(colors):
            self.set_pixel(i, r, g, b, show=False)
        self.show()
