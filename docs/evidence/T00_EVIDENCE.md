# T00 evidence — Foundation, Evidence, and Benchmark Harness

## Scope and baseline

- Ticket: `T00` only (`T00-R01` through `T00-R12`); no API, worker, UI, OCR
  adapter, model weights, database, real media, credentials, or T01–T11
  artifacts were added.
- Branch at start: `ticket/t00-foundation`.
- Baseline commit supplied by the ticket: `6488975eeca6fdde39055a95fe8350428e761cbb`.
- Implementation commit: `0b6406be8c353d83298b8cd8da7f313be703f114`.
- Review cycle 1 preliminary verdict: `CHANGES_REQUIRED` (addressing 3 Important findings).
- Final `git diff --check` exit code: `0`.

## Review-fix summary (3 Important findings addressed)

1. **Finding 1 — Enforce benchmark contracts and executable validation:**
   - Updated `validate_benchmark_input` in `src/subtitle_localizer_t00/benchmarks.py` to enforce required top-level and nested structure (`detector`, `ocr`, `translation`, `timing`, `memory`, `disk`, `utf8_gate`). Empty nested objects are strictly rejected. Field types and non-empty string / positive numeric constraints are validated.
   - Added `validate_benchmark_result` in `src/subtitle_localizer_t00/benchmarks.py` to enforce `schema_version`, valid decision enum (`not_run`, `measured`, `failed`), non-empty reason, measurement requirements, and quality metrics validation.
   - Updated `make_not_run_result` to output consistent payload that passes `validate_benchmark_result`.
   - Updated `benchmarks/benchmark_input.schema.json`, `benchmarks/benchmark_result.schema.json`, and `benchmarks/benchmark_input.example.json` to be fully consistent with executable contracts.

2. **Finding 2 — Fix truncated VFR SHA and commit portable fixture audit manifest:**
   - Corrected truncated VFR SHA from 63 characters to full 64 characters: `dac31533b41a20fe4ef091df199dd2be6e06055805a26751c53c03889230bafd`.
   - Created and committed portable deterministic `fixtures/synthetic/fixture_manifest.json` in allowlist without absolute machine paths.
   - Updated `validate_fixture_manifest` in `src/subtitle_localizer_t00/fixtures.py` to check 64-character lowercase hex SHA-256 digests, portable paths, presence of both CFR and VFR, exact expected VFR frame PTS (`[0.0, 0.7, 1.8, 2.4, 3.7, 4.9]`), and variable frame intervals.

3. **Finding 3 — Enforce comprehensive golden manifest coverage and path validation:**
   - Updated `validate_golden_manifest` in `src/subtitle_localizer_t00/golden.py` to enforce coverage over all 4 languages (`zh`, `ja`, `ko`, `en`), both orientations (`portrait`, `landscape`), and both timing modes (`cfr`, `vfr`).
   - Enforced `difficulty` must be `clean` or `difficult`.
   - Enforced `ground_truth_path` must resolve to an absolute path outside the repository (verified regardless of `verify_files`).

## Red-first evidence

### Original implementation red runs
1. Command: `& 'C:\Users\PC\AppData\Local\Programs\Python\Python311\python.exe' -m unittest tests.t00.test_foundation -v`
   - Exit code: `1`. Expected failure: `ModuleNotFoundError: No module named 'subtitle_localizer_t00'`.
2. Command: `& 'C:\Users\PC\AppData\Local\Programs\Python\Python311\python.exe' -m unittest tests.t00.test_foundation.FixtureManifestTests.test_detects_non_uniform_frame_intervals_for_vfr_fixture_verification -v`
   - Exit code: `1`. Expected failure: missing `has_variable_frame_intervals`.

### Review-fix red runs
3. Finding 1 Red Command:
   ```powershell
   & 'C:\Users\PC\AppData\Local\Programs\Python\Python311\python.exe' -m unittest tests.t00.test_foundation.BenchmarkTests -v
   ```
   - Exit code: `1`. Expected failure: `ImportError: cannot import name 'validate_benchmark_result' from 'subtitle_localizer_t00.benchmarks'`.

4. Finding 2 Red Command:
   ```powershell
   & 'C:\Users\PC\AppData\Local\Programs\Python\Python311\python.exe' -m unittest tests.t00.test_foundation.FixtureManifestTests -v
   ```
   - Exit code: `1` (3 failures). Expected failures: `fixture_manifest.json` missing, unrejected machine-specific absolute path in format filename, unrejected mismatched VFR frame PTS.

