# T00 model decisions

No clip/model inference has occurred in T00. The required 4–8 external golden
clips and matching ground truth are absent, and no candidate weights were
downloaded. Therefore every language decision remains deliberately unpromoted.

| Language | OCR decision | Translation decision | Gate status |
| --- | --- | --- | --- |
| Chinese | `PENDING_GOLDEN_BENCHMARK` | `PENDING_GOLDEN_BENCHMARK` | Need recall, CER, PTS and runtime measurements |
| Japanese | `PENDING_GOLDEN_BENCHMARK` | `PENDING_GOLDEN_BENCHMARK` | Need recall, CER, PTS and runtime measurements |
| Korean | `PENDING_GOLDEN_BENCHMARK` | `PENDING_GOLDEN_BENCHMARK` | Need recall, CER, PTS and runtime measurements |
| English | `PENDING_GOLDEN_BENCHMARK` | `PENDING_GOLDEN_BENCHMARK` | Need recall, CER, PTS and runtime measurements |

Candidate provenance, remote pins, and any verification failures are recorded
in `T00_SOURCE_MODEL_MATRIX.json` and `T00_SOURCE_LOCK.json`; no row is a
license approval or a production-model selection.
