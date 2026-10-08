import json
import sys
import unittest

from selenium.common.exceptions import StaleElementReferenceException
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC

from test_station_filter_selenium import ROLE_TO_LIST, TEST_URL, StationFilterRegressionTest


_original_close_overlays = StationFilterRegressionTest._close_overlays


def _close_overlays_deterministically(self):
    _original_close_overlays(self)
    self.driver.execute_script(
        """
        const frame = document.querySelector('#train-detail-frame');
        const layer = document.querySelector('#train-detail-dismiss-layer');
        if (frame) frame.hidden = true;
        if (layer) layer.hidden = true;
        """
    )
    self.wait.until(
        lambda driver: driver.execute_script(
            """
            const frame = document.querySelector('#train-detail-frame');
            const layer = document.querySelector('#train-detail-dismiss-layer');
            return (!frame || frame.hidden) && (!layer || layer.hidden);
            """
        )
    )
    self.wait.until(
        lambda driver: not driver.execute_script(
            "return Boolean(history.state?.trainRouteExplorerDetailOpen);"
        )
    )
    self.assertEqual(self.driver.current_url.rstrip("/"), TEST_URL.rstrip("/"))


StationFilterRegressionTest._close_overlays = _close_overlays_deterministically


def test_40_paris_filter_works_for_departure_via_and_arrival_and_can_select(self):
    for role in ROLE_TO_LIST:
        with self.subTest(role=role):
            self._filter_for_paris(role)

    labels = self._filter_for_paris("local_origins")
    target = {"label": None}

    def click_unselected_paris(driver):
        for row in driver.find_elements(By.CSS_SELECTOR, "#config-local-origins .station-choice"):
            try:
                row_label = row.find_element(By.CSS_SELECTOR, ".station-choice-toggle span").text
                checkbox = row.find_element(By.CSS_SELECTOR, "input[type='checkbox']")
                if row_label in labels and not checkbox.is_selected():
                    checkbox.click()
                    target["label"] = row_label
                    return True
            except StaleElementReferenceException:
                # Filtering replaces the checklist DOM. Reacquire the row and
                # checkbox instead of retaining a stale Selenium element.
                return False
        return False

    self.filter_wait.until(click_unselected_paris)
    target_label = target["label"]
    self.assertIsNotNone(target_label, "Expected at least one unselected Paris departure station")

    def selected_after_rerender(driver):
        for row in driver.find_elements(By.CSS_SELECTOR, "#config-local-origins .station-choice"):
            try:
                label = row.find_element(By.CSS_SELECTOR, ".station-choice-toggle span").text
                if label == target_label:
                    return row.find_element(By.CSS_SELECTOR, "input[type='checkbox']").is_selected()
            except StaleElementReferenceException:
                return False
        return False

    self.filter_wait.until(selected_after_rerender)

    apply_button = self.wait.until(
        EC.element_to_be_clickable(
            (
                By.CSS_SELECTOR,
                ".route-summary-item[data-route-item='local_origins'] .route-selector-apply",
            )
        )
    )
    apply_button.click()

    self.wait.until(
        EC.invisibility_of_element_located(
            (
                By.CSS_SELECTOR,
                ".route-summary-item[data-route-item='local_origins'] .route-selector-panel",
            )
        )
    )
    self.assertIn(
        target_label,
        self.driver.find_element(By.CSS_SELECTOR, "[data-route-value='local_origins']").text,
        "Selected Paris station should appear in the Departure route summary after Apply",
    )


def test_35_calendar_shows_selected_weekday_name(self):
    result = self.driver.execute_script(
        """
        const input = document.querySelector('#day-calendar');
        const weekday = document.querySelector('#day-weekday');
        const selectedDate = input?.value || '';
        const expected = selectedDate
          ? new Intl.DateTimeFormat('en', { weekday: 'long' }).format(new Date(`${selectedDate}T12:00:00`))
          : '';
        return {
          selectedDate,
          actual: weekday?.textContent.trim() || '',
          expected,
          hidden: weekday?.hidden ?? true,
        };
        """
    )
    self.assertTrue(result["selectedDate"], result)
    self.assertFalse(result["hidden"], result)
    self.assertEqual(result["actual"], result["expected"], result)
    self.assertIn(
        result["actual"],
        ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
    )