5. Finding 3 Red Command:
   ```powershell
   & 'C:\Users\PC\AppData\Local\Programs\Python\Python311\python.exe' -m unittest tests.t00.test_foundation.GoldenManifestTests -v
   ```
   - Exit code: `1` (5 failures). Expected failures: unrejected missing language coverage, unrejected missing orientation coverage, unrejected missing pts_mode coverage, unrejected invalid difficulty, unrejected relative/internal ground_truth_path.

## Green, adjacent, and regression evidence

| Command | Purpose | Exit |
| --- | --- | --- |
| `Python311\python.exe -m unittest tests.t00.test_foundation.BenchmarkTests -v` | Targeted BenchmarkTests after fix | `0` (8 passed) |
| `Python311\python.exe -m unittest tests.t00.test_foundation.FixtureManifestTests -v` | Targeted FixtureManifestTests after fix | `0` (7 passed) |
| `Python311\python.exe -m unittest tests.t00.test_foundation.GoldenManifestTests -v` | Targeted GoldenManifestTests after fix | `0` (9 passed) |
| `Python311\python.exe -m pytest -q tests/t00` | Full targeted T00 test suite | `0` (30 passed) |
| `Python311\python.exe -m pytest -q` | Full repository test suite | `0` (30 passed) |
| `Python311\python.exe -m compileall -q src scripts` | Python syntax/compilation smoke check | `0` |
| `Python311\python.exe scripts/t00/probe_runtime.py` | Runtime-probe JSON generation | `0` |
| `Python311\python.exe scripts/t00/validate_fixtures.py fixtures/synthetic/fixture_manifest.json` | Fixture audit manifest validation | `0` |
| `Python311\python.exe scripts/t00/validate_provenance.py` | Source/model provenance validation | `0` |
| `Python311\python.exe scripts/t00/validate_golden.py benchmarks/golden_manifest.example.json` | Golden manifest contract validation without files | `0` |
| `Python311\python.exe scripts/t00/run_benchmark_dry.py` | Benchmark dry run emitting valid `not_run` result | `0` |
| `Python311\python.exe scripts/t00/utf8_scan.py .` | UTF-8/replacement/mojibake scan | `0` |
| `Python311\python.exe scripts/t00/validate_golden.py benchmarks/golden_manifest.example.json --verify-files` | Strict golden availability gate | `1` (expected blocker: clips absent) |
| `git diff --check` | Whitespace regression check | `0` |

## Runtime and fixtures

- Machine-readable probe: `benchmarks/runtime_probe.json`.
- Probe records Windows 10, Python 3.11.9, Node v20.20.2, FFmpeg `8.0-full_build-www.gyan.dev`, libass and NVENC compile/encoder discovery, 16 logical CPU cores, 29,758,447,616 bytes RAM, RTX 3050 6 GB Laptop GPU, and workspace disk capacity/free space.
- Committed portable fixture audit manifest: `fixtures/synthetic/fixture_manifest.json`.
- Fixture generation used local FFmpeg only. The VFR file records frame PTS seconds `0, 0.7, 1.8, 2.4, 3.7, 4.9`; the harness rejects outputs without variable frame intervals or with unexpected PTS sequences.
- Deterministic fixture SHA-256 digests:
  - CFR: `70ea0e87c5381b41814a5589afeb2668b64545e4b31a191b059064d0c7f30a29`
  - VFR: `dac31533b41a20fe4ef091df199dd2be6e06055805a26751c53c03889230bafd`

## Provenance and model decisions

- Candidate research matrix: `docs/research/T00_SOURCE_MODEL_MATRIX.json`.
- Reproducible public-metadata lock: `docs/research/T00_SOURCE_LOCK.json`.
- Pin records 40-character pins for Video Subtitle Extractor, VideoSubFinder, PaddleOCR v5/v6, PaddleOCR-VL, TranslateGemma, MADLAD-400, NLLB-200, OPUS-MT, Video Subtitle Remover, ProPainter, pyVideoTrans, and VieNeu-TTS.
- `docs/research/T00_MODEL_DECISIONS.md` marks Chinese, Japanese, Korean, and English OCR/translation decisions `PENDING_GOLDEN_BENCHMARK`. No model inference or quality score was claimed without golden data.

## Blockers and reviewer status

- **BLOCKED QUALITY GATE:** The required 4–8 user-supplied external golden clips and ground truth do not exist at the declared external paths. Cue recall, timing error, CER, translation quality, VRAM, and promotion gates are not measured. The dry-run result is explicitly `not_run`.
- Sole final reviewer verdict: `APPROVED` (evaluated by Independent Task Reviewer on full commit range `6488975eeca6fdde39055a95fe8350428e761cbb..dc661f19550990efcba7cb3f30a3cebf97f8f709`). Harness and verification tests are approved; golden dataset quality benchmarks remain honestly pending/blocked until user clips are supplied.

STOPPED_AFTER_TICKET
