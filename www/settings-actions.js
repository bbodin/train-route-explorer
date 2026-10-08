import { app } from "./app.js?v=0.16";

const settingsMenu = document.querySelector(".route-settings-menu");
const settingsPanel = document.querySelector(".route-settings-panel");
const trainTypeFilter = document.querySelector("#train-type-filter");
const minTransfer = document.querySelector("#config-min-transfer");
const maxTransfer = document.querySelector("#config-max-transfer");
const maxTransferCount = document.querySelector("#config-max-transfer-count");
const maxDuration = document.querySelector("#config-max-duration");
const firstDepartureTime = document.querySelector("#config-first-departure-time");
const lastDepartureTime = document.querySelector("#config-last-departure-time");
const firstArrivalTime = document.querySelector("#config-first-arrival-time");
const lastArrivalTime = document.querySelector("#config-last-arrival-time");

const settingsActionStyle = document.createElement("style");
settingsActionStyle.textContent = `
  .settings-draft-actions {
    position: sticky;
    bottom: -18px;
    z-index: 6;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin: 18px -18px -18px;
    padding: 10px 18px 18px;
    border-top: 1px solid #d1d6d3;
    background: #f7f7f3;
  }

  .settings-draft-actions button {
    min-height: 36px;
    font-size: 11px;
    font-weight: 800;
  }

  .settings-draft-cancel {
    border-color: #c5cbc8;
    background: #fff;
    color: #59636a;
  }

  .settings-draft-apply {
    border-color: #27323c;
    background: #27323c;
    color: #fff;
  }

  .settings-draft-apply:hover {
    background: #18222b;
    color: #fff;
  }

  @media (max-width: 900px) {
    .settings-draft-actions button {
      min-height: 44px;
      font-size: 12px;
    }
  }
`;
document.head.append(settingsActionStyle);

let settingsSnapshot = null;

function copySettings(config) {
  return {
    train_types: [...(config.train_types || [])],
    min_transfer_minutes: Number(config.min_transfer_minutes),
    max_transfer_minutes: Number(config.max_transfer_minutes),
    max_transfer_count: Number(config.max_transfer_count),
    max_journey_duration_minutes: Number(config.max_journey_duration_minutes),
    first_departure_time: String(config.first_departure_time || ""),
    last_departure_time: String(config.last_departure_time || ""),
    first_arrival_time: String(config.first_arrival_time || ""),
    last_arrival_time: String(config.last_arrival_time || ""),
  };
}

function currentSettings() {
  return copySettings(app.readConfig());
}

function sameSettings(left, right) {
  return left.train_types.length === right.train_types.length
    && left.train_types.every((value, index) => value === right.train_types[index])
    && left.min_transfer_minutes === right.min_transfer_minutes
    && left.max_transfer_minutes === right.max_transfer_minutes
    && left.max_transfer_count === right.max_transfer_count
    && left.max_journey_duration_minutes === right.max_journey_duration_minutes
    && left.first_departure_time === right.first_departure_time
    && left.last_departure_time === right.last_departure_time
    && left.first_arrival_time === right.first_arrival_time
    && left.last_arrival_time === right.last_arrival_time;
}

function restoreSnapshot(snapshot) {
  app.state.config.train_types = [...snapshot.train_types];
  minTransfer.value = String(snapshot.min_transfer_minutes);
  maxTransfer.value = String(snapshot.max_transfer_minutes);
  maxTransferCount.value = String(snapshot.max_transfer_count);
  maxDuration.value = String(snapshot.max_journey_duration_minutes);
  firstDepartureTime.value = snapshot.first_departure_time;
  lastDepartureTime.value = snapshot.last_departure_time;
  firstArrivalTime.value = snapshot.first_arrival_time;
  lastArrivalTime.value = snapshot.last_arrival_time;
  app.renderTrainTypePicker(app.state.context?.train_types || [], trainTypeFilter?.value || "");
  app.saveSettings();
}

function beginSettingsEdit() {
  if (settingsSnapshot) return;
  settingsSnapshot = currentSettings();
}

function cancelSettingsEdit(close = true) {
  if (!settingsSnapshot) return;
  const snapshot = settingsSnapshot;
  settingsSnapshot = null;
  restoreSnapshot(snapshot);
  if (close && settingsMenu) settingsMenu.open = false;
}

function applySettingsEdit() {
  if (!settingsSnapshot) return;
  const previous = settingsSnapshot;
  const next = currentSettings();
  settingsSnapshot = null;

  app.state.config = {
    ...app.state.config,
    ...next,
    train_types: [...next.train_types],
  };
  app.saveSettings();
  if (settingsMenu) settingsMenu.open = false;

  if (!sameSettings(previous, next)) app.showRefreshNotice();
}

function installSettingsActions() {
  if (!settingsPanel || settingsPanel.querySelector(":scope > .settings-draft-actions")) return;

  const actions = document.createElement("div");
  actions.className = "settings-draft-actions";

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "settings-draft-cancel";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", (event) => {
    event.preventDefault();
    cancelSettingsEdit();
  });

  const apply = document.createElement("button");
  apply.type = "button";
  apply.className = "settings-draft-apply";
  apply.textContent = "Apply";
  apply.addEventListener("click", (event) => {
    event.preventDefault();
    applySettingsEdit();
  });

  actions.append(cancel, apply);
  settingsPanel.append(actions);
}

settingsMenu?.addEventListener("toggle", () => {
  if (settingsMenu.open) {
    beginSettingsEdit();
  } else if (settingsSnapshot) {
    // Closing the drawer without Apply has the same semantics as Cancel.
    cancelSettingsEdit(false);
  }
});

document.addEventListener("change", (event) => {
  if (!settingsSnapshot || !settingsPanel?.contains(event.target)) return;
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;

  if (input.closest("#config-train-types") && input.type === "checkbox") {
    app.state.config.train_types = app.syncSetValue(app.state.config.train_types, input);
    event.stopPropagation();
    return;
  }

  if ([
    minTransfer,
    maxTransfer,
    maxTransferCount,
    maxDuration,
    firstDepartureTime,
    lastDepartureTime,
    firstArrivalTime,
    lastArrivalTime,
  ].includes(input)) {
    // Keep numeric changes in the form until Apply; prevent app-events.js from
    // starting an expensive route/context refresh for each individual change.
    event.stopPropagation();
  }
}, true);

installSettingsActions();
if (settingsMenu?.open) beginSettingsEdit();
