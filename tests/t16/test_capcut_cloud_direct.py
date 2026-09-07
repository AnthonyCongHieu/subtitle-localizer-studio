import json
import pytest
from unittest.mock import patch, MagicMock

from subtitle_localizer.service.capcut_api import (
    CapCutSubtitleClient,
    make_sign_header,
    make_x_ss_stub,
    aws4_signing_key,
)
from subtitle_localizer.cloud.capcut_bridge import CapCutBridgeExtractor


def test_capcut_signing_helpers():
    # 1. Test make_x_ss_stub
    stub = make_x_ss_stub('{"test": 123}')
    assert len(stub) == 32
    assert isinstance(stub, str)

    # 2. Test make_sign_header
    url = "https://editor-api-sg.capcutapi.com/lv/v1/upload_sign?aid=359289"
    sign = make_sign_header(url, "8.7.0", "1788764000", "76471456455646328721")
    assert len(sign) == 32
    assert isinstance(sign, str)

    # 3. Test aws4_signing_key
    key = aws4_signing_key("test_secret", "20260907")
    assert len(key) == 32
    assert isinstance(key, bytes)


def test_capcut_language_mapping():
    client = CapCutSubtitleClient()
    assert client.map_language_code("vi") == "vi-VN"
    assert client.map_language_code("vie") == "vi-VN"
    assert client.map_language_code("zh") == "zh-CN"
    assert client.map_language_code("zh-CN") == "zh-CN"
    assert client.map_language_code("en") == "en-US"
    assert client.map_language_code("auto") == "zh-CN"


def test_capcut_parse_utterances_to_cues():
    client = CapCutSubtitleClient()
    sample_utterances = [
        {
            "start_time": 2800,
            "end_time": 4380,
            "text": "你老婆睡了我老公",
        },
        {
            "start_time": 4920,
            "end_time": 6380,
            "text": "还不止一次",
        },
    ]

    cues = client.parse_utterances_to_cues(sample_utterances)
    assert len(cues) == 2
    assert cues[0].start_pts == 2.8
    assert cues[0].end_pts == 4.38
    assert cues[0].source_text == "你老婆睡了我老公"
    assert "capcut_cloud_extracted" in cues[0].quality_flags

    assert cues[1].start_pts == 4.92
    assert cues[1].end_pts == 6.38
    assert cues[1].source_text == "还不止一次"


def test_capcut_test_connection_mocked():
    client = CapCutSubtitleClient()
    with patch.object(client, "_request_upload_sign") as mock_sign:
        mock_sign.return_value = {
            "ret": "0",
            "errmsg": "success",
            "data": {
                "domain": "vas-alisg16.byteoversea.com",
                "space_name": "cc_pc_text_recognize_sg",
            }
        }
        res = client.test_connection()
        assert res["ok"] is True
        assert res["status_code"] == 200
        assert "ByteDance" in res["message"]
