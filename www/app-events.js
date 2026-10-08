import { app } from "./app.js?v=0.16";

const {
  ROUTE_PROTOCOL_VERSION,
  SERVER_GTFS_URL,
  els,
  gtfsToIsoDate,
  hideDetail,
  isoToGtfsDate,
  populateContextControls,
  readConfig,
  routeDebug,
  renderCurrentTab,
  renderRefreshNotice,
  renderRoutes,
  renderStationPicker,
  renderStationPickers,
  renderTrainTypePicker,
  requestRoutes,
  saveSettings,
  scheduleRouteRefresh,
  setBusy,
  setStatus,
  setTimelinePlaceholder,
  showDetail,
  showRefreshNotice,
  state,
  syncSetValue,
  syncStationState,
  todayGtfsDate,
  updateDayWeekday,
  visibleRouteDays,
  worker,
  writeConfig,
} = app;

const routeProgressStyle = document.createElement("style");
routeProgressStyle.textContent = `
  .refresh-notice .route-refresh-work {
    display: grid;
    gap: 7px;
    width: min(360px, calc(100% - 28px));
    text-align: center;
  }

  .refresh-notice .route-refresh-work-title {
    color: #39444d;
    font-size: 12px;
    font-weight: 800;
  }

  .refresh-notice .route-refresh-work-meter {
    display: flex;
    align-items: baseline;
    justify-content: center;
    gap: 9px;
    min-width: 0;
  }

  .refresh-notice .route-refresh-work-percent {
    color: #26313a;
    font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
    font-size: 19px;
    font-weight: 900;
    font-variant-numeric: tabular-nums;
  }

  .refresh-notice .route-refresh-work-detail {
    color: #747e85;
    font-size: 10px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .refresh-notice .route-refresh-work-progress {
    width: 100%;
    height: 6px;
    accent-color: #313d47;
  }
`;
document.head.append(routeProgressStyle);

function ensureRouteProgressNotice() {
  const notice = els.timeline.querySelector(".refresh-notice");
  if (!notice) return null;
  if (!notice.querySelector(".route-refresh-work")) {
    notice.innerHTML = `
      <span class="route-refresh-spinner" aria-hidden="true"></span>
      <span class="route-refresh-work">
        <span class="route-refresh-work-title">Route settings changed. Refreshing routes automatically…</span>
        <span class="route-refresh-work-meter">
          <strong class="route-refresh-work-percent">0%</strong>
          <span class="route-refresh-work-detail">Preparing route-search data…</span>
        </span>
        <progress class="route-refresh-work-progress" max="100" value="0"></progress>
      </span>
    `;
  }
  return notice;
}

function updateRouteProgressNotice(data) {
  const notice = ensureRouteProgressNotice();
  if (!notice) return;

  const completed = Math.max(0, Number(data.completedWork || 0));
  const total = Math.max(1, Number(data.totalWork || 1));
  const percent = Math.max(0, Math.min(100, Number(data.percent ?? Math.floor((completed / total) * 100))));
  const percentElement = notice.querySelector(".route-refresh-work-percent");
  const detailElement = notice.querySelector(".route-refresh-work-detail");
  const progressElement = notice.querySelector(".route-refresh-work-progress");

  if (percentElement) percentElement.textContent = `${Math.floor(percent)}%`;
  if (progressElement) progressElement.value = String(percent);
  if (detailElement) {
    const dayLabel = Number(data.totalDays || 1) > 1
      ? `day ${data.dayIndex}/${data.totalDays} · `
      : "";
    detailElement.textContent = `${dayLabel}${completed}/${total} route-search batches computed`;
  }
}

function resultForActiveRequest(result) {
  if (state.routeRequestMode !== "append") return result;
  const base = state.routeRequestBaseRoutes || { days: [], outward: [], returns: [] };
  return {
    selected_day: state.selectedDay,
    days: [...(base.days || []), ...(result.days || [])],
    outward: [...(base.outward || []), ...(result.outward || [])],
    returns: [...(base.returns || []), ...(result.returns || [])],
  };
}

