/**
 * LED Wall web app bootstrap.
 */

import { api } from "./api.js";
import { createGridController, NUM_LEDS } from "./grid.js";
import { createRoutesController } from "./routes.js";
import { createAdminControlsController } from "./admin-controls.js";
import { createFreestyleController } from "./freestyle.js";

const appMode = ["dashboard", "admin", "freestyle"].includes(document.body?.dataset?.appMode || "")
  ? document.body.dataset.appMode
  : "dashboard";
const isAdmin = appMode === "admin";
const isFreestyle = appMode === "freestyle";

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
const freestyleConnection = document.getElementById("freestyleConnection");
const freestyleClearBtn = document.getElementById("freestyleClearBtn");

function setStatus(text) {
  if (statusEl) {
    statusEl.textContent = text;
  }
}

let warnedCountMismatch = false;

function warnRouteLedCount(numLeds) {
  if (typeof numLeds !== "number" || numLeds === NUM_LEDS || warnedCountMismatch) {
    return;
  }
  warnedCountMismatch = true;
  setStatus(`Route catalog uses ${numLeds} LEDs; UI layout expects ${NUM_LEDS}.`);
}

function warnDeviceLedCount(numLeds) {
  if (typeof numLeds !== "number" || numLeds === NUM_LEDS || warnedCountMismatch) {
    return;
  }
  warnedCountMismatch = true;
  setStatus(`Device reports ${numLeds} LEDs; UI layout expects ${NUM_LEDS}.`);
}

const grid = createGridController({
  initialInteractive: isAdmin,
  stripEl: strip,
  selectedInfoEl: selectedInfo,
  colorInput: color,
  swatches,
  setStatus,
  onSetPixel: async (index, r, g, b) => {
    await api("POST", "/api/set", { index, r, g, b });
  },
});

grid.init();

if (!isFreestyle) {
  const routes = createRoutesController({
    isAdmin,
    api,
    grid,
    setStatus,
    onRouteLedCount: warnRouteLedCount,
    routeFoldersEl: routeFolders,
    reloadRoutesBtn,
    editModeToggle,
    routePinInput,
    routeNameInput,
    routeSelectionEl: routeSelection,
    saveRouteBtn,
  });

  routes.init();
  routes.loadRoutes().catch((error) => {
    setStatus(`Route load failed: ${error.message}`);
  });
}

if (isFreestyle) {
  const freestyle = createFreestyleController({
    api,
    grid,
    setStatus,
    onDeviceLedCount: warnDeviceLedCount,
    connectionEl: freestyleConnection,
    clearBtn: freestyleClearBtn,
  });

  freestyle.init();
  freestyle.pollStatus().catch(() => {});
  setInterval(() => {
    void freestyle.pollStatus();
  }, 2500);
} else {
  const adminControls = createAdminControlsController({
    api,
    grid,
    setStatus,
    onDeviceLedCount: warnDeviceLedCount,
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
  });

  adminControls.init();

  if (isAdmin) {
    adminControls.refreshPorts().catch(() => {});
  }

  adminControls.pollStatus().catch(() => {});
  setInterval(() => {
    void adminControls.pollStatus();
  }, 2500);
}
