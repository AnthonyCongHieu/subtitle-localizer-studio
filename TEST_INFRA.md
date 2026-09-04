# E2E Test Infra: Subtitle Localizer Studio Advanced Downloader

## Test Philosophy
- Opaque-box, requirement-driven. Derived directly from ORIGINAL_REQUEST.md and user-facing requirements.
- Methodology: Category-Partition + Boundary Value Analysis (BVA) + Pairwise Combinatorial Testing + Real-World Workload Testing.
- Isolation: External network calls (ByteDance/HongGuo, yt-dlp) and device token mutations are mocked to ensure deterministic, fast execution without depending on external network state.
- Primary acceptance commands:
  - `pytest tests/ -k queue`
  - `pytest` (all 172+ tests passing)
  - `cd web && npm run build` (zero TypeScript errors)

## Feature Inventory
| # | Feature | Source (requirement) | Tier 1 (Feature) | Tier 2 (Boundary) | Tier 3 (Cross) | Tier 4 (Scenario) |
|---|---------|---------------------|:----------------:|:-----------------:|:--------------:|:-----------------:|
| 1 | R1: Custom Output Directory | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| 2 | R2: Episode Grid & Selective Download | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ | ✓ |
| 3 | R3: Multi-Drama Queue UI & Hub | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ | ✓ |
| 4 | R4: Queue Scheduler Engine | ORIGINAL_REQUEST §R4 | 8 | 6 | ✓ | ✓ |
| 5 | R5: Cover/Thumbnail Download | ORIGINAL_REQUEST §R5 | 5 | 3 | ✓ | ✓ |

## Test Architecture
- Location: `tests/t14/`
  - `test_download_queue.py`: R4 FIFO queue, auto-advance on complete/fail, pause/resume, delete, reorder, device rotation, jitter delay.
  - `test_downloader_custom_dir_and_grid.py`: R1 path validation, auto directory creation, disk scanning, selective episode download.
  - `test_queue_ui_contracts.py`: R2/R3 UI component and contract verification.
- Pass/fail semantics: Standard pytest exit code 0.

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Complexity |
|---|----------|--------------------|------------|
| 1 | 3 Dramas queued, first completes, second auto-starts with device rotation and jitter | R4, R1 | High |
| 2 | Re-downloading missing/error episodes (e.g., ep 15, 32 of 81) into custom disk path | R1, R2, R4 | High |
| 3 | Queue pause during download, reorder pending dramas, resume, cancel bottom drama | R3, R4 | High |
| 4 | Path validation with non-existent deep directory, auto-create, verify video save location | R1, R4 | Medium |
| 5 | Drama download failure gracefully triggering next drama without stalling queue | R4 | Medium |

## Coverage Thresholds
- Tier 1: >=5 per feature
- Tier 2: >=5 per feature (where boundaries exist)
- Tier 3: pairwise coverage of major feature interactions
- Tier 4: >=5 realistic application scenarios
