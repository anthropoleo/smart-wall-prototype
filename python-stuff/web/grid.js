/**
 * Grid state + rendering for the 5x7 LED wall preview/editor.
 */

export const GRID_COLS = 5;
export const GRID_ROWS = 7;
export const NUM_LEDS = GRID_COLS * GRID_ROWS;

function hexToRgb(hex) {
  const value = String(hex || "").replace("#", "");
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

function rgbToCss([r, g, b]) {
  return `rgb(${r}, ${g}, ${b})`;
}

function rgbEquals(a, b) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function cloneFrame(frame) {
  return frame.map(([r, g, b]) => [r, g, b]);
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

export function createGridController({
  initialInteractive,
  stripEl,
  selectedInfoEl,
  colorInput,
  swatches,
  setStatus,
  onSetPixel,
}) {
  let selected = 0;
  let interactive = !!initialInteractive;
  let state = Array.from({ length: NUM_LEDS }, () => [0, 0, 0]);
  const ledEls = Array.from({ length: NUM_LEDS }, () => null);
  let activeColorHex = (colorInput?.value || "#ffffff").toLowerCase();

  function renderSelected() {
    if (selectedInfoEl) {
      selectedInfoEl.textContent = `Selected LED: ${selected + 1}`;
    }
  }

  function syncSwatchSelection() {
    const current = colorInput ? colorInput.value.toLowerCase() : activeColorHex;
    for (const swatch of swatches) {
      swatch.classList.toggle("active", swatch.dataset.color?.toLowerCase() === current);
    }
  }

  function applyColorSelection(nextColor, announceOnBlock = false) {
    const normalized = String(nextColor || "").toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(normalized)) return false;

    if (normalized === "#000000") {
      if (colorInput) colorInput.value = activeColorHex;
      syncSwatchSelection();
      if (announceOnBlock) {
        setStatus("Black is reserved for OFF. Click the same color twice to turn a light off.");
      }
      return false;
    }

    activeColorHex = normalized;
    if (colorInput) colorInput.value = normalized;
    syncSwatchSelection();
    return true;
  }

  function getActiveColorRgb() {
    return hexToRgb(activeColorHex);
  }

  function updateLedVisual(index) {
    const el = ledEls[index];
    if (!el) return;

    const [r, g, b] = state[index];
    el.style.background = rgbToCss(state[index]);
    el.style.boxShadow =
      `0 0 0 1px rgba(255,255,255,0.12) inset, 0 8px 16px rgba(${r}, ${g}, ${b}, 0.25)`;
  }

  function updateAllLedVisuals() {
    for (let i = 0; i < NUM_LEDS; i += 1) {
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

  function setAll(color) {
    const [r, g, b] = color;
    state = state.map(() => [r, g, b]);
    updateAllLedVisuals();
  }

  function clearAll() {
    setAll([0, 0, 0]);
  }

  function getFrame() {
    return cloneFrame(state);
  }

  function setSelectedIndex(index) {
    if (index === selected) return;
    ledEls[selected]?.classList.remove("selected");
    selected = index;
    ledEls[selected]?.classList.add("selected");
    renderSelected();
  }

  async function handleLedClick(index, event) {
    if (!interactive) return;

    if (!event.shiftKey) {
      setSelectedIndex(index);
    }

    const nextColor = getActiveColorRgb();
    const previousColor = state[index];
    const shouldToggleOff = rgbEquals(previousColor, nextColor);
    const appliedColor = shouldToggleOff ? [0, 0, 0] : nextColor;

    state[index] = appliedColor;
    updateLedVisual(index);

    try {
      const [r, g, b] = appliedColor;
      await onSetPixel(index, r, g, b);
    } catch (error) {
      state[index] = previousColor;
      updateLedVisual(index);
      setStatus(`Set failed: ${error.message}`);
    }
  }

  function initGrid() {
    if (!stripEl) return;

    stripEl.innerHTML = "";
    let drawIndex = 0;

    for (let row = 0; row < GRID_ROWS; row += 1) {
      for (let col = 0; col < GRID_COLS; col += 1) {
        const index = gridToIndex(col, row);
        const button = document.createElement("button");
        button.type = "button";
        button.className = `led${index === selected ? " selected" : ""}${interactive ? "" : " readonly"}`;
        button.title = `LED ${index + 1}`;
        button.textContent = String(index + 1);
        button.style.setProperty("--i", String(drawIndex));
        button.addEventListener("click", (event) => {
          void handleLedClick(index, event);
        });

        ledEls[index] = button;
        updateLedVisual(index);
        stripEl.appendChild(button);
        drawIndex += 1;
      }
    }

    renderSelected();
    syncSwatchSelection();
    updateInteractivityUi();
  }

  function updateInteractivityUi() {
    for (const ledEl of ledEls) {
      if (!ledEl) continue;
      ledEl.classList.toggle("readonly", !interactive);
      if (interactive) {
        ledEl.removeAttribute("aria-disabled");
      } else {
        ledEl.setAttribute("aria-disabled", "true");
      }
    }
  }

  function setInteractive(nextInteractive) {
    const next = !!nextInteractive;
    if (interactive === next) return;
    interactive = next;
    updateInteractivityUi();
  }

  function bindColorControls() {
    for (const swatch of swatches) {
      swatch.addEventListener("click", () => {
        const swatchColor = swatch.dataset.color;
        if (!swatchColor) return;
        applyColorSelection(swatchColor, true);
      });
    }

    if (colorInput) {
      colorInput.addEventListener("input", () => {
        applyColorSelection(colorInput.value, true);
      });
      applyColorSelection(colorInput.value);
    } else {
      syncSwatchSelection();
    }
  }

  function init() {
    initGrid();
    bindColorControls();
  }

  return {
    init,
    applyFrameToState,
    applyColorSelection,
    getActiveColorRgb,
    getFrame,
    setAll,
    clearAll,
    setInteractive,
  };
}
