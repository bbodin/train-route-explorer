const routeSettings = document.querySelector(".route-settings-menu");
const dataMenu = document.querySelector(".data-menu");
const viewTabs = document.querySelector("#route-view-tabs");
const timeline = document.querySelector("#routes-time-chart");
const routeSummary = document.querySelector(".route-summary");
const appHeader = document.querySelector(".app-header");
const headerTools = document.querySelector(".header-tools");
const dayControl = document.querySelector(".day-control");
const toolbarMenus = document.querySelector(".toolbar-menus");
const toolbarPrimary = document.querySelector(".toolbar-primary");
const status = document.querySelector("#cache-status");
const statusText = document.querySelector("#cache-status-text");
const aboutLink = document.querySelector(".case-study-link");

const layoutEnhancementStyle = document.createElement("style");
layoutEnhancementStyle.textContent = `
  :root {
    --toolbar-primary-height: 0px;
    --route-summary-height: 48px;
  }

  .app-header {
    display: grid !important;
    grid-template-columns: auto minmax(230px, 1fr) auto !important;
    align-items: center !important;
    gap: 14px !important;
  }

  .app-header > .day-control { justify-self: center; }
  .app-header .day-control input { width: 142px; }
  .header-tools { justify-self: end; gap: 6px !important; }
  .header-tools .view-mode-tabs { width: 108px; flex: 0 0 auto; }
  .header-tools .view-mode-tabs button { min-height: 28px; padding: 3px 8px; font-size: 10px; }
  .header-tools .toolbar-menus { display: flex; gap: 4px; }

  .header-tools .toolbar-menu summary,
  .case-study-link {
    min-height: 32px;
    display: inline-flex;
    align-items: center;
    padding: 5px 9px;
    border: 1px solid #c2c8ca;
    border-radius: 4px;
    background: #f8f8f5;
    color: #525c64;
    font-size: 11px;
    font-weight: 700;
    line-height: 1;
    text-decoration: none;
  }

  .case-study-link:hover {
    border-color: #aeb6ba;
    background: #f0f2ef;
    color: #18202a;
    text-decoration: none;
  }

  .header-tools .toolbar-menu summary::before { display: none; }
  .header-tools .toolbar-menu[open] summary {
    border-color: #28323c;
    background: #28323c;
    color: #fff;
  }

  .status {
    max-width: 116px !important;
    grid-template-columns: 8px minmax(0, 1fr) !important;
    gap: 6px !important;
  }

  #cache-status-text { max-width: 92px; font-size: 10px; }
  .status progress { bottom: -4px !important; }
  .toolbar-primary { display: none !important; }
  .timetable-toolbar { top: var(--header-height) !important; }

  .route-summary {
    min-height: var(--route-summary-height) !important;
    display: grid !important;
    grid-template-columns: minmax(0, 1fr) max-content minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) !important;
    align-items: center !important;
    gap: 8px !important;
    padding: 5px 12px !important;
    border-top: 0 !important;
    overflow: visible !important;
  }

  .route-summary-arrow { display: none !important; }
  .route-swap-button { grid-column: 2; }

  .route-summary-item {
    position: relative;
    min-width: 0;
    display: flex;
    align-items: center;
  }

  .route-summary-item[data-route-item="local_origins"] { justify-content: flex-start; }
  .route-summary-item[data-route-item="side_b_destinations"],
  .route-summary-item[data-route-item="connection_stations"] { justify-content: center; }
  .route-summary-item[data-route-item="avoid_stations"] { justify-content: flex-end; }

  .route-summary-stop {
    width: min(100%, 460px);
    min-width: 0;
    display: flex !important;
    align-items: baseline !important;
    gap: 7px !important;
    border: 1px solid #d9ddda !important;
    border-radius: 5px !important;
    padding: 6px 9px !important;
    background: #fafaf7 !important;
    color: #4f5961 !important;
    white-space: nowrap;
    box-shadow: 0 1px 0 rgba(24, 32, 42, 0.02);
    transition: border-color 130ms ease, background 130ms ease, box-shadow 130ms ease;
  }

  .route-summary-item[data-route-item="side_b_destinations"] .route-summary-stop,
  .route-summary-item[data-route-item="connection_stations"] .route-summary-stop {
    justify-content: center;
    text-align: center;
  }

  .route-summary-item[data-route-item="avoid_stations"] .route-summary-stop {
    justify-content: flex-end;
    text-align: right;
  }

  .route-summary-stop:hover,
  .route-summary-stop[aria-expanded="true"] {
    border-color: #aeb6ba !important;
    background: #fff !important;
    color: #18202a !important;
    box-shadow: 0 1px 2px rgba(24, 32, 42, 0.07);
  }

  .route-summary-stop span {
    flex: 0 0 auto;
    color: #7e878d !important;
    font-size: 9px !important;
    font-weight: 700 !important;
    letter-spacing: 0.08em !important;
  }

  .route-summary-stop strong {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #303a42 !important;
    font-size: 12px !important;
    font-weight: 620 !important;
  }

  .route-summary-stop::after {
    content: "▾" !important;
    display: inline-block !important;
    flex: 0 0 auto;
    margin-left: 1px;
    color: #8e969b;
    font-size: 9px;
    transform: translateY(-1px);
  }

  .route-summary-stop[aria-expanded="true"]::after { transform: rotate(180deg) translateY(1px); }

  .route-selector-panel {
    position: absolute;
    top: calc(100% + 5px);
    z-index: 45;
    width: min(360px, calc(100vw - 28px));
    max-height: min(460px, calc(100vh - var(--header-height) - var(--route-summary-height) - 30px));
    overflow: auto;
    padding: 8px;
    border: 1px solid #c7cdca;
    background: #fffef9;
    box-shadow: 0 12px 28px rgba(24, 32, 42, 0.16);
  }

  .route-summary-item[data-route-item="local_origins"] .route-selector-panel { left: 0; }
  .route-summary-item[data-route-item="side_b_destinations"] .route-selector-panel,
  .route-summary-item[data-route-item="connection_stations"] .route-selector-panel {
    left: 50%;
    transform: translateX(-50%);
  }
  .route-summary-item[data-route-item="avoid_stations"] .route-selector-panel { right: 0; }
  .route-selector-panel[hidden] { display: none; }

  .route-selector-panel .station-picker {
    margin: 0;
    border: 0;
    padding: 0;
    background: transparent;
  }

  .route-selector-panel .station-picker legend {
    padding: 0 0 7px;
    color: #5f6970;
    font-size: 11px;
    font-weight: 700;
  }

  .route-selector-panel .station-checklist {
    height: 260px;
    max-height: min(260px, 45vh);
  }

  .route-settings-panel .drawer-hint { display: none; }

  .timeline {
    height: calc(100vh - var(--header-height) - var(--route-summary-height) - 18px);
    min-height: 320px;
    overflow: auto;
    overscroll-behavior: contain;
    scrollbar-gutter: stable;
    padding-top: 0 !important;
  }

  .timeline-empty { min-height: calc(100% - 10px); }

  .timeline-sticky-head {
    position: sticky;
    top: 0;
    z-index: 14;
    min-width: calc(var(--timeline-label-width) + var(--timeline-lane-min-width));
    margin: 0;
    background: var(--paper);
    box-shadow: 0 1px 0 #cdd2cf;
  }

  .timeline-sticky-meta {
    display: grid;
    grid-template-columns: var(--timeline-label-width) minmax(var(--timeline-lane-min-width), 1fr);
    align-items: center;
    min-width: calc(var(--timeline-label-width) + var(--timeline-lane-min-width));
    min-height: 30px;
    margin: 0;
    background: var(--paper);
  }

  .timeline-sticky-meta .timeline-legend {
    grid-column: 2;
    margin: 0 !important;
    min-width: 0 !important;
    min-height: 30px !important;
    padding: 3px 0 3px 12px !important;
    background: var(--paper);
  }

  .timeline-sticky-head .timeline-scale {
    margin-top: 0 !important;
    background: var(--paper);
  }

  .timeline-label-duration {
    min-width: 52px !important;
    font-size: 13px !important;
    font-weight: 760 !important;
    letter-spacing: -0.01em;
  }

  .timeline-label-duration strong { font-weight: 800; }

  @media (max-width: 900px) {
    :root {
      --header-height: 86px;
      --toolbar-primary-height: 0px;
      --route-summary-height: 48px;
    }

    .app-header {
      grid-template-columns: auto 1fr !important;
      grid-template-areas: "brand tools" "date date";
      gap: 4px 8px !important;
      padding: 6px 10px !important;
    }

    .brand { grid-area: brand; }
    .app-header > .day-control {
      grid-area: date;
      justify-self: center;
      width: min(100%, 330px);
    }

    .header-tools { grid-area: tools; }
    .header-tools .view-mode-tabs { width: 82px; }
    .header-tools .view-mode-tabs button { padding-inline: 4px; font-size: 9px; }
    .status { max-width: 22px !important; grid-template-columns: 8px !important; }
    #cache-status-text { display: none; }
    .status progress { display: none; }

    .header-tools .toolbar-menu summary,
    .case-study-link { padding-inline: 7px; }

    .route-summary {
      gap: 4px !important;
      padding-inline: 7px !important;
    }

    .route-summary-stop {
      gap: 4px !important;
      padding: 6px !important;
    }

    .route-summary-stop span { display: none !important; }
    .route-summary-stop strong { font-size: 11px !important; }

    .route-selector-panel {
      position: fixed;
      top: calc(var(--header-height) + var(--route-summary-height));
      left: 8px !important;
      right: 8px !important;
      width: auto;
      max-height: calc(100vh - var(--header-height) - var(--route-summary-height) - 8px);
      transform: none !important;
    }

    .timeline {
      height: calc(100vh - var(--header-height) - var(--route-summary-height));
      min-height: 300px;
    }

  }

  @media (max-width: 560px) {
    :root {
      --header-height: 84px;
      --route-summary-height: 80px;
    }

    .app-header {
      height: var(--header-height);
      grid-template-columns: minmax(0, 1fr) 92px !important;
      grid-template-areas: "brand brand" "date view";
      grid-template-rows: 28px 36px;
      gap: 6px 8px !important;
      align-content: start;
      padding: 10px 10px 4px !important;
    }

    .brand-rail { display: none; }
    .brand {
      grid-area: brand;
      min-width: 0;
      max-width: calc(100% - 142px);
      width: max-content;
      justify-self: start;
      align-self: center;
    }
    .brand > span:last-child { display: block; }
    .brand small { display: none; }
    .brand strong { font-size: 13px; white-space: nowrap; }
    .brand .app-version { color: #59636b !important; font-size: 10px !important; }

    .header-tools {
      position: absolute;
      top: 10px;
      right: 10px;
      display: flex !important;
      align-items: center;
      gap: 4px !important;
    }

    .app-header > #route-view-tabs {
      grid-area: view;
      justify-self: stretch;
      align-self: center;
      width: 92px;
    }

    .header-tools .toolbar-menus {
      display: flex;
      gap: 4px;
    }

    .app-header .status {
      max-width: 12px !important;
      grid-template-columns: 8px !important;
      gap: 0 !important;
    }

    #cache-status-text { display: none; }
    .status progress { display: none; }

    .header-tools .toolbar-menu summary,
    .case-study-link {
      min-height: 28px;
      padding: 4px 6px;
      font-size: 10px;
    }

    .app-header > .day-control {
      grid-area: date;
      justify-self: stretch;
      width: 100%;
      min-width: 0;
    }

    .app-header .day-calendar-selector {
      flex: 1 1 auto;
      min-width: 0;
    }

    .app-header .day-control input { width: 100%; min-width: 0; }
    .app-header .day-control button {
      min-height: 32px;
      padding-inline: 8px;
    }
    .app-header .day-control .day-arrow {
      min-width: 30px;
      padding-inline: 6px;
    }

    .route-summary {
      grid-template-columns: repeat(6, minmax(0, 1fr)) !important;
      grid-template-areas:
        "depart depart swap swap arrival arrival"
        "via via via avoid avoid avoid";
      gap: 4px 6px !important;
      padding: 4px 8px !important;
      align-content: center;
    }

    .route-summary-item[data-route-item="local_origins"] { grid-area: depart; }
    .route-summary-item[data-route-item="side_b_destinations"] { grid-area: arrival; }
    .route-summary-item[data-route-item="connection_stations"] { grid-area: via; }
    .route-summary-item[data-route-item="avoid_stations"] { grid-area: avoid; }
    .route-summary-item { justify-content: stretch !important; }

    .route-summary-item .route-summary-stop {
      width: 100%;
      min-height: 34px;
      justify-content: flex-start !important;
      text-align: left !important;
      padding-inline: 7px !important;
    }

    .route-summary-stop span {
      display: inline !important;
      font-size: 8px !important;
    }

    .route-summary-stop strong { font-size: 10px !important; }

    .route-selector-panel {
      top: var(--header-height);
      max-height: calc(100vh - var(--header-height) - 8px);
    }

    .route-swap-button {
      grid-area: swap;
      justify-self: center;
      align-self: stretch;
      width: 74px;
      height: 34px;
      min-width: 0;
      padding-inline: 5px;
    }
  }

  @media (max-width: 350px) {
    .app-header {
      grid-template-columns: minmax(0, 1fr) 84px !important;
      padding-inline: 8px !important;
      gap: 6px 6px !important;
    }

    .brand strong { font-size: 12px; }
    .brand .app-version { display: none; }

    .header-tools { right: 8px; gap: 3px !important; }
    .header-tools .toolbar-menus { gap: 3px; }
    .header-tools .toolbar-menu summary,
    .case-study-link {
      padding-inline: 5px;
      font-size: 9px;
    }

    .app-header > #route-view-tabs { width: 84px; }
    .route-summary { gap: 4px !important; padding-inline: 6px !important; }
    .route-swap-button { width: 68px; font-size: 10px; }
  }
`;
document.head.append(layoutEnhancementStyle);

