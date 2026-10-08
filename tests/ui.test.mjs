import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const TEST_URL = process.env.TEST_URL || "http://localhost:8080/";
const CHROME = process.env.CHROME || "google-chrome";
const DEBUG_PORT = Number(process.env.DEBUG_PORT || 9333);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(fn, { timeoutMs = 90_000, intervalMs = 250, message = "condition" } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${message}${lastError ? `: ${lastError.message}` : ""}`);
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      const data = JSON.parse(event.data);
      if (!data.id) return;
      const pending = this.pending.get(data.id);
      if (!pending) return;
      this.pending.delete(data.id);
      if (data.error) {
        pending.reject(new Error(data.error.message));
      } else {
        pending.resolve(data.result);
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  async eval(expression, awaitPromise = false) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || "Runtime evaluation failed");
    }
    return result.result.value;
  }

  close() {
    this.ws.close();
  }
}

async function launchChrome() {
  const profile = await mkdtemp(join(tmpdir(), "train-route-explorer-ui-"));
  const chrome = spawn(CHROME, [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profile}`,
    TEST_URL,
  ], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  chrome.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  await waitFor(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      return response.ok;
    } catch {
      return false;
    }
  }, { timeoutMs: 15_000, message: "Chrome DevTools endpoint" });

  const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
  const page = targets.find((target) => target.type === "page");
  assert(page?.webSocketDebuggerUrl, `No Chrome page target found. Chrome stderr:\n${stderr}`);

  return {
    profile,
    chrome,
    client: new CdpClient(page.webSocketDebuggerUrl),
    async cleanup() {
      if (!chrome.killed) {
        chrome.kill("SIGTERM");
      }
      await Promise.race([
        new Promise((resolve) => chrome.once("exit", resolve)),
        sleep(2_000),
      ]);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
          return;
        } catch (error) {
          if (attempt === 4) throw error;
          await sleep(200);
        }
      }
    },
  };
}

