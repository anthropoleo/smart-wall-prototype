/**
 * LED Wall Controller frontend logic.
 *
 * Renders a 5x7 LED grid and calls backend `/api/*` endpoints.
 * Physical indices are 0-based when sent to firmware, while labels are 1-based.
 * Layout mapping is a right-to-left vertical serpentine starting at bottom-right.
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

const GRID_COLS = 5;
const GRID_ROWS = 7;
const NUM_LEDS = GRID_COLS * GRID_ROWS;
let selected = 0;
let state = Array.from({ length: NUM_LEDS }, () => [0, 0, 0]);
let warnedCountMismatch = false;

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

function render() {
  strip.innerHTML = "";
  let drawIndex = 0;

  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const i = gridToIndex(col, row);
      const el = document.createElement("button");
      el.type = "button";
      el.className = "led" + (i === selected ? " selected" : "");
      el.style.background = rgbToCss(state[i]);
      el.title = `LED ${i + 1}`;
      el.textContent = String(i + 1);
      el.style.setProperty("--i", String(drawIndex));
      const [r0, g0, b0] = state[i];
      el.style.boxShadow = `0 0 0 1px rgba(255,255,255,0.12) inset, 0 8px 16px rgba(${r0}, ${g0}, ${b0}, 0.25)`;
      el.addEventListener("click", async (ev) => {
        if (!ev.shiftKey) selected = i;
        const [r, g, b] = hexToRgb(color.value);
        state[i] = [r, g, b];
        render();
        try {
          await api("POST", "/api/set", { index: i, r, g, b });
        } catch (e) {
          setStatus(`Set failed: ${e.message}`);
        }
      });
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

color.addEventListener("input", syncSwatchSelection);

for (const swatch of swatches) {
  swatch.addEventListener("click", () => {
    if (!swatch.dataset.color) return;
    color.value = swatch.dataset.color;
    syncSwatchSelection();
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
  const [r, g, b] = hexToRgb(color.value);
  state = state.map(() => [r, g, b]);
  render();
  try {
    await api("POST", "/api/fill", { r, g, b });
  } catch (e) {
    setStatus(`Fill failed: ${e.message}`);
  }
});

clearBtn.addEventListener("click", async () => {
  state = state.map(() => [0, 0, 0]);
  render();
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

transportSelect.addEventListener("change", syncTransportUi);

render();
refreshPorts().catch(() => {});
syncTransportUi();
pollStatus().catch(() => {});
setInterval(pollStatus, 2500);
