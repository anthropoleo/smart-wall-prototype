/**
 * Route catalog browsing/apply/save behavior.
 */

export function createRoutesController({
  isAdmin,
  api,
  grid,
  setStatus,
  onRouteLedCount,
  routeFoldersEl,
  reloadRoutesBtn,
  routeNameInput,
  routeSelectionEl,
  saveRouteBtn,
}) {
  let selectedRoute = null;
  let routeApplyInFlight = false;
  const routeBtnByKey = new Map();

  function routeKey(level, slot) {
    return `${level}:${slot}`;
  }

  function syncRouteEditorUi() {
    const canEditSelectedRoute = isAdmin && !!selectedRoute;
    if (routeNameInput) routeNameInput.disabled = !canEditSelectedRoute;
    if (saveRouteBtn) saveRouteBtn.disabled = !canEditSelectedRoute;
  }

  function setRouteButtonsDisabled(disabled) {
    for (const button of routeBtnByKey.values()) {
      button.disabled = !!disabled;
    }
  }

  function refreshRouteSelectionText() {
    if (routeSelectionEl) {
      if (!selectedRoute) {
        routeSelectionEl.textContent = "Selected route: none";
      } else {
        routeSelectionEl.textContent =
          `Selected route: Level ${selectedRoute.level} - Slot ${selectedRoute.slot}`;
      }
    }

    const activeKey = selectedRoute ? routeKey(selectedRoute.level, selectedRoute.slot) : "";
    for (const [key, button] of routeBtnByKey.entries()) {
      button.classList.toggle("active", key === activeKey);
    }
  }

  function setSelectedRoute(level, slot, name = "") {
    selectedRoute = { level, slot };
    if (routeNameInput && typeof name === "string" && name.trim()) {
      routeNameInput.value = name.trim();
    }
    refreshRouteSelectionText();
    syncRouteEditorUi();
  }

  async function applyRoute(level, slot, fallbackName) {
    if (routeApplyInFlight) {
      setStatus("Please wait for the current route apply to finish.");
      return;
    }

    routeApplyInFlight = true;
    setRouteButtonsDisabled(true);
    try {
      const defaultName = fallbackName || `Route ${slot}`;
      setStatus(`Applying Level ${level} | ${defaultName}...`);

      let route = null;
      let applyError = null;
      try {
        const payload = await api("POST", `/api/routes/${level}/${slot}/apply`);
        route = payload.route || null;
      } catch (error) {
        applyError = error;
        try {
          const payload = await api("GET", `/api/routes/${level}/${slot}`);
          route = payload.route || null;
        } catch (previewError) {
          setStatus(`Route apply failed: ${error.message}. Preview unavailable: ${previewError.message}`);
          return;
        }
      }

      if (route?.frame && !grid.applyFrameToState(route.frame)) {
        if (applyError) {
          setStatus(`Route apply failed: ${applyError.message}`);
        } else {
          setStatus("Applied route on device, but preview frame shape mismatch for this wall layout.");
        }
        return;
      }

      const resolvedName = route?.name || defaultName;
      setSelectedRoute(level, slot, resolvedName);

      if (applyError) {
        setStatus(`Route preview loaded, but device apply failed: ${applyError.message}`);
      } else {
        setStatus(`Applied Level ${level} | ${resolvedName}`);
      }
    } catch (error) {
      setStatus(`Route load failed: ${error.message}`);
    } finally {
      routeApplyInFlight = false;
      setRouteButtonsDisabled(false);
    }
  }

  function renderRoutes(levels) {
    if (!routeFoldersEl) return;

    routeFoldersEl.innerHTML = "";
    routeBtnByKey.clear();

    if (!Array.isArray(levels) || !levels.length) {
      const empty = document.createElement("div");
      empty.className = "mono";
      empty.textContent = "No routes available.";
      routeFoldersEl.appendChild(empty);
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
        button.disabled = routeApplyInFlight;
        button.textContent = `${slot}. ${name}`;
        button.addEventListener("click", () => {
          void applyRoute(level, slot, name);
        });

        routeBtnByKey.set(routeKey(level, slot), button);
        list.appendChild(button);
      }

      folder.appendChild(summary);
      folder.appendChild(list);
      routeFoldersEl.appendChild(folder);
    }

    if (selectedRoute && !routeBtnByKey.has(routeKey(selectedRoute.level, selectedRoute.slot))) {
      selectedRoute = null;
      if (routeNameInput) {
        routeNameInput.value = "";
      }
    }

    refreshRouteSelectionText();
    syncRouteEditorUi();
  }

  async function loadRoutes() {
    const payload = await api("GET", "/api/routes");
    onRouteLedCount(payload.num_leds);
    renderRoutes(payload.levels);
  }

  async function saveSelectedRoute() {
    if (!selectedRoute) {
      setStatus("Pick a route slot from the level folders first.");
      return;
    }

    const name = routeNameInput?.value.trim() || "";
    if (!name) {
      setStatus("Route name is required.");
      return;
    }

    try {
      const payload = {
        name,
        frame: grid.getFrame(),
      };
      const response = await api(
        "PUT",
        `/api/routes/${selectedRoute.level}/${selectedRoute.slot}`,
        payload,
      );
      const savedName = response.route?.name || name;

      setSelectedRoute(selectedRoute.level, selectedRoute.slot, savedName);
      await loadRoutes();
      setStatus(`Saved Level ${selectedRoute.level} | Slot ${selectedRoute.slot} as "${savedName}".`);
      window.alert(`Route "${savedName}" has been saved successfully.`);
    } catch (error) {
      setStatus(`Save route failed: ${error.message}`);
    }
  }

  function bindEvents() {
    if (reloadRoutesBtn) {
      reloadRoutesBtn.addEventListener("click", async () => {
        try {
          await loadRoutes();
          setStatus("Route catalog reloaded.");
        } catch (error) {
          setStatus(`Route reload failed: ${error.message}`);
        }
      });
    }

    if (saveRouteBtn) {
      saveRouteBtn.addEventListener("click", async () => {
        await saveSelectedRoute();
      });
    }
  }

  function init() {
    bindEvents();
    refreshRouteSelectionText();
    syncRouteEditorUi();
  }

  return {
    init,
    loadRoutes,
  };
}