def test_55_saujon_massy_via_angouleme_current_service_day(self):
    result = self.driver.execute_async_script(
        """
        const done = arguments[0];
        const appUrl = document.querySelector('script[type="module"][src*="app.js"]')?.src;
        if (!appUrl) {
          done({ ok: false, error: 'App module script was not found' });
          return;
        }
        import(appUrl).then(({ app }) => {
          window.__saujonMassyApp = app;
          const selectedDay = app.state.availableDays.includes(app.state.selectedDay)
            ? app.state.selectedDay
            : app.state.availableDays[0];
          if (!selectedDay) {
            done({ ok: false, error: 'GTFS has no available service days' });
            return;
          }
          app.state.config = {
            ...app.state.config,
            local_origins: ['Saujon'],
            connection_stations: ['Angoulême'],
            side_b_destinations: ['Massy TGV'],
            max_transfer_count: 3,
            max_journey_duration_minutes: 270,
          };
          app.writeConfig(app.state.config);
          app.state.selectedDay = selectedDay;
          app.els.dayCalendar.value = app.gtfsToIsoDate(selectedDay);
          app.showRefreshNotice();
          done({
            ok: true,
            selectedDay,
            firstAvailableDay: app.state.availableDays[0],
            lastAvailableDay: app.state.availableDays.at(-1),
          });
        }).catch((error) => done({ ok: false, error: String(error) }));
        """
    )
    self.assertTrue(result.get("ok"), result)
    selected_day = result["selectedDay"]

    self.wait.until(
        lambda driver: driver.execute_script(
            """
            const selectedDay = arguments[0];
            const app = window.__saujonMassyApp;
            return Boolean(
              app &&
              app.state.selectedDay === selectedDay &&
              !app.state.settingsDirty &&
              !app.state.refreshInFlight &&
              !app.state.routeRequestInFlight &&
              app.state.routes?.selected_day === selectedDay &&
              document.querySelector('#cache-status')?.classList.contains('ready')
            );
            """,
            selected_day,
        )
    )

    result = self.driver.execute_script(
        """
        const app = window.__saujonMassyApp;
        const simplifyLeg = (leg) => ({
          type: leg.train_type,
          number: leg.train_number,
          from: leg.departure_stop,
          to: leg.destination_stop,
          departure: leg.departure_time,
          arrival: leg.arrival_time,
          departure_minutes: leg.departure_minutes,
          arrival_minutes: leg.arrival_minutes,
        });
        const visibleRows = Array.from(document.querySelectorAll('.timeline-row')).map((row) => ({
          text: row.innerText.trim(),
          display: getComputedStyle(row).display,
          duplicate_reason: row.dataset.routeDuplicateReason || '',
          loop_invalid: row.dataset.routeLoopInvalid || '',
          legs: Array.from(row.querySelectorAll('.timeline-bar.train[data-detail]')).map(
            (bar) => simplifyLeg(JSON.parse(decodeURIComponent(bar.dataset.detail)))
          ),
        }));
        return {
          selectedDay: app.state.selectedDay,
          config: app.state.config,
          outwardCount: (app.state.routes.outward || []).length,
          visibleRows,
        };
        """
    )

    print("SAUJON_MASSY_RESULT=" + json.dumps(result, ensure_ascii=False, sort_keys=True))
    self.assertEqual(result["selectedDay"], selected_day)
    self.assertEqual(result["config"]["max_transfer_count"], 3)
    self.assertEqual(result["config"]["max_journey_duration_minutes"], 270)

    visible = [row for row in result["visibleRows"] if row["display"] != "none"]
    self.assertTrue(
        visible,
        f"Expected a Saujon → Massy TGV route via Angoulême on available service day {selected_day}",
    )

    map_result = self.driver.execute_script(
        """
        const app = window.__saujonMassyApp;
        const itineraries = app.state.selectedTab === 'back'
          ? (app.state.routes.returns || [])
          : (app.state.routes.outward || []);
        const expectedStations = new Set();
        let expectedRouteSegments = 0;
        for (const itinerary of itineraries) {
          for (const leg of itinerary.legs || []) {
            const direct = Array.isArray(leg.path) ? leg.path : [];
            const journey = Array.isArray(leg.journey_path)
              ? leg.journey_path.filter((stop) => stop?.in_segment !== false)
              : [];
            const source = direct.length ? direct : journey;
            const coordinateStops = source.filter(
              (stop) => Number.isFinite(Number(stop?.lat)) && Number.isFinite(Number(stop?.lon))
            );
            for (const stop of coordinateStops) expectedStations.add(String(stop.stop_name || '—'));
            if (coordinateStops.length > 1) expectedRouteSegments += 1;
          }
        }
        const mapButton = document.querySelector('#route-view-tabs [data-view="map"]');
        const mapView = document.querySelector('#routes-map');
        if (mapView.hidden) mapButton.click();
        return {
          expectedStations: expectedStations.size,
          expectedRouteSegments,
          actualStations: document.querySelectorAll('#routes-map .route-map-station').length,
          actualRouteSegments: document.querySelectorAll('#routes-map .route-map-route').length,
          mapHidden: document.querySelector('#routes-map').hidden,
          timeHidden: document.querySelector('#routes-time-chart').hidden,
        };
        """
    )
    self.assertFalse(map_result["mapHidden"])
    self.assertTrue(map_result["timeHidden"])
    self.assertEqual(map_result["actualStations"], map_result["expectedStations"])
    self.assertEqual(map_result["actualRouteSegments"], map_result["expectedRouteSegments"])
    self.assertGreater(map_result["actualStations"], 0)
    self.assertGreater(map_result["actualRouteSegments"], 0)
    self.driver.execute_script(
        """
        const timeButton = document.querySelector('#route-view-tabs [data-view="time"]');
        const timeView = document.querySelector('#routes-time-chart');
        if (timeView.hidden) timeButton.click();
        """
    )
    self.assertFalse(
        self.driver.execute_script("return document.querySelector('#routes-time-chart').hidden;")
    )

    schedules = {}
    for row in visible:
        self.assertNotEqual(row["loop_invalid"], "true", row)
        legs = row["legs"]
        self.assertTrue(legs, row)
        self.assertEqual(legs[0]["from"], "Saujon", row)
        self.assertEqual(legs[-1]["to"], "Massy TGV", row)
        key = (
            legs[0]["from"],
            legs[0]["departure_minutes"],
            legs[-1]["to"],
            legs[-1]["arrival_minutes"],
        )
        schedules.setdefault(key, set()).add(len(legs) - 1)

    dominated = {key: counts for key, counts in schedules.items() if len(counts) > 1}
    self.assertFalse(
        dominated,
        f"Same-schedule routes with extra transfers remain visible: {dominated}; rows={visible!r}",
    )


StationFilterRegressionTest.test_40_paris_filter_works_for_departure_via_and_arrival_and_can_select = (
    test_40_paris_filter_works_for_departure_via_and_arrival_and_can_select
)
StationFilterRegressionTest.test_35_calendar_shows_selected_weekday_name = (
    test_35_calendar_shows_selected_weekday_name
)
StationFilterRegressionTest.test_55_saujon_massy_via_angouleme_current_service_day = (
    test_55_saujon_massy_via_angouleme_current_service_day
)


if __name__ == "__main__":
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(StationFilterRegressionTest)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