async function main() {
  const browser = await launchChrome();
  const page = browser.client;
  await page.connect();

  try {
    await page.send("Runtime.enable");
    await page.send("Page.enable");
    await page.send("Page.navigate", { url: TEST_URL });
    await waitFor(async () => page.eval(`document.readyState === "complete" && document.querySelector(".brand strong")?.textContent === "Train Route Explorer"`), {
      timeoutMs: 15_000,
      message: "application page to load",
    });

    assert(await page.eval(`document.querySelector(".brand strong")?.textContent`) === "Train Route Explorer", "Page header should render");
    assert(await page.eval(`document.querySelector("#config-apply") === null`), "Old apply route settings button should not render");
    assert(await page.eval(`document.querySelector(".day-control #day-calendar")?.id === "day-calendar"`), "Day selector should render in the day controls");
    assert(await page.eval(`document.querySelector("#previous-day-button")?.getAttribute("aria-label")`) === "Previous service day", "Previous-day arrow should render beside the day selector");
    assert(await page.eval(`document.querySelector("#today-button")?.textContent`) === "Today", "Today button should render beside the day selector");
    assert(await page.eval(`document.querySelector("#next-day-button")?.getAttribute("aria-label")`) === "Next service day", "Next-day arrow should render beside Today");
    assert(await page.eval(`Array.from(document.querySelectorAll(".input-unit")).map((node) => node.textContent).join(",")`) === "minutes,minutes,transfers,minutes", "Every numeric time setting should show its unit");
    assert(await page.eval(`Array.from(document.querySelectorAll(".time-config-panel > label")).map((label) => label.firstChild.textContent.trim()).join("|")`) === "Minimum transfer time|Maximum transfer time|Maximum transfers|Maximum journey duration", "Time setting labels should use explicit duration terminology");
    assert(await page.eval(`Array.from(document.querySelectorAll(".input-with-unit input")).every((input) => input.getBoundingClientRect().width <= 100)`) === true, "Numeric settings should use compact text boxes");
    assert(await page.eval(`document.querySelector('[data-role="local_origins"] legend')?.textContent`) === "Departure stations", "Departure station list should use departure terminology");
    assert(await page.eval(`document.querySelector('[data-role="side_b_destinations"] legend')?.textContent`) === "Arrival stations", "Arrival station list should use arrival terminology");
    assert(await page.eval(`document.querySelector("#route-direction-tabs") === null`), "Journey direction toggle should be removed from the interface");
    assert(await page.eval(`Array.from(document.querySelectorAll("#route-view-tabs button")).map((button) => button.textContent).join("|")`) === "Time|Map", "View switch should expose Time and Map modes");

    await page.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    const mobileViewToggle = await page.eval(`(() => {
      const day = document.querySelector(".day-control").getBoundingClientRect();
      const toggle = document.querySelector("#route-view-tabs").getBoundingClientRect();
      const slider = document.querySelector("#route-view-tabs");
      const timeButton = document.querySelector('#route-view-tabs [data-view="time"]');
      const mapButton = document.querySelector('#route-view-tabs [data-view="map"]');
      const beforeTransform = getComputedStyle(slider, "::before").transform;
      const selectedMarkerDisplay = getComputedStyle(timeButton, "::after").display;

      timeButton.click();
      const afterTimeClick = {
        mapPressed: mapButton.getAttribute("aria-pressed"),
        timePressed: timeButton.getAttribute("aria-pressed"),
        transform: getComputedStyle(slider, "::before").transform,
      };

      mapButton.click();
      const afterMapClick = {
        mapPressed: mapButton.getAttribute("aria-pressed"),
        timePressed: timeButton.getAttribute("aria-pressed"),
      };

      mapButton.click();
      const afterInactiveMapClick = {
        mapPressed: mapButton.getAttribute("aria-pressed"),
        timePressed: timeButton.getAttribute("aria-pressed"),
      };

      mapButton.click();

      return {
        sameRow: Math.abs((day.top + day.height / 2) - (toggle.top + toggle.height / 2)) < 6,
        toggleToRight: toggle.left > day.left,
        withinViewport: toggle.right <= window.innerWidth,
        beforeTransform,
        selectedMarkerDisplay,
        afterTimeClick,
        afterMapClick,
        afterInactiveMapClick,
        finalMapPressed: mapButton.getAttribute("aria-pressed"),
        finalTimePressed: timeButton.getAttribute("aria-pressed"),
      };
    })()`);
    assert(mobileViewToggle.sameRow && mobileViewToggle.toggleToRight && mobileViewToggle.withinViewport, "Mobile Time/Map toggle should sit beside the date controls");
    assert(mobileViewToggle.selectedMarkerDisplay === "none", "Time/Map toggle should not show a yellow selected dot");
    assert(mobileViewToggle.afterTimeClick.mapPressed === "true" && mobileViewToggle.afterTimeClick.timePressed === "false", "Clicking the selected Time side should switch to Map");
    assert(mobileViewToggle.beforeTransform !== mobileViewToggle.afterTimeClick.transform, "View toggle indicator should slide to the selected side");
    assert(mobileViewToggle.afterMapClick.mapPressed === "false" && mobileViewToggle.afterMapClick.timePressed === "true", "Clicking the selected Map side should switch to Time");
    assert(mobileViewToggle.afterInactiveMapClick.mapPressed === "true" && mobileViewToggle.afterInactiveMapClick.timePressed === "false", "Clicking either side should toggle the Time/Map switch");
    assert(mobileViewToggle.finalMapPressed === "false" && mobileViewToggle.finalTimePressed === "true", "Time/Map toggle should finish restored to Time");
    for (const width of [390, 320]) {
      await page.send("Emulation.setDeviceMetricsOverride", {
        width, height: 844, deviceScaleFactor: 1, mobile: true,
      });
      const layout = await page.eval(`(() => {
        const selectors = [".brand", ".day-control", "#route-view-tabs", ".header-tools", ".route-summary-item[data-route-item='local_origins']", ".route-summary-item[data-route-item='side_b_destinations']", ".route-summary-item[data-route-item='connection_stations']", ".route-summary-item[data-route-item='avoid_stations']", "#swap-stations-button"];
        const boxes = selectors.map((selector) => document.querySelector(selector).getBoundingClientRect());
        const departure = document.querySelector('[data-route-role="local_origins"]').getBoundingClientRect();
        const arrival = document.querySelector('[data-route-role="side_b_destinations"]').getBoundingClientRect();
        const via = document.querySelector('[data-route-role="connection_stations"]').getBoundingClientRect();
        const avoid = document.querySelector('[data-route-role="avoid_stations"]').getBoundingClientRect();
        const swap = document.querySelector('#swap-stations-button').getBoundingClientRect();
        const brand = document.querySelector('.brand').getBoundingClientRect();
        const headerTools = document.querySelector('.header-tools').getBoundingClientRect();
        const day = document.querySelector('.day-control').getBoundingClientRect();
        const view = document.querySelector('#route-view-tabs').getBoundingClientRect();
        const appHeader = document.querySelector('.app-header');
        const version = document.querySelector('.app-version').getBoundingClientRect();
        const overlaps = boxes.flatMap((a, i) => boxes.slice(i + 1).filter((b) =>
          Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
          Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
        ).map(() => selectors[i]));
        const sameRow = (left, right) => Math.abs((left.top + left.bottom) / 2 - (right.top + right.bottom) / 2) < 2;
        return {
          overlaps,
          clipped: boxes.some((box) => box.left < -1 || box.right > innerWidth + 1),
          labelsVisible: [...document.querySelectorAll('.route-summary-stop span')].every((label) => getComputedStyle(label).display !== 'none'),
          sameHeight: Math.abs(departure.height - arrival.height) < 1 && Math.abs(departure.height - swap.height) < 1,
          titleActionsRow: sameRow(brand, headerTools),
          dateViewRow: sameRow(day, view),
          primaryRouteRow: sameRow(departure, swap) && sameRow(swap, arrival),
          secondaryRouteRow: sameRow(via, avoid) && via.top > departure.bottom,
          configLabel: document.querySelector('.route-settings-menu > summary')?.textContent?.trim(),
          topPadding: parseFloat(getComputedStyle(appHeader).paddingTop),
          versionVisible: width < 350 || (version.width > 0 && version.left >= 0 && version.right <= innerWidth),
        };
      })()`);
      assert(
        !layout.clipped &&
        !layout.overlaps.length &&
        layout.labelsVisible &&
        layout.sameHeight &&
        layout.titleActionsRow &&
        layout.dateViewRow &&
        layout.primaryRouteRow &&
        layout.secondaryRouteRow &&
        layout.configLabel === "Config" &&
        layout.topPadding >= 14 &&
        layout.versionVisible,
        `Mobile header and route controls should follow the compact four-row layout at ${width}px: ${JSON.stringify(layout)}`
      );
    }
    await page.send("Emulation.clearDeviceMetricsOverride");
    assert(await page.eval(`document.querySelector("#highlight-stations") === null`), "Separate Highlights panel should not render");
    assert(await page.eval(`document.querySelector("#swap-stations-button")?.textContent === "<- Swap ->"`), "Swap button should have the requested directional label");
    const beforeSwap = await page.eval(`JSON.stringify(JSON.parse(localStorage.getItem("train-route-explorer-settings-v1")).config)`);
    await page.eval(`document.querySelector("#swap-stations-button").click()`);
    const afterSwap = await page.eval(`JSON.stringify(JSON.parse(localStorage.getItem("train-route-explorer-settings-v1")).config)`);
    const beforeConfig = JSON.parse(beforeSwap);
    const afterConfig = JSON.parse(afterSwap);
    assert(JSON.stringify(afterConfig.local_origins) === JSON.stringify(beforeConfig.side_b_destinations), "Exchange should set departure stations to the former arrival stations");
    assert(JSON.stringify(afterConfig.side_b_destinations) === JSON.stringify(beforeConfig.local_origins), "Exchange should set arrival stations to the former departure stations");
    assert(JSON.stringify(afterConfig.connection_stations) === JSON.stringify(beforeConfig.connection_stations), "Exchange should preserve via stations");
    await page.eval(`document.querySelector("#swap-stations-button").click()`);
    assert(await page.eval(`!Object.hasOwn(JSON.parse(localStorage.getItem("train-route-explorer-settings-v1")), "selectedDay")`), "Selected date should not be stored");


    if (process.env.SORTING_ONLY === "1") {
      await page.eval(`(() => {
        const row = (id, time, duration) => '<div class="timeline-row" data-test-id="' + id + '"><span class="timeline-label-time">' + time + '</span><span class="timeline-label-duration">(' + duration + 'm)</span></div>';
        document.querySelector("#routes-time-chart").innerHTML =
          '<div class="timeline-scale"><span style="left:0%">06:00</span><span style="left:50%">08:00</span></div>' +
          '<div class="timeline-grid-lines"><span style="left:0%"></span><span style="left:50%"></span></div>' +
          '<section class="timeline-day-group">' + row("a", "09:00", 90) + row("b", "07:00", 120) + '</section>' +
          '<section class="timeline-day-group">' + row("c", "10:00", 30) + row("d", "08:00", 75) + '</section>';
      })()`);
      await waitFor(async () => page.eval(`Boolean(document.querySelector('[data-timeline-sort="time"]'))`), { message: "sort controls" });
      const order = () => page.eval(`Array.from(document.querySelectorAll(".timeline-day-group"), (group) => Array.from(group.querySelectorAll(":scope > .timeline-row"), (row) => row.dataset.testId).join("")).join("|")`);
      await page.eval(`document.querySelector('[data-timeline-sort="time"]').click()`);
      assert(await order() === "ba|dc", "Time ascending should sort every day independently");
      await page.eval(`document.querySelector('[data-timeline-sort="time"]').click()`);
      assert(await order() === "ab|cd", "Time descending should sort every day independently");
      await page.eval(`document.querySelector('[data-timeline-sort="duration"]').click()`);
      assert(await order() === "ab|cd", "Duration ascending should sort every day independently");
      console.log("Grouped timeline sorting browser test passed");
      return;
    }

    await page.eval(`document.querySelector("#load-bundled").click()`);
    await waitFor(async () => {
      const status = await page.eval(`({
        text: document.querySelector("#cache-status-text")?.textContent || "",
        isError: document.querySelector("#cache-status")?.classList.contains("error") || false
      })`);
      if (status.isError) throw new Error(status.text);
      return status.text.includes("Cache ready");
    }, {
      timeoutMs: 120_000,
      message: "GTFS context to be ready",
    });

    await page.send("Page.reload", { ignoreCache: true });
    await waitFor(async () => page.eval(`document.readyState === "complete"`), {
      timeoutMs: 15_000,
      message: "application reload after storing GTFS",
    });
    await waitFor(async () => {
      const startup = await page.eval(`({
        contextReady: Boolean(document.querySelector("#config-local-origins input[type='checkbox']")),
        dateEnabled: !document.querySelector("#day-calendar")?.disabled,
        status: document.querySelector("#cache-status-text")?.textContent || "",
        isError: document.querySelector("#cache-status")?.classList.contains("error") || false
      })`);
      if (startup.isError) throw new Error(startup.status);
      return startup.contextReady && startup.dateEnabled;
    }, {
      timeoutMs: 30_000,
      message: "saved GTFS source to auto-load from IndexedDB after reload",
    });

    const loadedCounts = await page.eval(`({
      stationCount: document.querySelectorAll("#config-local-origins input[type='checkbox']").length,
      trainTypeCount: document.querySelectorAll("#config-train-types input[type='checkbox']").length,
      departureStarCount: document.querySelectorAll("#config-local-origins .highlight-star").length,
      arrivalStarCount: document.querySelectorAll("#config-side-b-destinations .highlight-star").length,
      transferStarCount: document.querySelectorAll("#config-connection-stations .highlight-star").length,
      trainTypeLabels: Array.from(document.querySelectorAll("#config-train-types .station-choice-toggle span")).map((node) => node.textContent),
      dayValue: document.querySelector("#day-calendar").value
    })`);
    assert(loadedCounts.stationCount > 0, "Station checkbox list should populate");
    assert(loadedCounts.trainTypeCount > 0, "Service checkbox list should populate");
    assert(loadedCounts.departureStarCount > 0, "Departure stations should have highlight stars");
    assert(loadedCounts.arrivalStarCount > 0, "Arrival stations should have highlight stars");
    assert(loadedCounts.transferStarCount > 0, "Transfer stations should have highlight stars");
    assert(!loadedCounts.trainTypeLabels.includes("421I"), "Opaque route codes should not render as services");
    assert(!loadedCounts.trainTypeLabels.includes("Paris - Poitiers - La Rochelle TGV"), "Corridor names should not render as services");
    assert(loadedCounts.trainTypeLabels.includes("TGV INOUI"), "TGV INOUI service should render");
    assert(loadedCounts.trainTypeLabels.includes("OUIGO Grande Vitesse"), "OUIGO Grande Vitesse service should render");
    assert(loadedCounts.trainTypeLabels.includes("TGV Lyria"), "TGV Lyria service should render");
    assert(loadedCounts.trainTypeLabels.includes("Unknown"), "Unclassified trips should use the conservative Unknown label");
    assert(Boolean(loadedCounts.dayValue), "Calendar day should be selected after load");

    const starToggle = await page.eval(`(() => {
      const departureStar = document.querySelector("#config-local-origins .highlight-star");
      const station = departureStar.dataset.highlightStation;
      const before = departureStar.getAttribute("aria-pressed");
      departureStar.click();
      const departureAfter = Array.from(document.querySelectorAll("#config-local-origins .highlight-star")).find((star) => star.dataset.highlightStation === station)?.getAttribute("aria-pressed");
      const transferAfter = Array.from(document.querySelectorAll("#config-connection-stations .highlight-star")).find((star) => star.dataset.highlightStation === station)?.getAttribute("aria-pressed");
      const arrivalAfter = Array.from(document.querySelectorAll("#config-side-b-destinations .highlight-star")).find((star) => star.dataset.highlightStation === station)?.getAttribute("aria-pressed");
      return { before, departureAfter, transferAfter, arrivalAfter };
    })()`);
    assert(starToggle.before !== starToggle.departureAfter, "Clicking a station star should toggle its highlight");
    assert(starToggle.departureAfter === starToggle.transferAfter && starToggle.departureAfter === starToggle.arrivalAfter, "Highlight stars should stay synchronized across departure, transfer, and arrival lists");

    const timelineGuides = await waitFor(async () => page.eval(`(() => {
      const labels = Array.from(document.querySelectorAll(".timeline-scale span")).map((node) => node.getBoundingClientRect().left);
      const lines = Array.from(document.querySelectorAll(".timeline-grid-lines span")).map((node) => node.getBoundingClientRect().left);
      return labels.length ? { labels, lines } : null;
    })()`), { timeoutMs: 120_000, message: "timeline chart to render" });
    assert(timelineGuides.lines.length === timelineGuides.labels.length, "Each timeline label should have a vertical guide");
    assert(timelineGuides.lines.every((left, index) => Math.abs(left - timelineGuides.labels[index]) < 1), "Timeline guides should align with their time labels");
    assert(await page.eval(`document.querySelector("#routes-time-chart > h3") === null`), "Timeline should not render a route/date title");
    assert(await page.eval(`document.querySelectorAll(".timeline-day-group").length`) === 1, "Timeline should initially include only the selected day");
    const stickyTimelineHeaders = await page.eval(`(() => {
      const scale = document.querySelector(".timeline-scale");
      const heading = document.querySelector(".timeline-day-heading");
      const scaleStyle = getComputedStyle(scale);
      const headingStyle = getComputedStyle(heading);
      return {
        extraBannerExists: Boolean(document.querySelector("#timeline-current-day-banner")),
        scalePosition: scaleStyle.position,
        scaleTop: Number.parseFloat(scaleStyle.top),
        scaleHeight: scale.getBoundingClientRect().height,
        headingPosition: headingStyle.position,
        headingTop: Number.parseFloat(headingStyle.top)
      };
    })()`);
    assert(!stickyTimelineHeaders.extraBannerExists, "Timeline should not render a duplicate day banner");
    assert(stickyTimelineHeaders.scalePosition === "sticky" && stickyTimelineHeaders.scaleTop === 0, "Time axis should stick to the top of the chart");
    assert(stickyTimelineHeaders.headingPosition === "sticky" && stickyTimelineHeaders.headingTop >= stickyTimelineHeaders.scaleHeight, "Day heading should stick directly below the time axis");

    assert(await page.eval(`document.querySelector(".timeline-direction-switch") === null`), "Timeline direction toggle should not be rendered");

    assert(await page.eval(`document.querySelector("#timeline-load-more")?.textContent`) === "Load 3 more days", "Timeline should end with a load-more button");
    await waitFor(async () => page.eval(`Boolean(document.querySelector('[data-timeline-sort="duration"]'))`), {
      message: "timeline sort controls to render",
    });
    await page.eval(`document.querySelector('[data-timeline-sort="duration"]').click()`);
    assert(await page.eval(`Array.from(document.querySelectorAll(".timeline-day-group")).every((group) => {
      const values = Array.from(group.querySelectorAll(":scope > .timeline-row .timeline-label-duration")).map((label) => {
        const match = label.textContent.match(/(?:(\\d+)h)?\\s*(\\d+)(?:m)?/i);
        return match ? Number(match[1] || 0) * 60 + Number(match[2] || 0) : Number.POSITIVE_INFINITY;
      });
      return values.every((value, index) => index === 0 || values[index - 1] <= value);
    })`), "Duration sorting should order rows within each day group");
    await page.eval(`document.querySelector('[data-timeline-sort="time"]').click()`);
    assert(await page.eval(`Array.from(document.querySelectorAll(".timeline-day-group")).every((group) => {
      const values = Array.from(group.querySelectorAll(":scope > .timeline-row .timeline-label-time")).map((label) => {
        const [hours, minutes] = label.textContent.trim().split(":").map(Number);
        return hours * 60 + minutes;
      });
      return values.every((value, index) => index === 0 || values[index - 1] <= value);
    })`), "Time sorting should order rows within each day group");
    assert(await page.eval(`Array.from(document.querySelectorAll(".timeline-row")).every((row) => row.dataset.day === row.closest(".timeline-day-group")?.dataset.day)`), "Trip rows should be grouped under their service day");
    assert(await page.eval(`Array.from(document.querySelectorAll(".timeline-label")).every((label) => /\\(\\d+(?:h\\d{2}|m)\\)/.test(label.textContent))`), "Every timeline row should show its total journey duration");

    const nextDayStart = await page.eval(`(() => {
      const button = document.querySelector("#next-day-button");
      const before = document.querySelector("#day-calendar").value;
      if (!button.disabled) button.click();
      return { before, clicked: !button.disabled };
    })()`);
    if (nextDayStart.clicked) {
      const nextDayResult = await waitFor(async () => page.eval(`(() => {
        const selected = document.querySelector("#day-calendar").value;
        const firstGroup = document.querySelector(".timeline-day-group")?.dataset.day || "";
        const loading = document.querySelector(".timeline-empty")?.textContent.includes("Loading");
        return selected !== ${JSON.stringify(nextDayStart.before)} && !loading && firstGroup
          ? { selected, firstGroup, previousDisabled: document.querySelector("#previous-day-button").disabled }
          : null;
      })()`), { timeoutMs: 120_000, message: "next service day routes to render" });
      assert(nextDayResult.firstGroup === nextDayResult.selected.replaceAll("-", ""), "Next-day arrow should make the chosen service day the first group");
      assert(!nextDayResult.previousDisabled, "Previous-day arrow should enable after moving forward");
    }

    const unrestrictedTransfers = await page.eval(`(() => {
      let box = document.querySelector("#config-connection-stations input[type='checkbox']:checked");
      while (box) {
        box.checked = false;
        box.dispatchEvent(new Event("change", { bubbles: true }));
        box = document.querySelector("#config-connection-stations input[type='checkbox']:checked");
      }
      return {
        checked: document.querySelectorAll("#config-connection-stations input[type='checkbox']:checked").length,
        spinnerVisible: Boolean(document.querySelector(".route-refresh-spinner")),
        refreshButtonVisible: Boolean(document.querySelector(".refresh-routes"))
      };
    })()`);
    assert(unrestrictedTransfers.checked === 0, "All transfer stations should be clear for unrestricted routing");
    assert(unrestrictedTransfers.spinnerVisible, "Clearing transfer stations should show the automatic refresh spinner");
    assert(!unrestrictedTransfers.refreshButtonVisible, "Automatic refresh should not show a manual refresh button");
    await waitFor(async () => page.eval(`!document.querySelector(".route-refresh-spinner") && Boolean(document.querySelector(".timeline-grid"))`), {
      timeoutMs: 120_000,
      message: "unrestricted transfer routes to render",
    });
    assert(await page.eval(`document.querySelectorAll(".timeline-bar.train").length`) > 0, "Unrestricted transfer routing should return reachable journeys");

    const mapMode = await page.eval(`(() => {
      document.querySelector('#route-view-tabs [data-view="map"]').click();
      return {
        mapHidden: document.querySelector("#routes-map").hidden,
        timeHidden: document.querySelector("#routes-time-chart").hidden,
        stations: document.querySelectorAll("#routes-map .route-map-station").length,
        routeSegments: document.querySelectorAll("#routes-map .route-map-route").length,
      };
    })()`);
    assert(!mapMode.mapHidden && mapMode.timeHidden, "Map mode should replace the time chart");
    assert(mapMode.stations > 0, "Map mode should plot returned route stations");
    assert(mapMode.routeSegments > 0, "Map mode should plot proposed route segments");
    await page.eval(`document.querySelector('#route-view-tabs [data-view="time"]').click()`);
    assert(await page.eval(`!document.querySelector("#routes-time-chart").hidden && document.querySelector("#routes-map").hidden`), "Time mode should restore the time chart");

    async function assertSelectedFirst(containerSelector, label) {
      const result = await page.eval(`(() => {
        const boxes = Array.from(document.querySelectorAll("${containerSelector} input[type='checkbox']"));
        const flags = boxes.map((box) => box.checked);
        const firstUnchecked = flags.findIndex((checked) => !checked);
        const laterChecked = firstUnchecked >= 0 && flags.slice(firstUnchecked + 1).some(Boolean);
        return { total: boxes.length, checked: flags.filter(Boolean).length, laterChecked };
      })()`);
      assert(result.total > 0, `${label} should have checkbox rows`);
      assert(!result.laterChecked, `${label} should sort selected rows first`);
    }

    await assertSelectedFirst("#config-local-origins", "Departure stations");
    await assertSelectedFirst("#config-connection-stations", "Transfer stations");
    await assertSelectedFirst("#config-side-b-destinations", "Arrival stations");
    await assertSelectedFirst("#config-train-types", "Services");

    async function filterAndAssert(filterSelector, containerSelector, query, label) {
      const filterSelectorJson = JSON.stringify(filterSelector);
      const containerSelectorJson = JSON.stringify(`${containerSelector} .station-choice span`);
      const result = await page.eval(`(() => {
        const filter = document.querySelector(${filterSelectorJson});
        filter.value = ${JSON.stringify(query)};
        filter.dispatchEvent(new Event("input", { bubbles: true }));
        const labels = Array.from(document.querySelectorAll(${containerSelectorJson})).map((node) => node.textContent);
        return labels;
      })()`);
      assert(result.length > 0, `${label} filter should leave visible rows`);
      assert(result.every((item) => item.toLowerCase().includes(query.toLowerCase())), `${label} filter should restrict visible rows`);
    }

    await filterAndAssert('.station-filter[data-role="local_origins"]', "#config-local-origins", "Saujon", "Departure");
    await filterAndAssert('.station-filter[data-role="connection_stations"]', "#config-connection-stations", "Poitiers", "Transfer");
    await filterAndAssert('.station-filter[data-role="side_b_destinations"]', "#config-side-b-destinations", "Paris", "Arrival");
    await filterAndAssert("#train-type-filter", "#config-train-types", "TER", "Service");

    async function toggleFirstVisible(containerSelector, label) {
      const containerSelectorJson = JSON.stringify(containerSelector);
      const result = await page.eval(`(() => {
        const box = document.querySelector(${JSON.stringify(`${containerSelector} input[type='checkbox']`)});
        if (!box) return null;
        const value = box.value;
        const before = box.checked;
        box.checked = !box.checked;
        box.dispatchEvent(new Event("change", { bubbles: true }));
        const afterBox = Array.from(document.querySelectorAll(${JSON.stringify(`${containerSelector} input[type='checkbox']`)})).find((candidate) => candidate.value === value);
        return { before, after: afterBox?.checked, value };
      })()`);
      assert(result, `${label} should have a visible checkbox to edit`);
      assert(result.before !== result.after, `${label} checkbox should toggle`);
    }

    await toggleFirstVisible("#config-local-origins", "Departure station list");
    await toggleFirstVisible("#config-connection-stations", "Transfer station list");
    await toggleFirstVisible("#config-side-b-destinations", "Arrival station list");
    await toggleFirstVisible("#config-train-types", "Service list");

    const refreshPrompt = await page.eval(`({
      buttonCount: document.querySelectorAll(".refresh-routes").length,
      spinnerCount: document.querySelectorAll(".route-refresh-spinner").length,
      spinnerAnimation: getComputedStyle(document.querySelector(".route-refresh-spinner")).animationName,
      timelineText: document.querySelector("#routes-time-chart")?.textContent || "",
      textResultPanelCount: document.querySelectorAll(".list-panel, #routes-list, #routes-list-reverse").length
    })`);
    assert(refreshPrompt.buttonCount === 0, "Route settings edits should not show a manual refresh button");
    assert(refreshPrompt.spinnerCount === 1, "Route settings edits should show one loading spinner");
    assert(refreshPrompt.spinnerAnimation !== "none", "Automatic refresh spinner should animate");
    assert(refreshPrompt.timelineText.includes("Route settings changed"), "Timeline should explain that route settings changed");
    assert(refreshPrompt.textResultPanelCount === 0, "Textual result panels should not render");

    await waitFor(async () => page.eval(`document.querySelector("#cache-status-text")?.textContent.includes("Cache ready") && !document.querySelector(".route-refresh-spinner")`), {
      timeoutMs: 120_000,
      message: "route settings refresh to complete",
    });

    const noTransferStationsSelected = await page.eval(`(() => {
      const filter = document.querySelector('.station-filter[data-role="connection_stations"]');
      filter.value = "";
      filter.dispatchEvent(new Event("input", { bubbles: true }));
      let box = document.querySelector("#config-connection-stations input[type='checkbox']:checked");
      while (box) {
        box.checked = false;
        box.dispatchEvent(new Event("change", { bubbles: true }));
        box = document.querySelector("#config-connection-stations input[type='checkbox']:checked");
      }
      return {
        checked: document.querySelectorAll("#config-connection-stations input[type='checkbox']:checked").length,
        spinnerVisible: Boolean(document.querySelector(".route-refresh-spinner"))
      };
    })()`);
    assert(noTransferStationsSelected.checked === 0, "Every transfer station checkbox should be unselectable");
    assert(noTransferStationsSelected.spinnerVisible, "Clearing transfer stations should refresh routes automatically");

    const dayChanged = await page.eval(`(() => {
      const input = document.querySelector("#day-calendar");
      const before = input.value;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return { before, after: input.value, type: input.type };
    })()`);
    assert(dayChanged.type === "date", "Day selector should use a date input");
    assert(Boolean(dayChanged.after), "Day date input should keep a selected value");

    console.log("Train Route Explorer UI tests passed");
  } finally {
    page.close();
    await browser.cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