const mobileHeaderQuery = window.matchMedia("(max-width: 560px)");

function placeViewTabs() {
  if (!viewTabs || !appHeader || !headerTools) return;
  if (mobileHeaderQuery.matches) {
    if (viewTabs.parentElement !== appHeader) appHeader.insertBefore(viewTabs, headerTools);
  } else if (viewTabs.parentElement !== headerTools) {
    headerTools.insertBefore(viewTabs, status || headerTools.firstChild);
  }
}

function reorganizeHeader() {
  if (!appHeader || !headerTools) return;

  if (dayControl && dayControl.parentElement !== appHeader) {
    appHeader.insertBefore(dayControl, headerTools);
  }

  placeViewTabs();

  if (toolbarMenus && toolbarMenus.parentElement !== headerTools) {
    headerTools.insertBefore(toolbarMenus, aboutLink || null);
  }

  if (routeSettings) {
    const summary = routeSettings.querySelector(":scope > summary");
    if (summary) summary.textContent = "Config";
  }

  if (toolbarPrimary) toolbarPrimary.setAttribute("aria-hidden", "true");
}

let compactingStatus = false;
const compactStatusLabels = new Set(["GTFS ready", "Loading GTFS", "No data", "GTFS error"]);

function compactCacheStatus() {
  if (!status || !statusText || compactingStatus) return;
  const fullText = statusText.textContent.trim();
  if (!fullText || compactStatusLabels.has(fullText)) return;

  statusText.title = fullText;
  const compactText = status.classList.contains("ready")
    ? "GTFS ready"
    : status.classList.contains("error")
      ? "GTFS error"
      : status.classList.contains("loading")
        ? "Loading GTFS"
        : "No data";

  compactingStatus = true;
  statusText.textContent = compactText;
  queueMicrotask(() => { compactingStatus = false; });
}

