/**
 * LED Wall Controller frontend logic.
 *
 * Renders a 5x7 LED grid, route folders by difficulty, and calls backend
 * `/api/*` endpoints.
 */

const statusEl = document.getElementById("status");
const transportSelect = document.getElementById("transportSelect");
const portSelect = document.getElementById("portSelect");
const hostInput = document.getElementById("hostInput");
const refreshPortsBtn = document.getElementById("refreshPorts");
const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");

const bright = document.getElementById("bright");
const brightVal = document.getElementById("brightVal");
const applyBright = document.getElementById("applyBright");

const color = document.getElementById("color");
const fillBtn = document.getElementById("fillBtn");
const clearBtn = document.getElementById("clearBtn");

const strip = document.getElementById("strip");
const selectedInfo = document.getElementById("selectedInfo");
const swatches = Array.from(document.querySelectorAll(".swatch"));

const routeFolders = document.getElementById("routeFolders");
const reloadRoutesBtn = document.getElementById("reloadRoutesBtn");
const editModeToggle = document.getElementById("editModeToggle");
const routePinInput = document.getElementById("routePin");
const routeNameInput = document.getElementById("routeName");
const routeSelection = document.getElementById("routeSelection");
const saveRouteBtn = document.getElementById("saveRouteBtn");

const GRID_COLS = 5;
const GRID_ROWS = 7;
const NUM_LEDS = GRID_COLS * GRID_ROWS;
let selected = 0;
let state = Array.from({ length: NUM_LEDS }, () => [0, 0, 0]);
let warnedCountMismatch = false;
const ledEls = Array.from({ length: NUM_LEDS }, () => null);
let activeColorHex = color.value.toLowerCase();

let selectedRoute = null;
const routeBtnByKey = new Map();

function routeKey(level, slot) {
  return `${level}:${slot}`;
}

function cloneFrame(frame) {
  return frame.map(([r, g, b]) => [r, g, b]);
}

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return [r, g, b];
}

function rgbToCss([r, g, b]) {
  return `rgb(${r}, ${g}, ${b})`;
}

function rgbEquals(a, b) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function applyColorSelection(nextColor, announceOnBlock = false) {
  const normalized = String(nextColor || "").toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(normalized)) return false;
  if (normalized === "#000000") {
    color.value = activeColorHex;
    syncSwatchSelection();
    if (announceOnBlock) {
      setStatus("Black is reserved for OFF. Click the same color twice to turn a light off.");
    }
    return false;
  }
  activeColorHex = normalized;
  color.value = normalized;
  syncSwatchSelection();
  return true;
}

function getActiveColorRgb() {
  return hexToRgb(activeColorHex);
}

function gridToIndex(col, row) {
  const colFromRight = GRID_COLS - 1 - col;
  const base = colFromRight * GRID_ROWS;
  if (colFromRight % 2 === 0) {
    const rowFromBottom = GRID_ROWS - 1 - row;
    return base + rowFromBottom;
  }
  return base + row;
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = data.detail;
    if (typeof d === "string") {
      throw new Error(d);
    }
    if (d && typeof d === "object") {
      const parts = [];
      if (d.type) parts.push(d.type);
      if (d.message) parts.push(d.message);
      if (d.hint) parts.push(`Hint: ${d.hint}`);
      throw new Error(parts.filter(Boolean).join(" — ") || `HTTP ${res.status}`);
    }
    throw new Error(`HTTP ${res.status}`);
  }
  return data;
}

function renderSelected() {
  selectedInfo.textContent = `Selected LED: ${selected + 1}`;
}

function syncSwatchSelection() {
  const current = color.value.toLowerCase();
  for (const swatch of swatches) {
    swatch.classList.toggle("active", swatch.dataset.color?.toLowerCase() === current);
  }
}

function updateLedVisual(i) {
  const el = ledEls[i];
  if (!el) return;
  const [r, g, b] = state[i];
  el.style.background = rgbToCss(state[i]);
  el.style.boxShadow = `0 0 0 1px rgba(255,255,255,0.12) inset, 0 8px 16px rgba(${r}, ${g}, ${b}, 0.25)`;
}

