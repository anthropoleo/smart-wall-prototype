/**
 * Dedicated freestyle mode controls.
 */

export function createFreestyleController({
  api,
  grid,
  setStatus,
  onDeviceLedCount,
  connectionEl,
  clearBtn,
}) {
  let lastState = "unknown";

  function getStatusInfo(status) {
    return status && status.info && typeof status.info === "object" ? status.info : null;
  }

  function setConnectedUi(connected) {
    grid.setInteractive(connected);
    if (clearBtn) {
      clearBtn.disabled = !connected;
    }
  }

  function renderConnection(status) {
    if (!connectionEl) return;

    if (status.connected) {
      const endpoint = status.endpoint || "(unknown)";
      const mode = status.transport || "serial";
      const bits = [`Connected [${mode}]`, endpoint];
      const info = getStatusInfo(status);
      if (info && typeof info.num_leds === "number") bits.push(`${info.num_leds} LEDs`);
      if (info && typeof info.brightness === "number") bits.push(`Bright ${info.brightness}`);
      connectionEl.textContent = bits.join(" | ");
      return;
    }

    connectionEl.textContent = "Not connected. Open Admin Controls to connect first.";
  }

  async function pollStatus() {
    try {
      const status = await api("GET", "/api/status");
      renderConnection(status);
      setConnectedUi(!!status.connected);

      const info = getStatusInfo(status);
      if (info && typeof info.num_leds === "number") {
        onDeviceLedCount(info.num_leds);
      }

      const nextState = status.connected ? "connected" : "disconnected";
      if (nextState !== lastState) {
        if (status.connected) {
          setStatus("Freestyle ready. Pick a color and tap holds.");
        } else {
          setStatus("Freestyle unavailable: not connected. Open Admin Controls to connect first.");
        }
        lastState = nextState;
      }
    } catch (error) {
      setConnectedUi(false);
      if (connectionEl) {
        connectionEl.textContent = `Status error: ${error.message}`;
      }
      if (lastState !== "error") {
        setStatus(`Freestyle status error: ${error.message}`);
        lastState = "error";
      }
    }
  }

  function bindEvents() {
    if (clearBtn) {
      clearBtn.addEventListener("click", async () => {
        const previous = grid.getFrame();
        grid.clearAll();
        try {
          await api("POST", "/api/clear");
          setStatus("Freestyle wall cleared.");
        } catch (error) {
          grid.applyFrameToState(previous);
          setStatus(`Clear failed: ${error.message}`);
        }
      });
    }
  }

  function init() {
    bindEvents();
    setConnectedUi(false);
  }

  return {
    init,
    pollStatus,
  };
}
