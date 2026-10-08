import sys
import unittest

from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC

from test_station_filter_selenium import (
    DESKTOP_SIZE,
    MOBILE_SIZE,
    ROLE_TO_LIST,
    StationFilterRegressionTest,
)


WIDGET_SELECTOR = ", ".join(
    [
        "button",
        "input:not([type='hidden'])",
        "select",
        "textarea",
        "summary",
        "a[href]",
        "progress",
        "[role='button']",
        "[role='checkbox']",
        "[role='switch']",
        "[role='tab']",
        "[role='slider']",
        "[role='spinbutton']",
        "[role='combobox']",
        "[role='textbox']",
        "[role='progressbar']",
    ]
)


def _assert_mobile_widgets_fully_visible(self, state_name):
    result = self.driver.execute_script(
        r"""
        const selector = arguments[0];
        const tolerance = 1.25;
        const candidates = Array.from(new Set(document.querySelectorAll(selector)));

        function rendered(element) {
          const style = getComputedStyle(element);
          if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
            return false;
          }
          if (element.closest('[hidden]')) return false;
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }

        function describe(element) {
          const id = element.id ? `#${element.id}` : '';
          const classes = Array.from(element.classList || []).slice(0, 3).map((name) => `.${name}`).join('');
          const role = element.getAttribute('role');
          const label = element.getAttribute('aria-label') || element.getAttribute('title') || '';
          const text = (element.textContent || element.value || '').replace(/\s+/g, ' ').trim().slice(0, 60);
          const suffix = label || text;
          return `${element.tagName.toLowerCase()}${id}${classes}${role ? `[role=${role}]` : ''}${suffix ? ` “${suffix}”` : ''}`;
        }

        function viewportRect() {
          const viewport = window.visualViewport;
          const left = viewport ? viewport.offsetLeft : 0;
          const top = viewport ? viewport.offsetTop : 0;
          const width = viewport ? viewport.width : window.innerWidth;
          const height = viewport ? viewport.height : window.innerHeight;
          return { left, top, right: left + width, bottom: top + height };
        }

        function clippingRect(element) {
          const clip = viewportRect();
          let ancestor = element.parentElement;
          while (ancestor) {
            const style = getComputedStyle(ancestor);
            const rect = ancestor.getBoundingClientRect();
            const clipsX = ['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowX);
            const clipsY = ['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowY);
            if (clipsX) {
              clip.left = Math.max(clip.left, rect.left);
              clip.right = Math.min(clip.right, rect.right);
            }
            if (clipsY) {
              clip.top = Math.max(clip.top, rect.top);
              clip.bottom = Math.min(clip.bottom, rect.bottom);
            }
            ancestor = ancestor.parentElement;
          }
          return clip;
        }

        const failures = [];
        let checked = 0;
        for (const element of candidates) {
          if (!rendered(element)) continue;

          // Center each widget through nested scroll containers before
          // measuring it. With "nearest", Chromium can satisfy an inner
          // checklist scroller while that checklist is still partly outside
          // the viewport, producing a false clipping failure.
          element.scrollIntoView({ block: 'center', inline: 'nearest' });
          if (!rendered(element)) continue;

          const rect = element.getBoundingClientRect();
          const clip = clippingRect(element);
          checked += 1;

          const fullyVisible =
            rect.left >= clip.left - tolerance &&
            rect.top >= clip.top - tolerance &&
            rect.right <= clip.right + tolerance &&
            rect.bottom <= clip.bottom + tolerance;

          if (!fullyVisible) {
            failures.push({
              widget: describe(element),
              rect: {
                left: Math.round(rect.left * 10) / 10,
                top: Math.round(rect.top * 10) / 10,
                right: Math.round(rect.right * 10) / 10,
                bottom: Math.round(rect.bottom * 10) / 10,
                width: Math.round(rect.width * 10) / 10,
                height: Math.round(rect.height * 10) / 10,
              },
              clip: {
                left: Math.round(clip.left * 10) / 10,
                top: Math.round(clip.top * 10) / 10,
                right: Math.round(clip.right * 10) / 10,
                bottom: Math.round(clip.bottom * 10) / 10,
              },
            });
          }
        }

        return {
          checked,
          failures,
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
        };
        """,
        WIDGET_SELECTOR,
    )

    self.assertGreater(result["checked"], 0, f"{state_name}: no visible widgets were inspected")
    if result["failures"]:
        details = "\n".join(
            f"- {failure['widget']}: rect={failure['rect']}, visible_bounds={failure['clip']}"
            for failure in result["failures"][:20]
        )
        extra = len(result["failures"]) - 20
        if extra > 0:
            details += f"\n- ... and {extra} more"
        self.fail(
            f"{state_name}: {len(result['failures'])} of {result['checked']} mobile widgets "
            f"were clipped at viewport {result['innerWidth']}x{result['innerHeight']}:\n{details}"
        )


def test_15_mobile_widgets_are_fully_visible(self):
    self._set_window(MOBILE_SIZE)
    try:
        self._close_overlays()
        self.driver.execute_script("window.scrollTo(0, 0);")
        _assert_mobile_widgets_fully_visible(self, "base page")

        self._close_overlays()
        self.driver.execute_script("window.scrollTo(0, 0);")
        self._open_settings()
        _assert_mobile_widgets_fully_visible(self, "route settings")

        self._close_overlays()
        self.driver.execute_script("window.scrollTo(0, 0);")
        self.driver.execute_script("document.querySelector('.data-menu').open = true;")
        self.wait.until(EC.visibility_of_element_located((By.CSS_SELECTOR, ".data-panel")))
        _assert_mobile_widgets_fully_visible(self, "data menu")

        self._close_overlays()
        self.driver.execute_script("window.scrollTo(0, 0);")
        self.driver.find_element(By.ID, "about-button").click()
        self.wait.until(EC.visibility_of_element_located((By.ID, "about-panel")))
        _assert_mobile_widgets_fully_visible(self, "about dialog")

        for role in ROLE_TO_LIST:
            with self.subTest(state=f"route selector: {role}"):
                self._close_overlays()
                self.driver.execute_script("window.scrollTo(0, 0);")
                self._open_route_selector(role)
                _assert_mobile_widgets_fully_visible(self, f"route selector: {role}")

        self._close_overlays()
        self.driver.execute_script("window.scrollTo(0, 0);")

        def open_trip_detail(driver):
            return driver.execute_script(
                """
                const row = Array.from(document.querySelectorAll('.timeline-row')).find(
                  (candidate) => candidate.querySelector('.timeline-bar.train[data-detail]') &&
                    getComputedStyle(candidate).display !== 'none'
                );
                if (!row) return false;
                row.click();
                return true;
                """
            )

        self.wait.until(open_trip_detail)
        self.wait.until(EC.visibility_of_element_located((By.ID, "train-detail-frame")))
        self.wait.until(EC.visibility_of_element_located((By.CSS_SELECTOR, ".train-detail-close")))
        _assert_mobile_widgets_fully_visible(self, "trip details")
    finally:
        self._close_overlays()
        self._set_window(DESKTOP_SIZE)


StationFilterRegressionTest.test_15_mobile_widgets_are_fully_visible = test_15_mobile_widgets_are_fully_visible


if __name__ == "__main__":
    suite = unittest.TestSuite([
        StationFilterRegressionTest("test_15_mobile_widgets_are_fully_visible"),
    ])
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
