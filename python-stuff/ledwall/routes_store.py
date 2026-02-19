"""
Route persistence for the LED wall.

Routes are grouped by difficulty level. Each level has fixed slots to keep the UI
simple for setters while still allowing route replacement over time.
"""

from __future__ import annotations

import json
import threading
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROUTE_LEVELS = (4, 5, 6, 7)
ROUTES_PER_LEVEL = 3

DEFAULT_ROUTE_BLUEPRINTS: dict[int, list[dict[str, Any]]] = {
    4: [
        {"name": "Everest", "indices": [4, 9, 13, 18, 22, 27, 31], "color": [255, 255, 255]},
        {"name": "The Mountain", "indices": [0, 6, 7, 14, 19, 20, 26, 32], "color": [255, 255, 255]},
        {"name": "Valley Run", "indices": [3, 8, 12, 16, 21, 25, 30, 34], "color": [255, 255, 255]},
    ],
    5: [
        {"name": "Sky Ladder", "indices": [1, 2, 8, 9, 15, 16, 23, 24, 29], "color": [17, 189, 233]},
        {"name": "Granite Line", "indices": [5, 10, 11, 17, 18, 24, 25, 30], "color": [17, 189, 233]},
        {"name": "North Face", "indices": [2, 7, 13, 14, 20, 21, 27, 28, 33], "color": [17, 189, 233]},
    ],
    6: [
        {"name": "Crux Corner", "indices": [0, 1, 7, 8, 14, 15, 21, 22, 28, 29], "color": [243, 24, 146]},
        {"name": "Overhang Pulse", "indices": [4, 5, 11, 12, 18, 19, 25, 26, 32, 33], "color": [243, 24, 146]},
        {"name": "Iron Traverse", "indices": [3, 4, 9, 10, 16, 17, 23, 24, 30, 31], "color": [243, 24, 146]},
    ],
    7: [
        {"name": "Apex Trial", "indices": [0, 6, 12, 18, 24, 30, 34], "color": [255, 167, 38]},
        {"name": "Redpoint Prime", "indices": [2, 3, 9, 10, 16, 17, 23, 24, 31], "color": [255, 167, 38]},
        {"name": "Final Move", "indices": [1, 5, 8, 13, 15, 20, 22, 27, 29, 33], "color": [255, 167, 38]},
    ],
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _frame_from_points(num_leds: int, points: list[dict[str, Any]]) -> list[list[int]]:
    frame = [[0, 0, 0] for _ in range(num_leds)]
    for point in points:
        idx = int(point["index"])
        color = point["color"]
        frame[idx] = [int(color[0]), int(color[1]), int(color[2])]
    return frame


def _points_from_indices(indices: list[int], color: list[int], num_leds: int) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen = set()
    for idx in indices:
        i = int(idx)
        if i < 0 or i >= num_leds or i in seen:
            continue
        seen.add(i)
        out.append({"index": i, "color": [int(color[0]), int(color[1]), int(color[2])]})
    return out


class RouteStore:
    """JSON-backed route repository with strict shape normalization."""

    def __init__(self, path: Path, num_leds: int = 35):
        if num_leds <= 0:
            raise ValueError("num_leds must be > 0.")
        self._path = path
        self._num_leds = int(num_leds)
        self._lock = threading.Lock()
        self._data = self._load_or_create()

    @property
    def num_leds(self) -> int:
        return self._num_leds

    @property
    def path(self) -> Path:
        return self._path

    def catalog(self) -> dict[str, Any]:
        with self._lock:
            levels: list[dict[str, Any]] = []
            for level in ROUTE_LEVELS:
                routes = [
                    {"slot": route["slot"], "name": route["name"]}
                    for route in self._data["levels"][str(level)]
                ]
                levels.append({"level": level, "routes": routes})
            return {
                "num_leds": self._num_leds,
                "updated_at": self._data.get("updated_at"),
                "levels": levels,
            }

    def get_route(self, level: int, slot: int) -> dict[str, Any]:
        self._validate_level_slot(level, slot)
        with self._lock:
            route = self._data["levels"][str(level)][slot - 1]
            points = deepcopy(route["points"])
            frame = _frame_from_points(self._num_leds, points)
            return {
                "level": level,
                "slot": slot,
                "name": route["name"],
                "points": points,
                "frame": frame,
            }

    def save_route(self, level: int, slot: int, name: str, frame: list[list[int]]) -> dict[str, Any]:
        self._validate_level_slot(level, slot)
        clean_name = self._normalize_name(name, "")
        if not clean_name:
            raise ValueError("Route name is required.")
        clean_frame = self._coerce_frame(frame)
        points = self._points_from_frame(clean_frame)

        with self._lock:
            self._data["levels"][str(level)][slot - 1] = {
                "slot": slot,
                "name": clean_name,
                "points": points,
            }
            self._data["updated_at"] = _now_iso()
            self._write_json(self._data)

        return {
            "level": level,
            "slot": slot,
            "name": clean_name,
            "points": deepcopy(points),
            "frame": clean_frame,
        }

    def _load_or_create(self) -> dict[str, Any]:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        if not self._path.exists():
            data = self._default_data()
            self._write_json(data)
            return data

        raw = json.loads(self._path.read_text(encoding="utf-8"))
        data = self._normalize_data(raw)
        if data != raw:
            self._write_json(data)
        return data

    def _write_json(self, payload: dict[str, Any]) -> None:
        tmp_path = self._path.with_suffix(self._path.suffix + ".tmp")
        tmp_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        tmp_path.replace(self._path)

    def _default_data(self) -> dict[str, Any]:
        levels: dict[str, list[dict[str, Any]]] = {}
        for level in ROUTE_LEVELS:
            defaults = DEFAULT_ROUTE_BLUEPRINTS[level]
            level_routes: list[dict[str, Any]] = []
            for slot, route in enumerate(defaults, start=1):
                level_routes.append(
                    {
                        "slot": slot,
                        "name": route["name"],
                        "points": _points_from_indices(
                            indices=route["indices"],
                            color=route["color"],
                            num_leds=self._num_leds,
                        ),
                    }
                )
            levels[str(level)] = level_routes
        return {
            "version": 1,
            "num_leds": self._num_leds,
            "updated_at": _now_iso(),
            "levels": levels,
        }

    def _normalize_data(self, raw: Any) -> dict[str, Any]:
        defaults = self._default_data()
        if not isinstance(raw, dict):
            return defaults

        raw_levels = raw.get("levels")
        out = {
            "version": 1,
            "num_leds": self._num_leds,
            "updated_at": raw.get("updated_at") if isinstance(raw.get("updated_at"), str) else _now_iso(),
            "levels": {},
        }
        for level in ROUTE_LEVELS:
            fallback_routes = defaults["levels"][str(level)]
            source_routes = None
            if isinstance(raw_levels, dict):
                source_routes = raw_levels.get(str(level))
            normalized_routes: list[dict[str, Any]] = []
            for idx in range(ROUTES_PER_LEVEL):
                fallback = fallback_routes[idx]
                candidate = {}
                if isinstance(source_routes, list) and idx < len(source_routes) and isinstance(source_routes[idx], dict):
                    candidate = source_routes[idx]
                name = self._normalize_name(candidate.get("name"), fallback["name"])
                points = self._coerce_points_or_fallback(
                    points=candidate.get("points"),
                    frame=candidate.get("frame"),
                    fallback=fallback["points"],
                )
                normalized_routes.append(
                    {
                        "slot": idx + 1,
                        "name": name,
                        "points": points,
                    }
                )
            out["levels"][str(level)] = normalized_routes
        return out

    def _coerce_points_or_fallback(
        self,
        points: Any,
        frame: Any,
        fallback: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        try:
            if points is not None:
                return self._coerce_points(points)
            if frame is not None:
                frame_payload = self._coerce_frame(frame)
                return self._points_from_frame(frame_payload)
        except ValueError:
            pass
        return deepcopy(fallback)

    def _points_from_frame(self, frame: list[list[int]]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for idx, color in enumerate(frame):
            if color[0] == 0 and color[1] == 0 and color[2] == 0:
                continue
            out.append({"index": idx, "color": [color[0], color[1], color[2]]})
        return out

    def _coerce_points(self, points: Any) -> list[dict[str, Any]]:
        if not isinstance(points, list):
            raise ValueError("points must be a list.")

        by_index: dict[int, list[int]] = {}
        for i, point in enumerate(points):
            if not isinstance(point, dict):
                raise ValueError(f"points[{i}] must be an object.")
            idx = self._coerce_index(point.get("index"))
            color = self._coerce_rgb(point.get("color"), label=f"points[{i}].color")
            by_index[idx] = color

        return [{"index": idx, "color": by_index[idx]} for idx in sorted(by_index.keys())]

    def _coerce_frame(self, frame: Any) -> list[list[int]]:
        if not isinstance(frame, list):
            raise ValueError("frame must be a list.")
        if len(frame) != self._num_leds:
            raise ValueError(f"frame must include {self._num_leds} colors.")

        out: list[list[int]] = []
        for i, color in enumerate(frame):
            out.append(self._coerce_rgb(color, label=f"frame[{i}]"))
        return out

    def _coerce_rgb(self, value: Any, label: str = "color") -> list[int]:
        if not isinstance(value, (list, tuple)) or len(value) != 3:
            raise ValueError(f"{label} must be [r,g,b].")

        rgb: list[int] = []
        for channel in value:
            if isinstance(channel, bool):
                raise ValueError("Color channel must be an integer from 0 to 255.")
            try:
                channel_value = int(channel)
            except (TypeError, ValueError) as e:
                raise ValueError("Color channel must be an integer from 0 to 255.") from e
            if channel_value < 0 or channel_value > 255:
                raise ValueError("Color channel must be an integer from 0 to 255.")
            rgb.append(channel_value)
        return rgb

    def _coerce_index(self, value: Any) -> int:
        if isinstance(value, bool):
            raise ValueError("Point index must be an integer.")
        try:
            idx = int(value)
        except (TypeError, ValueError) as e:
            raise ValueError("Point index must be an integer.") from e

        if idx < 0 or idx >= self._num_leds:
            raise ValueError(f"Point index must be between 0 and {self._num_leds - 1}.")
        return idx

    def _normalize_name(self, name: Any, fallback: str) -> str:
        if not isinstance(name, str):
            return fallback
        normalized = " ".join(name.split()).strip()
        if not normalized:
            return fallback
        return normalized[:48]

    def _validate_level_slot(self, level: int, slot: int) -> None:
        if level not in ROUTE_LEVELS:
            raise ValueError(f"Unsupported level: {level}. Expected one of {ROUTE_LEVELS}.")
        if slot < 1 or slot > ROUTES_PER_LEVEL:
            raise ValueError(f"Unsupported slot: {slot}. Expected 1..{ROUTES_PER_LEVEL}.")