function selectedStationNames(role) {
  return Array.from(
    document.querySelectorAll(`.station-picker[data-role="${role}"] input[type="checkbox"]:checked`),
    (input) => input.value,
  );
}

function compactStationNames(values) {
  if (!values.length) return "None";
  if (values.length <= 2) return values.join(" / ");
  return `${values[0]} / ${values[1]} +${values.length - 2}`;
}

function updateRouteSummary() {
  for (const value of document.querySelectorAll("[data-route-value]")) {
    value.textContent = compactStationNames(selectedStationNames(value.dataset.routeValue));
  }
}

function closeRouteSelectors(exceptRole = null) {
  for (const item of document.querySelectorAll(".route-summary-item")) {
    if (item.dataset.routeItem === exceptRole) continue;
    const panel = item.querySelector(".route-selector-panel");
    const button = item.querySelector("[data-route-role]");
    if (panel) panel.hidden = true;
    if (button) button.setAttribute("aria-expanded", "false");
  }
}

function toggleRouteSelector(role) {
  const item = document.querySelector(`.route-summary-item[data-route-item="${role}"]`);
  if (!item) return;
  const panel = item.querySelector(".route-selector-panel");
  const button = item.querySelector("[data-route-role]");
  if (!panel || !button) return;

  const shouldOpen = panel.hidden;
  closeRouteSelectors(role);
  if (routeSettings) routeSettings.open = false;
  if (dataMenu) dataMenu.open = false;
  panel.hidden = !shouldOpen;
  button.setAttribute("aria-expanded", String(shouldOpen));

  if (shouldOpen) {
    requestAnimationFrame(() => panel.querySelector(".station-filter")?.focus({ preventScroll: true }));
  }
}

