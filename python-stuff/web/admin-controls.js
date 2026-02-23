/**
 * Transport connection and device command controls for admin mode.
 */

export function createAdminControlsController({
  api,
  grid,
  setStatus,
  onDeviceLedCount,
  transportSelect,
  portSelect,
  hostInput,
  refreshPortsBtn,
  connectBtn,
  disconnectBtn,
  bright,
  brightVal,
  applyBright,
  fillBtn,
  clearBtn,
}) {
  function syncTransportUi() {
    if (!transportSelect || !portSelect || !refreshPortsBtn || !hostInput) return;

    const isWifi = transportSelect.value === "wifi";
    portSelect.disabled = isWifi;
    refreshPortsBtn.disabled = isWifi;
    hostInput.disabled = !isWifi;
  }

  async function refreshPorts() {
    if (!portSelect) return;

    const ports = await api("GET", "/api/ports");
    portSelect.innerHTML = "";

    for (const port of ports) {
      const option = document.createElement("option");
      option.value = port.device;
      option.textContent = `${port.device} - ${port.description}`;
      portSelect.appendChild(option);
    }

    if (!ports.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No serial ports found";
      portSelect.appendChild(option);
    }
  }

  function applyDeviceInfo(info) {
    if (!info || typeof info !== "object") return;

    if (bright && typeof info.brightness === "number") {
      bright.value = String(info.brightness);
    }
    if (brightVal && typeof info.brightness === "number") {
      brightVal.textContent = String(info.brightness);
    }
    if (typeof info.num_leds === "number") {
      onDeviceLedCount(info.num_leds);
    }
  }

  async function pollStatus() {
    try {
      const status = await api("GET", "/api/status");
      if (status.connected) {
        const endpoint = status.endpoint || "(unknown)";
        const mode = status.transport || "serial";
        const bits = [`Connected [${mode}]`, endpoint];
        if (typeof status.info?.num_leds === "number") bits.push(`${status.info.num_leds} LEDs`);
        if (typeof status.info?.brightness === "number") bits.push(`Bright ${status.info.brightness}`);
        setStatus(bits.join(" | "));
        applyDeviceInfo(status.info);
      } else {
        setStatus("Disconnected");
      }
    } catch (error) {
      setStatus(`Status error: ${error.message}`);
    }
  }

  function bindEvents() {
    if (bright) {
      bright.addEventListener("input", () => {
        if (brightVal) {
          brightVal.textContent = String(bright.value);
        }
      });
    }

    if (applyBright) {
      applyBright.addEventListener("click", async () => {
        if (!bright) return;
        try {
          await api("POST", "/api/brightness", { value: Number(bright.value) });
          await pollStatus();
        } catch (error) {
          setStatus(`Brightness failed: ${error.message}`);
        }
      });
    }

    if (fillBtn) {
      fillBtn.addEventListener("click", async () => {
        const [r, g, b] = grid.getActiveColorRgb();
        grid.setAll([r, g, b]);
        try {
          await api("POST", "/api/fill", { r, g, b });
        } catch (error) {
          setStatus(`Fill failed: ${error.message}`);
        }
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener("click", async () => {
        grid.clearAll();
        try {
          await api("POST", "/api/clear");
        } catch (error) {
          setStatus(`Clear failed: ${error.message}`);
        }
      });
    }

    if (refreshPortsBtn) {
      refreshPortsBtn.addEventListener("click", async () => {
        try {
          await refreshPorts();
        } catch (error) {
          setStatus(`Refresh failed: ${error.message}`);
        }
      });
    }

    if (connectBtn) {
      connectBtn.addEventListener("click", async () => {
        const transport = transportSelect?.value || "serial";
        const port = portSelect?.value || null;
        const host = hostInput?.value.trim() || null;

        try {
          const response = await api("POST", "/api/connect", { transport, port, host });
          applyDeviceInfo(response.info);
          if (response.warning) {
            setStatus(response.warning);
          }
          await pollStatus();
        } catch (error) {
          setStatus(`Connect failed: ${error.message}`);
        }
      });
    }

    if (disconnectBtn) {
      disconnectBtn.addEventListener("click", async () => {
        try {
          await api("POST", "/api/disconnect");
          await pollStatus();
        } catch (error) {
          setStatus(`Disconnect failed: ${error.message}`);
        }
      });
    }

    if (transportSelect) {
      transportSelect.addEventListener("change", syncTransportUi);
    }
  }

  function init() {
    bindEvents();
    syncTransportUi();
  }

  return {
    init,
    pollStatus,
    refreshPorts,
  };
}
