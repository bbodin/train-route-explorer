import os
import unittest

from selenium import webdriver
from selenium.common.exceptions import TimeoutException
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait


TEST_URL = os.environ.get("TEST_URL", "http://127.0.0.1:8080/")
WAIT_SECONDS = int(os.environ.get("SELENIUM_WAIT_SECONDS", "10"))


class MapButtonSeleniumTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        options = webdriver.ChromeOptions()
        options.add_argument("--headless=new")
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument("--window-size=1440,1000")

        chrome_binary = os.environ.get("CHROME_BINARY")
        if chrome_binary:
            options.binary_location = chrome_binary

        cls.driver = webdriver.Chrome(options=options)
        cls.wait = WebDriverWait(cls.driver, WAIT_SECONDS)
        cls.driver.get(TEST_URL)

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls, "driver"):
            cls.driver.quit()

    def test_map_button_click_switches_to_map_view(self):
        try:
            map_button = self.wait.until(
                EC.element_to_be_clickable(
                    (By.CSS_SELECTOR, '#route-view-tabs [data-view="map"]')
                )
            )
        except TimeoutException as exc:
            version = self.driver.execute_script(
                "return document.querySelector('.app-version')?.textContent?.trim() || '';"
            )
            buttons = self.driver.execute_script(
                """
                return Array.from(document.querySelectorAll('button'))
                  .map((button) => (button.textContent || '').trim())
                  .filter(Boolean);
                """
            )
            raise AssertionError(
                f"Map button was not clickable at {TEST_URL!r}; "
                f"app_version={version!r}; visible_buttons={buttons!r}"
            ) from exc

        self.assertTrue(map_button.is_displayed(), "Map button should be visible")
        self.assertEqual(map_button.text.strip(), "Map")

        time_button = self.driver.find_element(
            By.CSS_SELECTOR, '#route-view-tabs [data-view="time"]'
        )
        map_view = self.driver.find_element(By.ID, "routes-map")
        time_view = self.driver.find_element(By.ID, "routes-time-chart")

        self.assertEqual(map_button.get_attribute("aria-pressed"), "false")
        self.assertEqual(time_button.get_attribute("aria-pressed"), "true")
        self.assertFalse(map_view.is_displayed())
        self.assertTrue(time_view.is_displayed())

        self.assertEqual(
            self.driver.execute_script(
                "return getComputedStyle(arguments[0], '::after').display;",
                time_button,
            ),
            "none",
            "Time/Map toggle should not show a yellow selected dot",
        )

        time_button.click()

        self.wait.until(lambda driver: driver.find_element(By.ID, "routes-map").is_displayed())
        self.wait.until(lambda driver: not driver.find_element(By.ID, "routes-time-chart").is_displayed())

        map_button = self.driver.find_element(
            By.CSS_SELECTOR, '#route-view-tabs [data-view="map"]'
        )
        map_button.click()
        self.wait.until(lambda driver: driver.find_element(By.ID, "routes-time-chart").is_displayed())

        map_button = self.driver.find_element(
            By.CSS_SELECTOR, '#route-view-tabs [data-view="map"]'
        )
        map_button.click()
        self.wait.until(lambda driver: driver.find_element(By.ID, "routes-map").is_displayed())

        map_button = self.driver.find_element(
            By.CSS_SELECTOR, '#route-view-tabs [data-view="map"]'
        )
        time_button = self.driver.find_element(
            By.CSS_SELECTOR, '#route-view-tabs [data-view="time"]'
        )

        self.assertEqual(map_button.get_attribute("aria-pressed"), "true")
        self.assertEqual(time_button.get_attribute("aria-pressed"), "false")
        self.assertIn("selected", map_button.get_attribute("class").split())
        self.assertNotIn("selected", time_button.get_attribute("class").split())

        print(
            "MAP_BUTTON_RESULT="
            f"url={self.driver.current_url!r} "
            f"map_visible={map_view.is_displayed()} "
            f"time_visible={time_view.is_displayed()}"
        )



    def test_swap_button_label_stays_on_one_line(self):
        try:
            for width, height in ((1440, 1000), (390, 844)):
                self.driver.set_window_size(width, height)
                self.driver.get(TEST_URL)
                swap_button = self.wait.until(
                    EC.visibility_of_element_located((By.ID, "swap-stations-button"))
                )
                layout = self.driver.execute_script(
                    """
                    const button = arguments[0];
                    const range = document.createRange();
                    range.selectNodeContents(button);
                    const lineRects = Array.from(range.getClientRects())
                      .filter((rect) => rect.width > 0 && rect.height > 0);
                    return {
                      text: button.textContent.trim(),
                      whiteSpace: getComputedStyle(button).whiteSpace,
                      lineCount: lineRects.length,
                      contentFits: button.scrollWidth <= button.clientWidth + 1,
                    };
                    """,
                    swap_button,
                )
                self.assertEqual(layout["text"], "<- Swap ->", layout)
                self.assertEqual(layout["whiteSpace"], "nowrap", layout)
                self.assertEqual(
                    layout["lineCount"],
                    1,
                    f"Swap label should stay on one line at {width}px: {layout}",
                )
                if width == 390:
                    mobile = self.driver.execute_script(
                        """
                        const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
                        const departure = rect('[data-route-role="local_origins"]');
                        const arrival = rect('[data-route-role="side_b_destinations"]');
                        const swap = rect('#swap-stations-button');
                        const via = rect('[data-route-role="connection_stations"]');
                        const avoid = rect('[data-route-role="avoid_stations"]');
                        const title = rect('.brand strong');
                        const version = rect('.app-version');
                        const headerTools = rect('.header-tools');
                        const day = rect('.day-control');
                        const view = rect('#route-view-tabs');
                        return {
                          widths: [departure.height, arrival.height, swap.height],
                          titleVisible: title.width > 0 && title.left >= 0 && title.right <= innerWidth,
                          versionVisible: version.width > 0 && version.right <= innerWidth,
                          labelsVisible: [...document.querySelectorAll('.route-summary-stop span')]
                            .every((label) => getComputedStyle(label).display !== 'none'),
                          topRowsGap: Math.min(day.top, view.top) - headerTools.bottom,
                          routeRowsGap: Math.min(departure.top, swap.top, arrival.top) - Math.max(day.bottom, view.bottom),
                          secondaryRouteGap: Math.min(via.top, avoid.top) - Math.max(departure.bottom, swap.bottom, arrival.bottom),
                        };
                        """
                    )
                    self.assertTrue(mobile["titleVisible"] and mobile["versionVisible"], mobile)
                    self.assertTrue(mobile["labelsVisible"], mobile)
                    self.assertAlmostEqual(mobile["widths"][0], mobile["widths"][1], delta=1)
                    self.assertAlmostEqual(mobile["widths"][0], mobile["widths"][2], delta=1)
                    self.assertGreaterEqual(mobile["topRowsGap"], 4, mobile)
                    self.assertGreaterEqual(mobile["routeRowsGap"], 4, mobile)
                    self.assertLessEqual(mobile["routeRowsGap"], 14, mobile)
                    self.assertGreaterEqual(mobile["secondaryRouteGap"], 2, mobile)
                    self.assertLessEqual(mobile["secondaryRouteGap"], 8, mobile)
                self.assertTrue(
                    layout["contentFits"],
                    f"Swap label should fit inside the button at {width}px: {layout}",
                )
        finally:
            self.driver.set_window_size(1440, 1000)
            self.driver.get(TEST_URL)


    def test_optional_time_config_filters_and_persists(self):
        self.driver.set_window_size(1440, 1000)
        self.driver.get(TEST_URL)
        try:
            result = self.driver.execute_async_script(
                """
                const done = arguments[0];
                const appUrl = document.querySelector(
                  'script[type="module"][src*="app.js"]'
                )?.src;
                if (!appUrl) {
                  done({ ok: false, error: 'App module script was not found' });
                  return;
                }
                const constraintsUrl = new URL(
                  './time-constraints.js?v=0.1',
                  window.location.href
                ).href;

                Promise.all([import(appUrl), import(constraintsUrl)])
                  .then(([{ app }, { applyRouteTimeConstraints }]) => {
                    const values = {
                      first_departure_time: '08:00',
                      last_departure_time: '10:30',
                      first_arrival_time: '10:00',
                      last_arrival_time: '12:00',
                    };
                    const ids = {
                      first_departure_time: 'config-first-departure-time',
                      last_departure_time: 'config-last-departure-time',
                      first_arrival_time: 'config-first-arrival-time',
                      last_arrival_time: 'config-last-arrival-time',
                    };
                    for (const [field, id] of Object.entries(ids)) {
                      const input = document.getElementById(id);
                      if (!input) {
                        done({ ok: false, error: `Missing ${id}` });
                        return;
                      }
                      input.value = values[field];
                    }

                    const config = app.readConfig();
                    const itinerary = (tripId, departure, arrival) => ({
                      trip_id: tripId,
                      departure_minutes: departure,
                      arrival_minutes: arrival,
                    });
                    const filtered = applyRouteTimeConstraints({
                      outward: [
                        itinerary('too-early-departure', 420, 630),
                        itinerary('match-outward', 510, 630),
                        itinerary('too-late-departure', 690, 710),
                        itinerary('too-early-arrival', 510, 560),
                      ],
                      returns: [
                        itinerary('match-return', 600, 690),
                        itinerary('too-late-arrival', 600, 750),
                      ],
                    }, config);

                    app.state.config = { ...app.state.config, ...config };
                    app.saveSettings();
                    const stored = JSON.parse(
                      localStorage.getItem('train-route-explorer-settings-v1') || '{}'
                    ).config || {};

                    const menu = document.querySelector('.route-settings-menu');
                    menu.open = true;
                    const section = document.querySelector('.journey-time-window-panel');

                    done({
                      ok: true,
                      inputTypes: Object.values(ids).map(
                        (id) => document.getElementById(id)?.type
                      ),
                      heading: section?.querySelector('h3')?.textContent?.trim(),
                      optional: section?.querySelector('.time-window-heading span')?.textContent?.trim(),
                      config,
                      stored,
                      outward: filtered.outward.map((item) => item.trip_id),
                      returns: filtered.returns.map((item) => item.trip_id),
                      visible: Boolean(section && getComputedStyle(section).display !== 'none'),
                    });
                  })
                  .catch((error) => done({ ok: false, error: String(error) }));
                """
            )

            self.assertTrue(result["ok"], result)
            self.assertEqual(result["heading"], "Time")
            self.assertEqual(result["optional"], "Optional")
            self.assertTrue(result["visible"], result)
            self.assertEqual(result["inputTypes"], ["time", "time", "time", "time"])
            for field, expected in {
                "first_departure_time": "08:00",
                "last_departure_time": "10:30",
                "first_arrival_time": "10:00",
                "last_arrival_time": "12:00",
            }.items():
                self.assertEqual(result["config"][field], expected, result)
                self.assertEqual(result["stored"][field], expected, result)
            self.assertEqual(result["outward"], ["match-outward"], result)
            self.assertEqual(result["returns"], ["match-return"], result)
        finally:
            self.driver.execute_script("localStorage.clear();")
            self.driver.get(TEST_URL)

    def test_route_menu_order_and_avoid_station_constraint(self):
        self.driver.set_window_size(1440, 1000)
        self.driver.get(TEST_URL)
        self.wait.until(
            EC.presence_of_element_located(
                (By.CSS_SELECTOR, '[data-route-role="avoid_stations"]')
            )
        )

        result = self.driver.execute_async_script(
            """
            const done = arguments[0];
            const appUrl = document.querySelector(
              'script[type="module"][src*="app.js"]'
            )?.src;
            if (!appUrl) {
              done({ ok: false, error: 'App module script was not found' });
              return;
            }

            const constraintsUrl = new URL(
              './route-constraints.js?v=0.1',
              window.location.href
            ).href;

            Promise.all([import(appUrl), import(constraintsUrl)])
              .then(([{ app }, { applyRouteStationConstraints }]) => {
                const order = Array.from(
                  document.querySelectorAll(
                    '.route-summary [data-route-role], .route-summary #swap-stations-button'
                  )
                ).map((element) => (
                  element.id === 'swap-stations-button'
                    ? 'swap'
                    : element.dataset.routeRole
                ));

                const stationNames = ['Paris', 'Tours', 'Poitiers', 'Bordeaux'];
                app.state.context = null;
                app.state.config = {
                  ...app.state.config,
                  local_origins: ['Paris'],
                  side_b_destinations: ['Bordeaux'],
                  connection_stations: [],
                  avoid_stations: [],
                };
                app.renderStationPickers(stationNames, app.state.config);

                const avoidBox = Array.from(
                  document.querySelectorAll(
                    '#config-avoid-stations input[type="checkbox"]'
                  )
                ).find((input) => input.value === 'Tours');
                if (!avoidBox) {
                  done({ ok: false, error: 'Tours avoid checkbox was not rendered' });
                  return;
                }
                avoidBox.checked = true;
                avoidBox.dispatchEvent(new Event('change', { bubbles: true }));

                const stored = JSON.parse(
                  localStorage.getItem('train-route-explorer-settings-v1') || '{}'
                ).config || {};

                const itinerary = (id, middle) => ({
                  trip_id: id,
                  departure_stop: 'Paris',
                  destination_stop: 'Bordeaux',
                  legs: [{
                    departure_stop: 'Paris',
                    destination_stop: 'Bordeaux',
                    path: [
                      { stop_name: 'Paris' },
                      { stop_name: middle },
                      { stop_name: 'Bordeaux' },
                    ],
                  }],
                });
                const routes = {
                  outward: [
                    itinerary('through-tours', 'Tours'),
                    itinerary('through-poitiers', 'Poitiers'),
                  ],
                  returns: [],
                };

                const avoidTours = applyRouteStationConstraints(
                  routes,
                  [],
                  ['Tours']
                );
                const requirePoitiersAndAvoidTours = applyRouteStationConstraints(
                  routes,
                  ['Poitiers'],
                  ['Tours']
                );
                const avoidDeparture = applyRouteStationConstraints(
                  routes,
                  [],
                  ['Paris']
                );

                done({
                  ok: true,
                  order,
                  storedAvoid: stored.avoid_stations || [],
                  avoidToursIds: avoidTours.outward.map((route) => route.trip_id),
                  combinedIds: requirePoitiersAndAvoidTours.outward.map(
                    (route) => route.trip_id
                  ),
                  avoidDepartureCount: avoidDeparture.outward.length,
                });
              })
              .catch((error) => done({ ok: false, error: String(error) }));
            """
        )

        self.assertTrue(result.get("ok"), result)
        self.assertEqual(
            result["order"],
            [
                "local_origins",
                "swap",
                "side_b_destinations",
                "connection_stations",
                "avoid_stations",
            ],
            result,
        )
        self.assertEqual(result["storedAvoid"], ["Tours"], result)
        self.assertEqual(result["avoidToursIds"], ["through-poitiers"], result)
        self.assertEqual(result["combinedIds"], ["through-poitiers"], result)
        self.assertEqual(result["avoidDepartureCount"], 0, result)

    def test_station_click_opens_useful_actions(self):
        self.driver.set_window_size(1200, 900)
        self.driver.get(TEST_URL)

        setup = self.driver.execute_async_script(
            """
            const done = arguments[0];
            const originalSettings = localStorage.getItem('train-route-explorer-settings-v1');
            const appUrl = document.querySelector('script[type="module"][src*="app.js"]')?.src;
            if (!appUrl) {
              done({ ok: false, error: 'App module script was not found' });
              return;
            }

            import(appUrl).then(({ app }) => {
              const stationNames = ['Paris', 'Tours', 'Poitiers', 'Bordeaux'];
              app.state.context = {
                ...(app.state.context || {}),
                station_names: stationNames,
              };
              app.state.selectedTab = 'out';
              app.state.highlights = [];
              app.state.config = {
                ...app.state.config,
                local_origins: ['Paris'],
                connection_stations: [],
                side_b_destinations: ['Bordeaux'],
              };
              app.renderStationPickers(stationNames, app.state.config);
              app.state.routes = {
                ...app.state.routes,
                outward: [{
                  departure_stop: 'Paris',
                  destination_stop: 'Bordeaux',
                  legs: [{
                    train_type: 'TGV INOUI',
                    train_number: 'CLICK',
                    path: [
                      { stop_name: 'Paris', lat: 48.8566, lon: 2.3522 },
                      { stop_name: 'Tours', lat: 47.3941, lon: 0.6848 },
                      { stop_name: 'Bordeaux', lat: 44.8378, lon: -0.5792 },
                    ],
                  }],
                }, {
                  departure_stop: 'Paris',
                  destination_stop: 'Bordeaux',
                  legs: [{
                    train_type: 'TER',
                    train_number: 'CLICK-ALT',
                    path: [
                      { stop_name: 'Paris', lat: 48.8566, lon: 2.3522 },
                      { stop_name: 'Poitiers', lat: 46.5802, lon: 0.3404 },
                      { stop_name: 'Bordeaux', lat: 44.8378, lon: -0.5792 },
                    ],
                  }],
                }],
                returns: [{
                  legs: [{
                    train_type: 'TGV INOUI',
                    train_number: 'CLICK-RETURN',
                    path: [
                      { stop_name: 'Bordeaux', lat: 44.8378, lon: -0.5792 },
                      { stop_name: 'Tours', lat: 47.3941, lon: 0.6848 },
                      { stop_name: 'Paris', lat: 48.8566, lon: 2.3522 },
                    ],
                  }],
                }],
              };
              done({ ok: true, originalSettings });
            }).catch((error) => done({ ok: false, error: String(error) }));
            """
        )
        self.assertTrue(setup.get("ok"), setup)

        try:
            self.wait.until(
                EC.element_to_be_clickable(
                    (By.CSS_SELECTOR, '#route-view-tabs [data-view="map"]')
                )
            ).click()
            self.wait.until(
                lambda driver: driver.execute_script(
                    """
                    return Boolean(document.querySelector(
                      '#routes-map .route-map-station[data-map-name="Tours"]'
                    ));
                    """
                )
            )

            direction_controls_removed = self.driver.execute_script(
                """
                return [
                  '#route-direction-tabs',
                  '#routes-map .route-map-direction-switch',
                ].every((selector) => document.querySelector(selector) === null);
                """
            )
            self.assertTrue(direction_controls_removed)
            fixed_roles = self.driver.execute_script(
                """
                return {
                  departureIsDeparture: document.querySelector(
                    '#routes-map .route-map-station[data-map-name="Paris"]'
                  )?.classList.contains('departure') || false,
                  arrivalIsArrival: document.querySelector(
                    '#routes-map .route-map-station[data-map-name="Bordeaux"]'
                  )?.classList.contains('arrival') || false,
                };
                """
            )
            self.assertTrue(fixed_roles["departureIsDeparture"], fixed_roles)
            self.assertTrue(fixed_roles["arrivalIsArrival"], fixed_roles)

            self.driver.find_element(
                By.CSS_SELECTOR,
                '#routes-map .route-map-station[data-map-name="Tours"] .route-map-station-hit',
            ).click()
            self.wait.until(
                lambda driver: driver.execute_script(
                    """
                    const card = document.querySelector('#routes-map .route-map-station-card');
                    return Boolean(card && !card.hidden);
                    """
                )
            )
            opened = self.driver.execute_script(
                """
                const station = document.querySelector(
                  '#routes-map .route-map-station[data-map-name="Tours"]'
                );
                const card = document.querySelector('#routes-map .route-map-station-card');
                const actions = Array.from(
                  card.querySelectorAll('[data-map-station-action]')
                ).map((button) => button.textContent.trim()).filter(Boolean);
                const hit = station.querySelector('.route-map-station-hit');
                const routeEmphasis = Array.from(
                  document.querySelectorAll('#routes-map .route-map-route')
                ).map((route) => {
                  const stations = JSON.parse(
                    decodeURIComponent(route.dataset.mapItineraryStations || '%5B%5D')
                  );
                  return {
                    passesTours: stations.includes('Tours'),
                    opacity: Number.parseFloat(getComputedStyle(route).opacity),
                    dimmed: route.classList.contains('dimmed'),
                  };
                });
                return {
                  hidden: card.hidden,
                  title: card.querySelector('[data-map-station-title]')?.textContent || '',
                  detail: card.querySelector('[data-map-station-detail]')?.textContent || '',
                  actions,
                  routeEmphasis,
                  hitWidth: hit?.getBoundingClientRect().width || 0,
                  tabIndex: station.getAttribute('tabindex'),
                  role: station.getAttribute('role'),
                };
                """
            )
            self.assertFalse(opened["hidden"], opened)
            self.assertEqual(opened["title"], "Tours")
            self.assertIn("shown in 1 route leg", opened["detail"])
            self.assertIn("Depart from here", opened["actions"])
            self.assertIn("Arrive here", opened["actions"])
            self.assertIn("Add via", opened["actions"])
            self.assertIn("Highlight", opened["actions"])
            matching_routes = [
                route for route in opened["routeEmphasis"] if route["passesTours"]
            ]
            non_matching_routes = [
                route for route in opened["routeEmphasis"] if not route["passesTours"]
            ]
            self.assertTrue(matching_routes, opened)
            self.assertTrue(non_matching_routes, opened)
            self.assertTrue(all(not route["dimmed"] for route in matching_routes), opened)
            self.assertTrue(all(route["dimmed"] for route in non_matching_routes), opened)
            self.assertGreater(
                min(route["opacity"] for route in matching_routes),
                max(route["opacity"] for route in non_matching_routes),
                opened,
            )
            self.assertGreaterEqual(opened["hitWidth"], 24, opened)
            self.assertEqual(opened["tabIndex"], "0")
            self.assertEqual(opened["role"], "button")

            self.driver.execute_script(
                """
                document.querySelector(
                  '#routes-map [data-map-station-action="highlight"]'
                ).click();
                """
            )
            self.wait.until(
                lambda driver: driver.execute_script(
                    """
                    const stored = JSON.parse(
                      localStorage.getItem('train-route-explorer-settings-v1') || '{}'
                    );
                    return stored.highlights?.includes('Tours') || false;
                    """
                )
            )

            action_configs = self.driver.execute_script(
                """
                document.querySelector(
                  '#routes-map [data-map-station-action="via"]'
                ).click();
                document.querySelector(
                  '#routes-map [data-map-station-action="departure"]'
                ).click();
                const afterDeparture = JSON.parse(
                  localStorage.getItem('train-route-explorer-settings-v1') || '{}'
                ).config || {};
                const arrivalButton = document.querySelector(
                  '#routes-map [data-map-station-action="arrival"]'
                );
                if (!arrivalButton) {
                  return { afterDeparture, error: 'Arrival action disappeared before click' };
                }
                arrivalButton.click();
                const afterArrival = JSON.parse(
                  localStorage.getItem('train-route-explorer-settings-v1') || '{}'
                ).config || {};
                return { afterDeparture, afterArrival };
                """
            )
            self.assertNotIn("error", action_configs, action_configs)
            departure_action = action_configs["afterDeparture"]
            self.assertEqual(
                departure_action.get("local_origins"),
                ["Tours"],
                departure_action,
            )
            self.assertEqual(
                departure_action.get("side_b_destinations"),
                ["Bordeaux"],
                departure_action,
            )
            self.assertIn(
                "Tours",
                departure_action.get("connection_stations", []),
                departure_action,
            )

            arrival_action = action_configs["afterArrival"]
            self.assertEqual(arrival_action.get("local_origins"), ["Tours"], arrival_action)
            self.assertEqual(
                arrival_action.get("side_b_destinations"),
                ["Tours"],
                arrival_action,
            )
        finally:
            self.driver.execute_script(
                """
                const original = arguments[0];
                if (original === null) {
                  localStorage.removeItem('train-route-explorer-settings-v1');
                } else {
                  localStorage.setItem('train-route-explorer-settings-v1', original);
                }
                """,
                setup.get("originalSettings"),
            )


    def test_mobile_pan_unbounded_pinch_zoom_and_non_overlapping_city_labels(self):
        self.driver.set_window_size(390, 844)
        self.driver.get(TEST_URL)
        try:
            setup = self.driver.execute_async_script(
                """
                const done = arguments[0];
                const appUrl = document.querySelector('script[type="module"][src*="app.js"]')?.src;
                if (!appUrl) {
                  done({ ok: false, error: 'App module script was not found' });
                  return;
                }

                const stops = [
                  { stop_name: 'Paris', lat: 48.8566, lon: 2.3522 },
                  { stop_name: 'Rouen', lat: 49.4432, lon: 1.0993 },
                  { stop_name: 'Reims', lat: 49.2583, lon: 4.0317 },
                  { stop_name: 'Orléans', lat: 47.9030, lon: 1.9093 },
                  { stop_name: 'Chartres', lat: 48.4439, lon: 1.4890 },
                  { stop_name: 'Meaux', lat: 48.9601, lon: 2.8788 },
                  { stop_name: 'Évreux', lat: 49.0241, lon: 1.1508 },
                  { stop_name: 'Melun', lat: 48.5399, lon: 2.6608 },
                  { stop_name: 'Beauvais', lat: 49.4295, lon: 2.0807 },
                  { stop_name: 'Compiègne', lat: 49.4179, lon: 2.8261 },
                  { stop_name: 'Fontainebleau', lat: 48.4047, lon: 2.7016 },
                  { stop_name: 'Versailles', lat: 48.8014, lon: 2.1301 },
                ];

                import(appUrl).then(({ app }) => {
                  app.state.selectedTab = 'out';
                  app.state.config = {
                    ...app.state.config,
                    local_origins: ['Paris'],
                    connection_stations: ['Chartres'],
                    side_b_destinations: ['Reims'],
                  };
                  app.state.routes = {
                    ...app.state.routes,
                    outward: [{
                      legs: [{
                        train_type: 'TER',
                        train_number: 'TEST',
                        path: stops,
                      }],
                    }],
                    returns: [],
                  };
                  done({ ok: true, stopCount: stops.length });
                }).catch((error) => done({ ok: false, error: String(error) }));
                """
            )
            self.assertTrue(setup.get("ok"), setup)

            map_button = self.wait.until(
                EC.element_to_be_clickable(
                    (By.CSS_SELECTOR, '#route-view-tabs [data-view="map"]')
                )
            )
            map_button.click()

            self.wait.until(
                lambda driver: driver.execute_script(
                    """
                    const svg = document.querySelector('#routes-map .route-map-canvas');
                    return Boolean(svg && svg.dataset.labelsLaidOut === 'true');
                    """
                )
            )

            def label_metrics():
                return self.driver.execute_script(
                    """
                    const svg = document.querySelector('#routes-map .route-map-canvas');
                    const labels = Array.from(svg.querySelectorAll('[data-map-label]'));
                    const visible = labels.filter(
                      (label) => parseFloat(getComputedStyle(label).opacity) > 0.5
                    );
                    const rects = visible.map((label) => ({
                      name: label.textContent.trim(),
                      rect: label.getBoundingClientRect(),
                    }));
                    const overlaps = [];
                    for (let left = 0; left < rects.length; left += 1) {
                      for (let right = left + 1; right < rects.length; right += 1) {
                        const a = rects[left].rect;
                        const b = rects[right].rect;
                        const intersects = !(
                          a.right <= b.left ||
                          a.left >= b.right ||
                          a.bottom <= b.top ||
                          a.top >= b.bottom
                        );
                        if (intersects) {
                          overlaps.push([rects[left].name, rects[right].name]);
                        }
                      }
                    }
                    const firstVisible = visible[0] || null;
                    const paris = Array.from(svg.querySelectorAll('.route-map-station')).find(
                      (group) => group.querySelector('title')?.textContent === 'Paris'
                    );
                    const parisCircle = paris?.querySelector('circle') || null;
                    return {
                      zoom: Number(svg.dataset.zoom || 1),
                      viewBoxX: svg.viewBox.baseVal.x,
                      viewBoxY: svg.viewBox.baseVal.y,
                      viewBoxWidth: svg.viewBox.baseVal.width,
                      totalLabels: labels.length,
                      visibleLabels: visible.length,
                      visibleLabelHeight: firstVisible ? firstVisible.getBoundingClientRect().height : 0,
                      labelFontSize: firstVisible ? parseFloat(getComputedStyle(firstVisible).fontSize) : 0,
                      markerScale: Number(svg.dataset.markerScale || 1),
                      parisMarkerDiameter: parisCircle ? parisCircle.getBoundingClientRect().width : 0,
                      overlaps,
                      touchAction: getComputedStyle(svg).touchAction,
                      touchPan: svg.dataset.touchPan,
                    };
                    """
                )

            basemap = self.driver.execute_script(
                """
                const svg = document.querySelector('#routes-map .route-map-canvas');
                const attribution = document.querySelector('#routes-map .route-map-attribution');
                const tiles = Array.from(svg.querySelectorAll('.route-map-tile'));
                return {
                  provider: svg.dataset.tileProvider,
                  tileZoom: Number(svg.dataset.tileZoom || 0),
                  tileCount: tiles.length,
                  tileUrls: tiles.map((tile) => tile.getAttribute('href') || ''),
                  countryOutlineCount: svg.querySelectorAll('.route-map-country').length,
                  attributionText: attribution?.textContent?.trim() || '',
                  attributionHref: attribution?.href || '',
                  attributionVisible: Boolean(
                    attribution && attribution.getBoundingClientRect().width > 0
                    && attribution.getBoundingClientRect().height > 0
                  ),
                };
                """
            )
            self.assertEqual(basemap["provider"], "OpenStreetMap")
            self.assertGreater(basemap["tileCount"], 0)
            self.assertTrue(
                all(url.startswith("https://tile.openstreetmap.org/") for url in basemap["tileUrls"]),
                basemap,
            )
            self.assertEqual(basemap["countryOutlineCount"], 0)
            self.assertTrue(basemap["attributionVisible"], basemap)
            self.assertIn("OpenStreetMap contributors", basemap["attributionText"])
            self.assertEqual(
                basemap["attributionHref"],
                "https://www.openstreetmap.org/copyright",
            )

            tile_coverage = self.driver.execute_script(
                """
                const svg = document.querySelector('#routes-map .route-map-canvas');
                const viewBox = svg.viewBox.baseVal;
                const tiles = Array.from(svg.querySelectorAll('.route-map-tile'));
                const values = tiles.map((tile) => ({
                  x: Number(tile.getAttribute('x')),
                  y: Number(tile.getAttribute('y')),
                  width: Number(tile.getAttribute('width')),
                  height: Number(tile.getAttribute('height')),
                }));
                const left = Math.min(...values.map((tile) => tile.x));
                const top = Math.min(...values.map((tile) => tile.y));
                const right = Math.max(...values.map((tile) => tile.x + tile.width));
                const bottom = Math.max(...values.map((tile) => tile.y + tile.height));
                return {
                  overscan: Number(svg.dataset.tileOverscan || 0),
                  leftMargin: viewBox.x - left,
                  rightMargin: right - (viewBox.x + viewBox.width),
                  topMargin: viewBox.y - top,
                  bottomMargin: bottom - (viewBox.y + viewBox.height),
                };
                """
            )
            self.assertGreaterEqual(tile_coverage["overscan"], 1, tile_coverage)
            self.assertGreater(tile_coverage["leftMargin"], 0, tile_coverage)
            self.assertGreater(tile_coverage["rightMargin"], 0, tile_coverage)
            self.assertGreater(tile_coverage["topMargin"], 0, tile_coverage)
            self.assertGreater(tile_coverage["bottomMargin"], 0, tile_coverage)

            before = label_metrics()
            self.assertEqual(before["totalLabels"], setup["stopCount"])
            self.assertGreater(before["visibleLabels"], 0)
            self.assertEqual(before["overlaps"], [])
            self.assertEqual(before["touchAction"], "none")
            self.assertEqual(before["touchPan"], "enabled")
            self.assertGreaterEqual(before["labelFontSize"], 12.5)
            self.assertGreater(before["visibleLabelHeight"], 10)
            self.assertAlmostEqual(before["markerScale"], 1.0, delta=0.05)

            pinch = self.driver.execute_script(
                """
                const svg = document.querySelector('#routes-map .route-map-canvas');
                const paris = Array.from(svg.querySelectorAll('.route-map-station')).find(
                  (group) => group.querySelector('title')?.textContent === 'Paris'
                );
                const circle = paris?.querySelector('circle');
                if (!circle) return { ok: false, error: 'Paris station marker not found' };

                const rect = circle.getBoundingClientRect();
                const centerX = (rect.left + rect.right) / 2;
                const centerY = (rect.top + rect.bottom) / 2;
                const dispatch = (type, pointerId, clientX, clientY) => {
                  svg.dispatchEvent(new PointerEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    pointerId,
                    pointerType: 'touch',
                    clientX,
                    clientY,
                  }));
                };

                const initialWidth = svg.viewBox.baseVal.width;
                dispatch('pointerdown', 1, centerX - 20, centerY);
                dispatch('pointerdown', 2, centerX + 20, centerY);
                dispatch('pointermove', 1, centerX - 220, centerY);
                dispatch('pointermove', 2, centerX + 220, centerY);
                dispatch('pointerup', 1, centerX - 220, centerY);
                dispatch('pointerup', 2, centerX + 220, centerY);

                return {
                  ok: true,
                  initialWidth,
                  finalWidth: svg.viewBox.baseVal.width,
                  zoom: Number(svg.dataset.zoom || 1),
                };
                """
            )
            self.assertTrue(pinch.get("ok"), pinch)
            self.assertLess(pinch["finalWidth"], pinch["initialWidth"])
            self.assertGreater(
                pinch["zoom"],
                6,
                f"Pinch zoom should not stop at the old 6× cap: {pinch}",
            )

            self.wait.until(
                lambda driver: driver.execute_script(
                    """
                    const svg = document.querySelector('#routes-map .route-map-canvas');
                    return Boolean(svg && svg.dataset.labelsLaidOut === 'true');
                    """
                )
            )

            self.wait.until(
                lambda driver: driver.execute_script(
                    """
                    const svg = document.querySelector('#routes-map .route-map-canvas');
                    return Number(svg?.dataset.tileZoom || 0) > arguments[0];
                    """,
                    basemap["tileZoom"],
                )
            )
            zoomed_basemap = self.driver.execute_script(
                """
                const svg = document.querySelector('#routes-map .route-map-canvas');
                return {
                  tileZoom: Number(svg.dataset.tileZoom || 0),
                  tileCount: svg.querySelectorAll('.route-map-tile').length,
                };
                """
            )
            self.assertGreater(zoomed_basemap["tileZoom"], basemap["tileZoom"])
            self.assertGreater(zoomed_basemap["tileCount"], 0)

            after = label_metrics()
            self.assertGreater(after["zoom"], 6)
            # At high zoom, fewer stations can remain inside the viewport even
            # though their labels are laid out correctly.
            self.assertGreater(after["visibleLabels"], 0, after)
            self.assertEqual(after["totalLabels"], before["totalLabels"])
            self.assertEqual(after["overlaps"], [])
            self.assertGreater(after["markerScale"], before["markerScale"])
            self.assertLessEqual(after["markerScale"], 1.66)
            self.assertGreater(after["parisMarkerDiameter"], before["parisMarkerDiameter"])

            tile_probe = self.driver.execute_script(
                """
                const svg = document.querySelector('#routes-map .route-map-canvas');
                const viewBox = svg.viewBox.baseVal;
                const centerX = viewBox.x + viewBox.width / 2;
                const centerY = viewBox.y + viewBox.height / 2;
                const tile = Array.from(svg.querySelectorAll('.route-map-tile')).find((candidate) => {
                  const x = Number(candidate.getAttribute('x'));
                  const y = Number(candidate.getAttribute('y'));
                  const width = Number(candidate.getAttribute('width'));
                  const height = Number(candidate.getAttribute('height'));
                  return centerX >= x && centerX <= x + width && centerY >= y && centerY <= y + height;
                });
                if (!tile) return '';
                tile.dataset.reuseProbe = 'true';
                return tile.dataset.tileKey || '';
                """
            )
            self.assertTrue(tile_probe, "Expected a center OSM tile to mark for reuse")

            pan = self.driver.execute_script(
                """
                const svg = document.querySelector('#routes-map .route-map-canvas');
                const rect = svg.getBoundingClientRect();
                const startX = rect.left + rect.width * 0.55;
                const startY = rect.top + rect.height * 0.55;
                const dispatch = (type, pointerId, clientX, clientY) => {
                  svg.dispatchEvent(new PointerEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    pointerId,
                    pointerType: 'touch',
                    clientX,
                    clientY,
                  }));
                };
                const before = {
                  x: svg.viewBox.baseVal.x,
                  y: svg.viewBox.baseVal.y,
                };
                dispatch('pointerdown', 7, startX, startY);
                dispatch('pointermove', 7, startX - 55, startY - 35);
                dispatch('pointerup', 7, startX - 55, startY - 35);
                return {
                  before,
                  after: {
                    x: svg.viewBox.baseVal.x,
                    y: svg.viewBox.baseVal.y,
                  },
                };
                """
            )
            self.assertNotEqual(
                (pan["before"]["x"], pan["before"]["y"]),
                (pan["after"]["x"], pan["after"]["y"]),
                f"One-finger drag should pan the map: {pan}",
            )

            self.wait.until(
                lambda driver: driver.execute_script(
                    """
                    const svg = document.querySelector('#routes-map .route-map-canvas');
                    return Boolean(svg && svg.dataset.labelsLaidOut === 'true');
                    """
                )
            )
            after_pan = label_metrics()
            self.assertEqual(after_pan["overlaps"], [])
            self.assertLessEqual(after_pan["markerScale"], 1.66)
            self.assertTrue(
                self.driver.execute_script(
                    """
                    return Boolean(document.querySelector(
                      '#routes-map .route-map-tile[data-reuse-probe="true"]'
                    ));
                    """
                ),
                "Panning should retain already loaded OSM tile nodes",
            )
        finally:
            self.driver.set_window_size(1440, 1000)


    def test_z_desktop_mouse_drag_wheel_zoom_and_map_style(self):
        self.driver.set_window_size(1440, 1000)
        self.driver.get(TEST_URL)

        setup = self.driver.execute_async_script(
            """
            const done = arguments[0];
            const appUrl = document.querySelector('script[type="module"][src*="app.js"]')?.src;
            if (!appUrl) {
              done({ ok: false, error: 'App module script was not found' });
              return;
            }

            import(appUrl).then(({ app }) => {
              app.state.selectedTab = 'out';
              app.state.config = {
                ...app.state.config,
                local_origins: ['Paris'],
                connection_stations: [],
                side_b_destinations: ['Bordeaux'],
              };
              app.state.routes = {
                ...app.state.routes,
                outward: [{
                  legs: [{
                    train_type: 'TGV INOUI',
                    train_number: 'DESKTOP',
                    path: [
                      { stop_name: 'Paris', lat: 48.8566, lon: 2.3522 },
                      { stop_name: 'Tours', lat: 47.3941, lon: 0.6848 },
                      { stop_name: 'Bordeaux', lat: 44.8378, lon: -0.5792 },
                    ],
                  }],
                }],
                returns: [],
              };
              done({ ok: true });
            }).catch((error) => done({ ok: false, error: String(error) }));
            """
        )
        self.assertTrue(setup.get("ok"), setup)

        map_button = self.wait.until(
            EC.element_to_be_clickable(
                (By.CSS_SELECTOR, '#route-view-tabs [data-view="map"]')
            )
        )
        map_button.click()

        self.wait.until(
            lambda driver: driver.execute_script(
                """
                const svg = document.querySelector('#routes-map .route-map-canvas');
                return Boolean(svg && svg.dataset.labelsLaidOut === 'true');
                """
            )
        )

        interaction = self.driver.execute_script(
            """
            const svg = document.querySelector('#routes-map .route-map-canvas');
            return {
              desktopPan: svg.dataset.desktopPan,
              wheelZoom: svg.dataset.wheelZoom,
              zoom: Number(svg.dataset.zoom || 1),
              width: svg.viewBox.baseVal.width,
              routeFilter: getComputedStyle(svg.querySelector('.route-map-route')).filter,
            };
            """
        )
        self.assertEqual(interaction["desktopPan"], "enabled")
        self.assertEqual(interaction["wheelZoom"], "enabled")
        self.assertEqual(interaction["routeFilter"], "none")

        zoomed = self.driver.execute_script(
            """
            const svg = document.querySelector('#routes-map .route-map-canvas');
            const rect = svg.getBoundingClientRect();
            const before = {
              zoom: Number(svg.dataset.zoom || 1),
              width: svg.viewBox.baseVal.width,
            };
            svg.dispatchEvent(new WheelEvent('wheel', {
              bubbles: true,
              cancelable: true,
              clientX: rect.left + rect.width * 0.5,
              clientY: rect.top + rect.height * 0.5,
              deltaY: -120,
              deltaMode: WheelEvent.DOM_DELTA_PIXEL,
            }));
            return {
              before,
              after: {
                zoom: Number(svg.dataset.zoom || 1),
                width: svg.viewBox.baseVal.width,
              },
            };
            """
        )
        self.assertGreaterEqual(
            zoomed["after"]["zoom"] / zoomed["before"]["zoom"],
            1.5,
            f"Desktop wheel zoom should react quickly to one wheel step: {zoomed}",
        )
        self.assertLess(zoomed["after"]["width"], zoomed["before"]["width"], zoomed)

        panned = self.driver.execute_script(
            """
            const svg = document.querySelector('#routes-map .route-map-canvas');
            const rect = svg.getBoundingClientRect();
            const startX = rect.left + rect.width * 0.55;
            const startY = rect.top + rect.height * 0.55;
            const dispatch = (type, clientX, clientY) => {
              svg.dispatchEvent(new PointerEvent(type, {
                bubbles: true,
                cancelable: true,
                pointerId: 11,
                pointerType: 'mouse',
                button: 0,
                buttons: type === 'pointerup' ? 0 : 1,
                clientX,
                clientY,
              }));
            };
            const before = { x: svg.viewBox.baseVal.x, y: svg.viewBox.baseVal.y };
            const originalSetAttribute = Element.prototype.setAttribute;
            let viewBoxWrites = 0;
            Element.prototype.setAttribute = function(name, value) {
              if (this === svg && name === 'viewBox') viewBoxWrites += 1;
              return originalSetAttribute.call(this, name, value);
            };
            try {
              dispatch('pointerdown', startX, startY);
              for (let step = 1; step <= 24; step += 1) {
                dispatch(
                  'pointermove',
                  startX - (80 * step / 24),
                  startY - (45 * step / 24),
                );
              }
              dispatch('pointerup', startX - 80, startY - 45);
            } finally {
              Element.prototype.setAttribute = originalSetAttribute;
            }
            return {
              before,
              after: { x: svg.viewBox.baseVal.x, y: svg.viewBox.baseVal.y },
              dragging: svg.dataset.dragging,
              viewBoxWrites,
            };
            """
        )
        self.assertNotEqual(
            (panned["before"]["x"], panned["before"]["y"]),
            (panned["after"]["x"], panned["after"]["y"]),
            panned,
        )
        self.assertEqual(panned["dragging"], "false")
        self.assertLessEqual(
            panned["viewBoxWrites"],
            2,
            f"Desktop drag should coalesce pointer moves into animation-frame updates: {panned}",
        )

        style_result = self.driver.execute_script(
            """
            const select = document.querySelector('#config-map-style');
            const map = document.querySelector('#routes-map');
            const tile = map.querySelector('.route-map-tile');
            if (!select || !tile) return { ok: false };
            select.value = 'dark';
            select.dispatchEvent(new Event('change', { bubbles: true }));
            const stored = JSON.parse(
              localStorage.getItem('train-route-explorer-settings-v1') || '{}'
            );
            return {
              ok: true,
              value: select.value,
              mapStyle: map.dataset.mapStyle,
              tileFilter: getComputedStyle(tile).filter,
              storedMapStyle: stored.mapStyle,
              insideSettings: Boolean(select.closest('.route-settings-panel')),
            };
            """
        )
        self.assertTrue(style_result.get("ok"), style_result)
        self.assertEqual(style_result["value"], "dark")
        self.assertEqual(style_result["mapStyle"], "dark")
        self.assertEqual(style_result["storedMapStyle"], "dark")
        self.assertTrue(style_result["insideSettings"])
        self.assertNotEqual(style_result["tileFilter"], "none")

        self.driver.refresh()
        persisted_style = self.wait.until(
            lambda driver: driver.execute_script(
                """
                const select = document.querySelector('#config-map-style');
                return select?.value || '';
                """
            )
        )
        self.assertEqual(persisted_style, "dark")


if __name__ == "__main__":
    unittest.main(verbosity=2)