function swapContextDirection(context) {
  if (!context) return;
  [context.local_to_connection, context.side_b_to_connection] =
    [context.side_b_to_connection, context.local_to_connection];
  [context.local_to_side_b, context.side_b_to_local] =
    [context.side_b_to_local, context.local_to_side_b];
  [context.connection_to_side_b, context.connection_to_local] =
    [context.connection_to_local, context.connection_to_side_b];
  [context.unrestricted_origins, context.unrestricted_destinations] =
    [context.unrestricted_destinations, context.unrestricted_origins];
}

function canReuseReverseRoutes() {
  return Boolean(
    state.context
    && !state.settingsDirty
    && !state.refreshInFlight
    && !state.routeRequestInFlight
    && state.routes?.selected_day === state.selectedDay
    && Array.isArray(state.routes?.outward)
    && Array.isArray(state.routes?.returns)
  );
}

function swapCachedRouteDirections() {
  const outward = state.routes.outward || [];
  const returns = state.routes.returns || [];
  for (const itinerary of returns) itinerary.direction = "outward";
  for (const itinerary of outward) itinerary.direction = "return";
  state.routes = {
    ...state.routes,
    outward: returns,
    returns: outward,
  };
}

function requestMoreRoutes() {
  if (!state.context || state.routeRequestInFlight) return;
  const base = state.routes;
  const days = visibleRouteDays(base.days?.length || 0, 3);
  state.routeRequestInFlight = true;
  state.routeRequestMode = "append";
  state.routeRequestBaseRoutes = base;
  state.routeRequestId += 1;
  const requestId = state.routeRequestId;
  routeDebug("app", "load-more route request posted", { requestId, selectedDay: state.selectedDay, days });
  setBusy(true);
  renderCurrentTab();
  worker.postMessage({
    type: "routes",
    protocolVersion: ROUTE_PROTOCOL_VERSION,
    requestId,
    selectedDay: state.selectedDay,
    days,
    overrides: readConfig(),
  });
}