function updateAllLedVisuals() {
  for (let i = 0; i < NUM_LEDS; i++) {
    updateLedVisual(i);
  }
}

function applyFrameToState(frame) {
  if (!Array.isArray(frame) || frame.length !== NUM_LEDS) return false;
  const next = [];
  for (const colorRow of frame) {
    if (!Array.isArray(colorRow) || colorRow.length !== 3) return false;
    const [r, g, b] = colorRow;
    const rr = Number(r);
    const gg = Number(g);
    const bb = Number(b);
    if (![rr, gg, bb].every((v) => Number.isInteger(v) && v >= 0 && v <= 255)) {
      return false;
    }
    next.push([rr, gg, bb]);
  }
  state = next;
  updateAllLedVisuals();
  return true;
}

function setSelectedIndex(i) {
  if (i === selected) return;
  ledEls[selected]?.classList.remove("selected");
  selected = i;
  ledEls[selected]?.classList.add("selected");
  renderSelected();
}

async function handleLedClick(i, ev) {
  if (!ev.shiftKey) setSelectedIndex(i);
  const nextColor = getActiveColorRgb();
  const previousColor = state[i];
  const shouldToggleOff = rgbEquals(previousColor, nextColor);
  const appliedColor = shouldToggleOff ? [0, 0, 0] : nextColor;
  state[i] = appliedColor;
  updateLedVisual(i);
  try {
    const [r, g, b] = appliedColor;
    await api("POST", "/api/set", { index: i, r, g, b });
  } catch (e) {
    state[i] = previousColor;
    updateLedVisual(i);
    setStatus(`Set failed: ${e.message}`);
  }
}

function initGrid() {
  strip.innerHTML = "";
  let drawIndex = 0;
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const i = gridToIndex(col, row);
      const el = document.createElement("button");
      el.type = "button";
      el.className = "led" + (i === selected ? " selected" : "");
      el.title = `LED ${i + 1}`;
      el.textContent = String(i + 1);
      el.style.setProperty("--i", String(drawIndex));
      el.addEventListener("click", (ev) => {
        void handleLedClick(i, ev);
      });
      ledEls[i] = el;
      updateLedVisual(i);
      strip.appendChild(el);
      drawIndex += 1;
    }
  }
  renderSelected();
  syncSwatchSelection();
}

function setStatus(text) {
  statusEl.textContent = text;
}

function syncTransportUi() {
  const isWifi = transportSelect.value === "wifi";
  portSelect.disabled = isWifi;
  refreshPortsBtn.disabled = isWifi;
  hostInput.disabled = !isWifi;
}

function syncRouteEditorUi() {
  const enabled = editModeToggle.checked;
  routePinInput.disabled = !enabled;
  routeNameInput.disabled = !enabled;
  saveRouteBtn.disabled = !enabled || !selectedRoute;
}

function refreshRouteSelectionText() {
  if (!selectedRoute) {
    routeSelection.textContent = "Selected route: none";
  } else {
    routeSelection.textContent = `Selected route: Level ${selectedRoute.level} · Slot ${selectedRoute.slot}`;
  }

  const activeKey = selectedRoute ? routeKey(selectedRoute.level, selectedRoute.slot) : "";
  for (const [key, button] of routeBtnByKey.entries()) {
    button.classList.toggle("active", key === activeKey);
  }
}

function setSelectedRoute(level, slot, name = "") {
  selectedRoute = { level, slot };
  if (typeof name === "string" && name.trim()) {
    routeNameInput.value = name.trim();
  }
  refreshRouteSelectionText();
  syncRouteEditorUi();
}

