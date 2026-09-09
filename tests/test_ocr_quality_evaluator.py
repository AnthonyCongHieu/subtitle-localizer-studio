import pytest

from subtitle_localizer.evaluation.ocr_quality import evaluate_srt_pair, parse_srt


def test_evaluate_srt_pair_reports_cer_recall_and_timing(tmp_path):
    truth = tmp_path / "truth.srt"
    output = tmp_path / "output.srt"
    truth.write_text("1\n00:00:01,000 --> 00:00:02,000\n你好\n\n2\n00:00:03,000 --> 00:00:04,000\n世界\n", encoding="utf-8")
    output.write_text("1\n00:00:01,100 --> 00:00:02,000\n你号\n\n2\n00:00:03,000 --> 00:00:04,000\n世界\n", encoding="utf-8")
    result = evaluate_srt_pair(truth, output)
    assert result["cue_recall"] == 1.0
    assert result["ocr_cer"] == 0.25
    assert result["timing_median_ms"] == 50.0
    assert result["timing_p95_ms"] == 100.0


def test_parse_srt_rejects_invalid_utf8_timestamp(tmp_path):
    path = tmp_path / "bad.srt"
    path.write_text("1\ninvalid --> 00:00:01,000\ntext\n", encoding="utf-8")
    with pytest.raises(ValueError):
        parse_srt(path)