worker.onmessage = (event) => {
  const { type } = event.data;
  if (["ready", "route-work-progress", "routes-progress", "routes", "error"].includes(type)) {
    routeDebug("app", `worker message: ${type}`, {
      requestId: event.data.requestId ?? null,
      activeRequestId: state.routeRequestId,
      completedDays: event.data.completedDays ?? null,
      totalDays: event.data.totalDays ?? null,
      completedWork: event.data.completedWork ?? null,
      totalWork: event.data.totalWork ?? null,
      percent: event.data.percent ?? null,
      resultDay: event.data.result?.selected_day ?? null,
      selectedDay: state.selectedDay,
      message: event.data.message ?? null,
    });
  }
  if (type === "progress") {
    setBusy(true);
    const refreshNotice = ensureRouteProgressNotice();
    setStatus(event.data.message, refreshNotice ? 0 : event.data.progress, "loading");
    return;
  }
  if (type === "ready") {
    state.context = event.data.context;
    populateContextControls(state.context);
    if (state.settingsDirty) {
      state.refreshInFlight = false;
      scheduleRouteRefresh();
      return;
    }
    if (state.refreshInFlight) {
      ensureRouteProgressNotice();
      setStatus("Preparing route search…", 0, "loading");
    } else {
      setStatus(`Cache ready${event.data.cached ? " from browser cache" : ""}. GTFS service dates: ${state.context.coverage.label}.`, 100, "ready");
    }
    requestRoutes(state.refreshInFlight);
    return;
  }
  if (type === "route-work-progress") {
    if (event.data.requestId !== state.routeRequestId) return;
    updateRouteProgressNotice(event.data);
    setStatus(
      `Computing routes: ${event.data.percent}% (${event.data.completedWork}/${event.data.totalWork} search batches).`,
      event.data.percent,
      "loading",
    );
    return;
  }
  if (type === "routes-progress") {
    if (event.data.requestId !== state.routeRequestId) return;
    if (state.settingsDirty) return;
    const result = event.data.result;
    if (result.selected_day !== state.selectedDay) return;
    renderRoutes(resultForActiveRequest(result));
    setStatus(
      `Showing ${event.data.completedDays} of ${event.data.totalDays} days; loading more routes…`,
      Math.round((event.data.completedDays / event.data.totalDays) * 100),
      "loading",
    );
    return;
  }
  if (type === "routes") {
    if (event.data.requestId !== state.routeRequestId) {
      routeDebug("app", "route response rejected", {
        responseRequestId: event.data.requestId ?? null,
        activeRequestId: state.routeRequestId,
        resultDay: event.data.result?.selected_day ?? null,
        selectedDay: state.selectedDay,
      });
      if (event.data.requestId == null) {
        state.routeRequestInFlight = false;
        setStatus("An outdated route worker was detected. Reload the page once.", 0, "error");
        setBusy(false);
      }
      return;
    }
    state.routeRequestInFlight = false;
    state.refreshInFlight = false;
    if (state.settingsDirty) {
      state.routeRequestMode = "replace";
      state.routeRequestBaseRoutes = null;
      scheduleRouteRefresh();
      return;
    }
    const result = resultForActiveRequest(event.data.result);
    if (result.selected_day !== state.selectedDay) {
      requestRoutes();
      return;
    }
    const expectedDays = result.days || [];
    const expectedDaySet = new Set(expectedDays);
    renderRoutes({
      ...result,
      days: expectedDays,
      outward: (result.outward || []).filter((itinerary) => expectedDaySet.has(itinerary.date)),
      returns: (result.returns || []).filter((itinerary) => expectedDaySet.has(itinerary.date)),
    });
    setStatus(`Routes ready through ${gtfsToIsoDate(expectedDays.at(-1))}.`, 100, "ready");
    state.routeRequestMode = "replace";
    state.routeRequestBaseRoutes = null;
    setBusy(false);
    return;
  }
  if (type === "no-source") {
    setTimelinePlaceholder("Load a GTFS archive to build routes.");
    setStatus("Waiting for GTFS archive.", 0, "idle");
    setBusy(false);
    return;
  }
  if (type === "error") {
    if (state.refreshTimer !== null) {
      clearTimeout(state.refreshTimer);
      state.refreshTimer = null;
    }
    state.refreshInFlight = false;
    state.routeRequestInFlight = false;
    state.routeRequestMode = "replace";
    state.routeRequestBaseRoutes = null;
    state.settingsDirty = false;
    if (els.timeline.querySelector(".route-refresh-spinner")) {
      setTimelinePlaceholder("Unable to refresh routes. Check the error above.");
    }
    setStatus(event.data.message, 0, "error");
    setBusy(false);
  }
};

els.bundledBtn.addEventListener("click", () => {
  state.config = readConfig();
  saveSettings();
  setBusy(true);
  worker.postMessage({ type: "load-bundled", url: SERVER_GTFS_URL, config: state.config });
});

els.uploadBtn.addEventListener("click", async () => {
  const file = els.uploadInput.files[0];
  if (!file) {
    setStatus("Choose a GTFS zip file first.", 0, "error");
    return;
  }
  state.config = readConfig();
  saveSettings();
  setBusy(true);
  const buffer = await file.arrayBuffer();
  worker.postMessage(
    { type: "load-upload", buffer, name: file.name, lastModified: file.lastModified, config: state.config },
    [buffer],
  );
});