function installInlineRouteSelectors() {
  if (!routeSummary) return;

  for (const button of Array.from(routeSummary.querySelectorAll("[data-route-role]"))) {
    const role = button.dataset.routeRole;
    const picker = document.querySelector(`.station-picker[data-role="${role}"]`);
    if (!picker || button.closest(".route-summary-item")) continue;

    const item = document.createElement("div");
    item.className = "route-summary-item";
    item.dataset.routeItem = role;
    button.before(item);
    item.append(button);

    const panel = document.createElement("div");
    panel.className = "route-selector-panel";
    panel.hidden = true;
    panel.setAttribute("role", "group");
    panel.setAttribute("aria-label", picker.querySelector("legend")?.textContent || "Station selection");
    item.append(panel);
    panel.append(picker);

    button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", () => toggleRouteSelector(role));
    picker.addEventListener("change", updateRouteSummary);
    new MutationObserver(updateRouteSummary).observe(picker, { childList: true, subtree: true });
  }

  const routeHeading = document.querySelector(".route-settings-panel .drawer-heading h2");
  const routeKicker = document.querySelector(".route-settings-panel .drawer-kicker");
  if (routeHeading) routeHeading.textContent = "Services & constraints";
  if (routeKicker) routeKicker.textContent = "Journey options";
}

