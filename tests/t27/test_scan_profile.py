import sys
import unittest
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer.service.pipeline_settings import ExtractionSettings, resolve_ocr_scan_profile


class ScanProfileTest(unittest.TestCase):
    def test_vertical_short_keeps_rescue(self) -> None:
        ocr = ExtractionSettings(scan_profile="vertical_short", enable_adaptive_rescue=False)
        out = resolve_ocr_scan_profile(ocr)
        self.assertEqual(out.scan_profile, "vertical_short")
        self.assertTrue(out.enable_adaptive_rescue)

    def test_fixed_roi_disables_rescue_and_shift(self) -> None:
        ocr = ExtractionSettings(
            scan_profile="fixed_roi",
            enable_adaptive_rescue=True,
            enable_roi_tightening=True,
            enable_gap_rescue=True,
        )
        out = resolve_ocr_scan_profile(ocr)
        self.assertEqual(out.scan_profile, "fixed_roi")
        self.assertFalse(out.enable_adaptive_rescue)
        self.assertFalse(out.enable_roi_tightening)
        self.assertFalse(out.enable_gap_rescue)

    def test_alias_fixed_maps_to_fixed_roi(self) -> None:
        out = resolve_ocr_scan_profile(ExtractionSettings(scan_profile="fixed"))
        self.assertEqual(out.scan_profile, "fixed_roi")
        self.assertFalse(out.enable_adaptive_rescue)


if __name__ == "__main__":
    unittest.main()