function renderRoutes(levels) {
  routeFolders.innerHTML = "";
  routeBtnByKey.clear();

  if (!Array.isArray(levels) || !levels.length) {
    const empty = document.createElement("div");
    empty.className = "mono";
    empty.textContent = "No routes available.";
    routeFolders.appendChild(empty);
    refreshRouteSelectionText();
    syncRouteEditorUi();
    return;
  }

  for (const levelInfo of levels) {
    const level = Number(levelInfo.level);
    const routes = Array.isArray(levelInfo.routes) ? levelInfo.routes : [];

    const folder = document.createElement("details");
    folder.className = "level-folder";
    if (selectedRoute) {
      folder.open = selectedRoute.level === level;
    } else {
      folder.open = level === 4;
    }

    const summary = document.createElement("summary");
    summary.textContent = `Level ${level}`;

    const list = document.createElement("div");
    list.className = "route-list";

    for (const route of routes) {
      const slot = Number(route.slot);
      const name = String(route.name || `Route ${slot}`);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "route-item";
      button.textContent = `${slot}. ${name}`;
      button.addEventListener("click", () => {
        void applyRoute(level, slot, name);
      });
      routeBtnByKey.set(routeKey(level, slot), button);
      list.appendChild(button);
    }

    folder.appendChild(summary);
    folder.appendChild(list);
    routeFolders.appendChild(folder);
  }

  if (selectedRoute && !routeBtnByKey.has(routeKey(selectedRoute.level, selectedRoute.slot))) {
    selectedRoute = null;
    routeNameInput.value = "";
  }
  refreshRouteSelectionText();
  syncRouteEditorUi();
}

async function refreshPorts() {
  const ports = await api("GET", "/api/ports");
  portSelect.innerHTML = "";
  for (const p of ports) {
    const opt = document.createElement("option");
    opt.value = p.device;
    opt.textContent = `${p.device} — ${p.description}`;
    portSelect.appendChild(opt);
  }
  if (!ports.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No serial ports found";
    portSelect.appendChild(opt);
  }
}

async function loadRoutes() {
  const payload = await api("GET", "/api/routes");
  if (typeof payload.num_leds === "number" && payload.num_leds !== NUM_LEDS && !warnedCountMismatch) {
    warnedCountMismatch = true;
    setStatus(`Route catalog uses ${payload.num_leds} LEDs; UI layout expects ${NUM_LEDS}.`);
  }
  renderRoutes(payload.levels);
}

async function applyRoute(level, slot, fallbackName) {
  try {
    const routePayload = await api("GET", `/api/routes/${level}/${slot}`);
    const route = routePayload.route;
    if (route?.frame && !applyFrameToState(route.frame)) {
      setStatus("Route frame shape mismatch for this wall layout.");
      return;
    }

    const resolvedName = route?.name || fallbackName || `Route ${slot}`;
    setSelectedRoute(level, slot, resolvedName);

    try {
      await api("POST", `/api/routes/${level}/${slot}/apply`);
      setStatus(`Applied Level ${level} • ${resolvedName}`);
    } catch (e) {
      setStatus(`Route preview loaded, but device apply failed: ${e.message}`);
    }
  } catch (e) {
    setStatus(`Route load failed: ${e.message}`);
  }
}

function applyDeviceInfo(info) {
  if (!info || typeof info !== "object") return;
  if (typeof info.brightness === "number") {
    bright.value = String(info.brightness);
    brightVal.textContent = String(info.brightness);
  }
  if (typeof info.num_leds === "number" && info.num_leds !== NUM_LEDS && !warnedCountMismatch) {
    warnedCountMismatch = true;
    setStatus(`Device reports ${info.num_leds} LEDs; UI layout expects ${NUM_LEDS}.`);
  }
}

async function pollStatus() {
  try {
    const s = await api("GET", "/api/status");
    if (s.connected) {
      const endpoint = s.endpoint || "(unknown)";
      const mode = s.transport || "serial";
      const bits = [`Connected [${mode}]`, endpoint];
      if (typeof s.info?.num_leds === "number") bits.push(`${s.info.num_leds} LEDs`);
      if (typeof s.info?.brightness === "number") bits.push(`Bright ${s.info.brightness}`);
      setStatus(bits.join(" • "));
      applyDeviceInfo(s.info);
    } else {
      setStatus("Disconnected");
    }
  } catch (e) {
    setStatus(`Status error: ${e.message}`);
  }
}

