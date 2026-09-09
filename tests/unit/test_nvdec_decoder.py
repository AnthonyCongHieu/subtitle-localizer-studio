from pathlib import Path

from subtitle_localizer.detector.nvdec_decoder import NvdecVideoDecoder


def test_decoder_requires_existing_path_before_open() -> None:
    decoder = NvdecVideoDecoder(Path("does-not-exist.mp4"))
    assert decoder.open() is False
    assert decoder.is_hw is False