els.dayCalendar.addEventListener("change", () => {
  const selected = isoToGtfsDate(els.dayCalendar.value);
  if (!state.availableDays.includes(selected)) {
    setStatus("No service matching route settings for the selected calendar day.", 0, "error");
    els.dayCalendar.value = gtfsToIsoDate(state.selectedDay);
    updateDayWeekday();
    return;
  }
  state.selectedDay = selected;
  updateDayWeekday();
  saveSettings();
  if (state.settingsDirty) {
    showRefreshNotice();
    return;
  }
  requestRoutes();
});
document.querySelector("#swap-stations-button").addEventListener("click", () => {
  const reuseReverseRoutes = canReuseReverseRoutes();
  [state.config.local_origins, state.config.side_b_destinations] =
    [state.config.side_b_destinations, state.config.local_origins];
  renderStationPickers(state.context?.station_names || [], state.config);
  saveSettings();

  if (reuseReverseRoutes) {
    swapCachedRouteDirections();
    swapContextDirection(state.context);
    worker.postMessage({ type: "swap-config", config: state.config });
    routeDebug("app", "departure and arrival exchanged using cached reverse routes", {
      selectedDay: state.selectedDay,
      outwardCount: state.routes.outward.length,
      returnCount: state.routes.returns.length,
    });
    renderCurrentTab();
    return;
  }

  showRefreshNotice();
});
els.todayBtn.addEventListener("click", () => {
  const today = todayGtfsDate();
  if (!state.availableDays.includes(today)) {
    setStatus("No service matching route settings is available today.", 0, "error");
    return;
  }
  els.dayCalendar.value = gtfsToIsoDate(today);
  els.dayCalendar.dispatchEvent(new Event("change", { bubbles: true }));
});
function selectAdjacentDay(offset) {
  const selectedIndex = state.availableDays.indexOf(state.selectedDay);
  const day = state.availableDays[selectedIndex + offset];
  if (!day) return;
  els.dayCalendar.value = gtfsToIsoDate(day);
  els.dayCalendar.dispatchEvent(new Event("change", { bubbles: true }));
}
els.previousDayBtn.addEventListener("click", () => selectAdjacentDay(-1));
els.nextDayBtn.addEventListener("click", () => selectAdjacentDay(1));
els.timeline.addEventListener("click", (event) => {
  if (event.target.closest("#timeline-load-more")) {
    requestMoreRoutes();
    return;
  }
  const bar = event.target.closest(".timeline-bar.train");
  if (!bar || !bar.dataset.detail) return;
  showDetail(JSON.parse(decodeURIComponent(bar.dataset.detail)), event);
});
els.detailLayer.addEventListener("click", hideDetail);
for (const filter of els.stationFilters) {
  filter.addEventListener("input", () => {
    renderStationPicker(filter.dataset.role, state.context?.station_names || [], state.config, filter.value);
  });
}
els.trainTypeFilter.addEventListener("input", () => {
  renderTrainTypePicker(state.context?.train_types || [], els.trainTypeFilter.value);
});
els.trainTypes.addEventListener("change", (event) => {
  if (event.target instanceof HTMLInputElement) {
    state.config.train_types = syncSetValue(state.config.train_types, event.target);
    saveSettings();
    renderTrainTypePicker(state.context?.train_types || [], els.trainTypeFilter.value);
    showRefreshNotice();
  }
});
for (const [role, container] of [
  ["local_origins", els.localOrigins],
  ["side_b_destinations", els.sideBDestinations],
  ["connection_stations", els.connectionStations],
  ["avoid_stations", els.avoidStations],
]) {
  container.addEventListener("change", (event) => {
    if (event.target instanceof HTMLInputElement) {
      syncStationState(role, event.target);
      saveSettings();
      renderStationPicker(role, state.context?.station_names || [], state.config, document.querySelector(`.station-filter[data-role="${role}"]`)?.value || "");
      showRefreshNotice();
    }
  });
  container.addEventListener("click", (event) => {
    const star = event.target.closest("[data-highlight-station]");
    if (!star) return;
    const station = star.dataset.highlightStation;
    const highlights = new Set(state.highlights);
    if (highlights.has(station)) {
      highlights.delete(station);
    } else {
      highlights.add(station);
    }
    state.highlights = Array.from(highlights).sort();
    saveSettings();
    renderStationPickers(state.context?.station_names || [], state.config);
    if (state.settingsDirty || state.refreshInFlight) {
      renderRefreshNotice();
    } else {
      renderCurrentTab();
    }
  });
}
for (const input of [
  els.minTransfer,
  els.maxTransfer,
  els.maxTransferCount,
  els.maxDuration,
  els.firstDepartureTime,
  els.lastDepartureTime,
  els.firstArrivalTime,
  els.lastArrivalTime,
]) {
  input.addEventListener("change", showRefreshNotice);
}

writeConfig(state.config);
saveSettings();
setTimelinePlaceholder("Checking browser storage for a saved GTFS archive...");
setStatus("Checking browser storage for a saved GTFS archive.", 5, "loading");
setBusy(true);
worker.postMessage({ type: "load-last-source", config: state.config });