bright.addEventListener("input", () => {
  brightVal.textContent = String(bright.value);
});

for (const swatch of swatches) {
  swatch.addEventListener("click", () => {
    if (!swatch.dataset.color) return;
    applyColorSelection(swatch.dataset.color, true);
  });
}

applyBright.addEventListener("click", async () => {
  try {
    await api("POST", "/api/brightness", { value: Number(bright.value) });
    await pollStatus();
  } catch (e) {
    setStatus(`Brightness failed: ${e.message}`);
  }
});

fillBtn.addEventListener("click", async () => {
  const [r, g, b] = getActiveColorRgb();
  state = state.map(() => [r, g, b]);
  updateAllLedVisuals();
  try {
    await api("POST", "/api/fill", { r, g, b });
  } catch (e) {
    setStatus(`Fill failed: ${e.message}`);
  }
});

clearBtn.addEventListener("click", async () => {
  state = state.map(() => [0, 0, 0]);
  updateAllLedVisuals();
  try {
    await api("POST", "/api/clear");
  } catch (e) {
    setStatus(`Clear failed: ${e.message}`);
  }
});

refreshPortsBtn.addEventListener("click", async () => {
  try {
    await refreshPorts();
  } catch (e) {
    setStatus(`Refresh failed: ${e.message}`);
  }
});

reloadRoutesBtn.addEventListener("click", async () => {
  try {
    await loadRoutes();
    setStatus("Route catalog reloaded.");
  } catch (e) {
    setStatus(`Route reload failed: ${e.message}`);
  }
});

connectBtn.addEventListener("click", async () => {
  const transport = transportSelect.value;
  const port = portSelect.value || null;
  const host = hostInput.value.trim() || null;
  try {
    const res = await api("POST", "/api/connect", { transport, port, host });
    applyDeviceInfo(res.info);
    if (res.warning) setStatus(res.warning);
    await pollStatus();
  } catch (e) {
    setStatus(`Connect failed: ${e.message}`);
  }
});

disconnectBtn.addEventListener("click", async () => {
  try {
    await api("POST", "/api/disconnect");
    await pollStatus();
  } catch (e) {
    setStatus(`Disconnect failed: ${e.message}`);
  }
});

saveRouteBtn.addEventListener("click", async () => {
  if (!editModeToggle.checked) {
    setStatus("Enable route editing mode first.");
    return;
  }
  if (!selectedRoute) {
    setStatus("Pick a route slot from the level folders first.");
    return;
  }

  const pin = routePinInput.value.trim();
  if (!pin) {
    setStatus("Editor PIN is required to save routes.");
    return;
  }

  const name = routeNameInput.value.trim();
  if (!name) {
    setStatus("Route name is required.");
    return;
  }

  try {
    const payload = {
      name,
      pin,
      frame: cloneFrame(state),
    };
    const res = await api("PUT", `/api/routes/${selectedRoute.level}/${selectedRoute.slot}`, payload);
    const savedName = res.route?.name || name;
    setSelectedRoute(selectedRoute.level, selectedRoute.slot, savedName);
    await loadRoutes();
    setStatus(`Saved Level ${selectedRoute.level} • Slot ${selectedRoute.slot} as "${savedName}".`);
  } catch (e) {
    setStatus(`Save route failed: ${e.message}`);
  }
});

editModeToggle.addEventListener("change", () => {
  syncRouteEditorUi();
});

transportSelect.addEventListener("change", syncTransportUi);

color.addEventListener("input", () => {
  applyColorSelection(color.value, true);
});

applyColorSelection(color.value);
initGrid();
syncTransportUi();
syncRouteEditorUi();
refreshPorts().catch(() => {});
loadRoutes().catch((e) => {
  setStatus(`Route load failed: ${e.message}`);
});
pollStatus().catch(() => {});
setInterval(pollStatus, 2500);
