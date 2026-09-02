# T00 evidence — Foundation, Evidence, and Benchmark Harness

## Scope and baseline

- Ticket: `T00` only (`T00-R01` through `T00-R12`); no API, worker, UI, OCR
  adapter, model weights, database, real media, credentials, or T01–T11
  artifacts were added.
- Branch at start: `ticket/t00-foundation`.
- Baseline commit supplied by the ticket: `6488975eeca6fdde39055a95fe8350428e761cbb`.
- Baseline worktree status: clean (`git status --short` produced no output).
- Baseline tree-inventory SHA-256: `7e698da97a84f8e737a11f17e48226c1c88ab89b7d764e31c86aec192664321b`
  (SHA-256 of UTF-8 `git ls-tree -r --full-tree` output for the baseline).
- Final `git diff --check` exit code: `0`.

## Minimal patch summary

- `src/subtitle_localizer_t00/` provides only T00 validation/probe utilities:
  runtime capability collection, external golden-manifest/hash validation,
  synthetic-fixture manifest validation, benchmark dry-run result construction,
  provenance completeness validation, and UTF-8/mojibake scanning.
- `scripts/t00/` provides CLI harness commands. They do not import or implement
  later production layers.
- `fixtures/synthetic/generated/` and `benchmarks/results/` are ignored. The
  fixture script generates local media but no media bytes are committed.

## Red-first evidence

1. Command:

   ```powershell
   & 'C:\Users\PC\AppData\Local\Programs\Python\Python311\python.exe' -m unittest tests.t00.test_foundation -v
   ```

   Exit code: `1`. Expected failure: `ModuleNotFoundError: No module named
   'subtitle_localizer_t00'` before the T00 module existed.

2. Command:

   ```powershell
   & 'C:\Users\PC\AppData\Local\Programs\Python\Python311\python.exe' -m unittest tests.t00.test_foundation.FixtureManifestTests.test_detects_non_uniform_frame_intervals_for_vfr_fixture_verification -v
   ```

   Exit code: `1`. Expected failure: missing
   `has_variable_frame_intervals` before the VFR timestamp check existed.

The first post-implementation test run also exposed that the test helper had
only one golden entry while the product contract requires 4–8. The test fixture
was corrected to four explicit entries; no production behavior was relaxed.

## Green, adjacent, and regression evidence

| Command | Purpose | Exit |
| --- | --- | --- |
| `Python311\python.exe -m unittest tests.t00.test_foundation -v` | Focused T00 unit behavior | `0` (13 tests at that point) |
| `Python311\python.exe -m unittest tests.t00.test_foundation.FixtureManifestTests.test_detects_non_uniform_frame_intervals_for_vfr_fixture_verification -v` | VFR interval test after implementation | `0` |
| `Python311\python.exe -m pytest -q tests/t00` | Targeted T00 regression suite | `0` (14 passed) |
| `Python311\python.exe -m pytest -q` | Full configured regression suite | `0` (14 passed) |
| `Python311\python.exe -m compileall -q src scripts` | Python syntax/static smoke check | `0` |
| `Python311\python.exe scripts/t00/probe_runtime.py` | Runtime-probe JSON generation | `0` |
| `Python311\python.exe scripts/t00/validate_fixtures.py --verify-files` | CFR/VFR file/hash/ffprobe-manifest validation | `0` |
| Re-run `scripts/t00/generate_fixtures.py` and compare manifest SHA-256 values | Determinism smoke check | `0` |
| `Python311\python.exe scripts/t00/validate_provenance.py` | Source/model provenance validation | `0` |
| `Python311\python.exe scripts/t00/validate_golden.py benchmarks/golden_manifest.example.json` | Golden schema/external-path validation without files | `0` |
| `Python311\python.exe scripts/t00/run_benchmark_dry.py` | Explicit no-inference dry run | `0`, decision `not_run` |
| `Python311\python.exe scripts/t00/validate_golden.py benchmarks/golden_manifest.example.json --verify-files` | Strict golden availability gate | `1` expected: all four external clips and ground-truth files are absent |
| `Python311\python.exe scripts/t00/utf8_scan.py .` | UTF-8/replacement/mojibake scan | `0` |
| `git diff --check` | Whitespace regression check | `0` |

No formatter, linter, or type checker was configured in the baseline. The
project's Python launcher (`py`) was broken because it pointed at missing
`D:\App\python.exe`; all commands above use the discovered Python 3.11
interpreter explicitly.

## Runtime and fixtures

- Machine-readable probe: `benchmarks/runtime_probe.json`.
- Probe records Windows 10, Python 3.11.9, Node v20.20.2, FFmpeg
  `8.0-full_build-www.gyan.dev`, libass and NVENC compile/encoder discovery,
  16 logical CPU cores, 29,758,447,616 bytes RAM, RTX 3050 6 GB Laptop GPU,
  and workspace disk capacity/free space.
- Fixture generation used local FFmpeg only. The generated VFR file records
  frame PTS seconds `0, 0.7, 1.8, 2.4, 3.7, 4.9`; the harness rejects an output
  without variable frame intervals.
- Deterministic current fixture hashes: CFR
  `70ea0e87c5381b41814a5589afeb2668b64545e4b31a191b059064d0c7f30a29` and
  VFR `dac31533b41a20fe4ef091df199dd2be6e06055805a26751c53c03889230b`.

## Provenance and model decisions

- Candidate research matrix: `docs/research/T00_SOURCE_MODEL_MATRIX.json`.
- Reproducible public-metadata lock: `docs/research/T00_SOURCE_LOCK.json`.
  It contains 40-character pins for Video Subtitle Extractor, VideoSubFinder,
  PaddleOCR v5/v6, PaddleOCR-VL, TranslateGemma, MADLAD-400, NLLB-200,
  OPUS-MT, Video Subtitle Remover, ProPainter, pyVideoTrans, and VieNeu-TTS.
- The lock command uses public GitHub/Hugging Face HTTPS metadata. It does not
  download weights or require a credential. A separately user-authorized
  interactive Hugging Face `git ls-remote` retry did not yield a usable SHA
  (the controller observed exit `1` because password authentication is not
  supported); no credential or authentication output is recorded here. The
  public-metadata SHA is the reproducible lock evidence and is not treated as
  authenticated/gated verification.
- Any license field marked `UNVERIFIED` or `review required` remains unapproved
  by design; no license, source pin, or model decision was invented.
- `docs/research/T00_MODEL_DECISIONS.md` marks Chinese, Japanese, Korean, and
  English OCR/translation decisions `PENDING_GOLDEN_BENCHMARK`. No model
  inference or quality score was claimed.

## Blockers and reviewer status

- **BLOCKED QUALITY GATE:** the required 4–8 user-supplied external golden
  clips and their ground truth do not exist at the declared external paths.
  Consequently cue recall, timing error, CER, translation quality, VRAM, and
  promotion gates are not measured. The dry-run result is explicitly `not_run`.
- Initial reviewer verdict: `PENDING_REVIEW`. This is not self-approval; an
  independent reviewer must replace it with the appropriate final verdict.

STOPPED_AFTER_TICKET
