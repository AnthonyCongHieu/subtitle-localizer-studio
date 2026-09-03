# T13 evidence — Real MP4 export

Date: 2026-09-03.

## Scope

- Replace the web editor's simulated MP4 success with a real
  UI-to-FastAPI-to-FFmpeg export flow.
- Save completed video files under `outputs/<project-id>/` and report the
  absolute path to the user. Automatic browser download is intentionally out
  of scope.
- Keep synchronous rendering for this ticket. Worker isolation, jobs,
  cancellation, and progress are separate follow-up work.
- Security hardening is excluded by the user because this is an internal-only
  application.

## Implementation

- Added `POST /api/v1/projects/{project_id}/export/mp4` with translated/source
  subtitle selection and `box`, `blur`, or `none` masking.
- Generate a temporary UTF-8 ASS file from persisted cues, use the saved ROI or
  the default lower band, and invoke the existing atomic `VideoExporter`.
- Prefer NVENC and preserve the existing libx264 fallback.
- Save the final file as
  `outputs/<project-id>/<source-stem>-localized.mp4`.
- Make preparation/render failures explicit and prevent temporary-file cleanup
  from hiding the primary result.
- Replace the React timeout with a real API request and show either the returned
  output path or the backend error.
- Correct blur overlay expressions to use FFmpeg overlay variables
  `main_w`/`main_h` while retaining crop variables `iw`/`ih`.

## Red-first evidence

1. Endpoint contract:
   - Command:
     `python -m pytest tests/t07/test_service_worker.py::ServiceAndWorkerTest::test_mp4_export_renders_to_outputs_and_returns_real_path -q`
   - Initial result: exit `1`; expected `200`, received `404` because the route
     did not exist.
   - After implementation: exit `0`; `1 passed`.
2. Real blur and ASS filter composition:
   - Command:
     `python -m pytest tests/t10/test_render_export.py::RenderAndExportTest::test_blur_mask_can_be_composed_with_ass_subtitles -q`
   - Initial result: exit `1`; FFmpeg rejected `iw`/`ih` in the overlay
     expression.
   - After the focused fix: exit `0`; `1 passed`.
3. Explicit preparation failure:
   - Command:
     `python -m pytest tests/t07/test_service_worker.py::ServiceAndWorkerTest::test_mp4_export_reports_ass_generation_failure -q`
   - Initial valid regression result: exit `1`; the endpoint returned a plain
     `Internal Server Error` instead of the ASS-generation reason.
   - After widening the guarded export boundary: exit `0`; `1 passed`.

One earlier attempt at the failure regression exited `1` for an incomplete test
fixture (`source_language` was missing). The fixture was corrected and the test
was rerun to obtain the expected production failure above before changing
production code.

## Render smoke

- A one-second 320x240 synthetic MP4 plus UTF-8 ASS was rendered with box
  masking through `VideoExporter.render_video(use_nvenc=True)`.
- Initial harness command: exit `1`, because `PYTHONPATH=src` was omitted; no
  product failure was inferred.
- Corrected command: exit `0`; output size `3031` bytes.
- The real FFmpeg integration test also renders blur masking plus ASS through
  libx264 and verifies a non-empty MP4.

## Verification

| Command | Result |
| --- | --- |
| `python -m pytest tests/t07/test_service_worker.py tests/t10/test_render_export.py -q` | exit `0`, 13 passed |
| `python -m pytest -q` | exit `0`, 136 passed |
| `python -m compileall -q src scripts tests` | exit `0` |
| `python scripts/t00/utf8_scan.py .` | exit `0` |
| `npm ci` in `web` | exit `0`; 135 packages installed |
| `npm run build` in `web` | exit `0`; 43 modules transformed |
| `git diff --check` | exit `0`; only LF-to-CRLF working-copy warnings |

`npm ci` reported two dependency audit findings (one moderate and one high).
Force-upgrading dependencies is outside this internal MP4 export ticket.

## Independent reviewer verdict

- First review: `CHANGES_REQUIRED` because preparation and cleanup failures
  could bypass or mask the explicit API error.
- A red-first failure-path regression was added and the guarded boundary was
  corrected.
- Final re-review: `APPROVED`; no Critical, Important, or Minor findings.

STOPPED_AFTER_TICKET