function parseDurationMinutes(text) {
  const match = String(text || "").match(/(?:(\d+)h)?(\d+)(?:m)?/);
  if (!match) return Number.NaN;
  return Number(match[1] || 0) * 60 + Number(match[2]);
}

function colorTripDurations() {
  if (!timeline) return;
  const entries = Array.from(timeline.querySelectorAll(".timeline-label-duration"))
    .map((element) => ({ element, minutes: parseDurationMinutes(element.textContent) }))
    .filter((entry) => Number.isFinite(entry.minutes));
  if (!entries.length) return;

  const sortedDurations = entries.map((entry) => entry.minutes).sort((left, right) => left - right);
  const greenMax = sortedDurations[Math.max(0, Math.ceil(sortedDurations.length * 0.2) - 1)];
  const redMin = sortedDurations[Math.min(sortedDurations.length - 1, Math.floor(sortedDurations.length * 0.5))];

  for (const entry of entries) {
    const band = entry.minutes <= greenMax ? "good" : entry.minutes >= redMin ? "bad" : "middle";
    entry.element.dataset.durationBand = band;
    entry.element.style.color = band === "good" ? "#15803d" : band === "bad" ? "#b91c1c" : "#c2410c";
  }
}

function ensureStickyTimelineHeader() {
  if (!timeline) return;
  const existingHead = timeline.querySelector(":scope > .timeline-sticky-head");
  if (existingHead) return;

  const legend = timeline.querySelector(":scope > .timeline-legend");
  const scale = timeline.querySelector(":scope > .timeline-scale");
  if (!legend || !scale) return;

  const stickyHead = document.createElement("div");
  stickyHead.className = "timeline-sticky-head";
  const meta = document.createElement("div");
  meta.className = "timeline-sticky-meta";

  timeline.insertBefore(stickyHead, legend);
  stickyHead.append(meta);
  meta.append(legend);
  stickyHead.append(scale);
}

let timelineEnhancementFrame = null;
function scheduleTimelineEnhancements() {
  if (timelineEnhancementFrame !== null) return;
  timelineEnhancementFrame = requestAnimationFrame(() => {
    timelineEnhancementFrame = null;
    ensureStickyTimelineHeader();
    colorTripDurations();
  });
}

for (const menu of document.querySelectorAll(".toolbar-menu")) {
  menu.addEventListener("toggle", () => {
    if (!menu.open) return;
    closeRouteSelectors();
    for (const other of document.querySelectorAll(".toolbar-menu")) {
      if (other !== menu) other.open = false;
    }
  });
}

document.addEventListener("click", (event) => {
  if (!event.target.closest(".route-summary-item")) closeRouteSelectors();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeRouteSelectors();
});

if (timeline) {
  new MutationObserver(scheduleTimelineEnhancements).observe(timeline, {
    childList: true,
    subtree: true,
  });
}

if (status) {
  new MutationObserver(compactCacheStatus).observe(status, {
    attributes: true,
    childList: true,
    subtree: true,
    attributeFilter: ["class"],
  });
}

mobileHeaderQuery.addEventListener("change", placeViewTabs);
reorganizeHeader();
installInlineRouteSelectors();
updateRouteSummary();
compactCacheStatus();
syncDirectionPressedState();
scheduleTimelineEnhancements();
