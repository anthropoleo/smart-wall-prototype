const statusEl = document.getElementById("status");
const portSelect = document.getElementById("portSelect");
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

const NUM_LEDS = 15;
let selected = 0;
let state = Array.from({ length: NUM_LEDS }, () => [0, 0, 0]);

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

function render() {
  strip.innerHTML = "";
  // Render top-to-bottom as 15..1 (so LED 1 is the bottom LED).
  for (let pos = 0; pos < NUM_LEDS; pos++) {
    const i = NUM_LEDS - 1 - pos; // physical index
    const el = document.createElement("div");
    el.className = "led" + (i === selected ? " selected" : "");
    el.style.background = rgbToCss(state[i]);
    el.title = `LED ${i + 1}`;
    el.textContent = String(i + 1);
    const [r0, g0, b0] = state[i];
    el.style.boxShadow = `0 0 0 1px rgba(0,0,0,0.25) inset, 0 6px 16px rgba(${r0}, ${g0}, ${b0}, 0.25)`;
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
  }
}

function setStatus(text) {
  statusEl.textContent = text;
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

async function pollStatus() {
  try {
    const s = await api("GET", "/api/status");
    if (s.connected) {
      const info = s.info?.raw ? ` (${s.info.raw})` : "";
      setStatus(`Connected: ${s.port}${info}`);
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
  const port = portSelect.value || null;
  try {
    const res = await api("POST", "/api/connect", { port });
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

render();
refreshPorts().catch(() => {});
pollStatus().catch(() => {});
setInterval(pollStatus, 2500);
