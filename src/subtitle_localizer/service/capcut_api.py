"""Module tích hợp CapCut / ByteDance Cloud API cho trích xuất phụ đề (ASR / STT).

Cơ chế:
- Pure Python 100% không phụ thuộc DLL/C++ binaries.
- Mô phỏng Guest Device Identity (không cần tài khoản, mật khẩu hay session cookie).
- Tự động ký request với thuật toán bảo mật CapCut PC (sign, x-ss-stub, x-tt-trace-id).
- Tải âm thanh lên đám mây ByteDance VOD qua chuẩn AWS SigV4.
- Nhận diện phụ đề chuẩn xác cao qua tác vụ `cc_audio_subtitle_asr`.
"""

from __future__ import annotations

import binascii
import datetime as dt
import hashlib
import hmac
import json
import logging
import os
from pathlib import Path
import subprocess
import tempfile
import time
from typing import Any, Callable, Dict, List, Optional, Tuple, Union
from urllib.parse import parse_qsl, quote, urlencode, urlsplit
import urllib.request
import urllib.error
import uuid

from subtitle_localizer.domain.models import SubtitleCueV1

logger = logging.getLogger(__name__)

VOD_REGION = "sdwdmwlll"
VOD_SERVICE = "vod"
DEFAULT_CAPCUT_ENDPOINT = "https://editor-api-sg.capcutapi.com"

DEFAULT_DEVICE: Dict[str, str] = {
    "aid": "359289",
    "app_name": "CapCut",
    "appvr": "8.7.0",
    "version_name": "8.7.0",
    "version_code": "8.7.0",
    "channel": "capcutpc_google",
    "device_platform": "mac",
    "device_type": "MacBookPro17,4",
    "device_brand": "MacBookPro17,4",
    "os_version": "15.7.4",
    "device_id": "76471456455646328721",
    "iid": "76471456455646328721",
    "region": "VN",
    "loc": "VN",
    "lan": "vi-VN",
    "pf": "3",
    "tdid": "76471456455646328721",
}


def compact_json(obj: Any) -> str:
    """Format python object into compact JSON string without extra whitespace."""
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def make_x_ss_stub(body_text: str) -> str:
    """Tạo header x-ss-stub (MD5 của body)."""
    return hashlib.md5(body_text.encode("utf-8")).hexdigest()


def make_trace_id() -> str:
    """Tạo W3C trace-id hợp lệ."""
    seed = uuid.uuid4().hex[:32]
    return f"00-{seed}-{seed[:16]}-01"


def make_sign_header(url: str, appvr: str, device_time: str, tdid: str) -> str:
    """Sinh header sign theo thuật toán nội bộ CapCut Desktop."""
    path = url.split("?", 1)[0]
    sign_str = f"9e2c|{path[-7:]}|3|{appvr}|{device_time}|{tdid}|11ac"
    return hashlib.md5(sign_str.encode("utf-8")).hexdigest()


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def hmac_sha256(key: bytes, msg: bytes) -> bytes:
    return hmac.new(key, msg, hashlib.sha256).digest()


def aws4_signing_key(
    secret_access_key: str,
    date_stamp: str,
    region: str = VOD_REGION,
    service: str = VOD_SERVICE,
) -> bytes:
    """Tạo khóa ký AWS SigV4 cho dịch vụ VOD của ByteDance."""
    k_date = hmac_sha256(("AWS4" + secret_access_key).encode("utf-8"), date_stamp.encode("utf-8"))
    k_region = hmac_sha256(k_date, region.encode("utf-8"))
    k_service = hmac_sha256(k_region, service.encode("utf-8"))
    return hmac_sha256(k_service, b"aws4_request")


def canonical_query(url: str) -> str:
    """Tạo query string chuẩn hóa cho AWS SigV4."""
    pairs = parse_qsl(urlsplit(url).query, keep_blank_values=True)
    return "&".join(
        quote(str(k), safe="-_.~") + "=" + quote(str(v), safe="-_.~") for k, v in sorted(pairs)
    )


def utc_now_for_vod() -> Tuple[str, str]:
    now = dt.datetime.now(dt.timezone.utc)
    return now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%a, %d %b %Y %H:%M:%S GMT")


def file_md5(path: str | Path) -> str:
    h = hashlib.md5()
    with open(path, "rb") as fp:
        for chunk in iter(lambda: fp.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def crc32_hex(data: bytes) -> str:
    return f"{binascii.crc32(data) & 0xFFFFFFFF:08x}"


def aws4_authorization(
    method: str,
    url: str,
    body: bytes,
    access_key_id: str,
    secret_access_key: str,
    session_token: str,
    amz_date: str,
) -> str:
    """Xây dựng header Authorization chuẩn AWS SigV4."""
    date_stamp = amz_date[:8]
    scope = f"{date_stamp}/{VOD_REGION}/{VOD_SERVICE}/aws4_request"
    signed_headers = "x-amz-date;x-amz-security-token"
    canonical_headers = f"x-amz-date:{amz_date}\nx-amz-security-token:{session_token}\n"
    canonical_request = "\n".join(
        [
            method,
            urlsplit(url).path,
            canonical_query(url),
            canonical_headers,
            signed_headers,
            sha256_hex(body),
        ]
    )
    string_to_sign = "\n".join(
        ["AWS4-HMAC-SHA256", amz_date, scope, sha256_hex(canonical_request.encode("utf-8"))]
    )
    sig = hmac.new(
        aws4_signing_key(secret_access_key, date_stamp),
        string_to_sign.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"AWS4-HMAC-SHA256 Credential={access_key_id}/{scope}, SignedHeaders={signed_headers}, Signature={sig}"


def common_query(
    device: Dict[str, Any], babi_param: Any = None, include_region: bool = True
) -> Dict[str, str]:
    q = {
        "app_name": device["app_name"],
        "device_type": device["device_type"],
        "os_version": device["os_version"],
        "channel": device["channel"],
        "version_name": device["version_name"],
        "device_brand": device["device_brand"],
        "device_id": device["device_id"],
        "iid": device["iid"],
        "version_code": device["version_code"],
        "device_platform": device["device_platform"],
        "aid": device["aid"],
    }
    if include_region:
        q["region"] = device.get("region", "VN")
    if babi_param is not None:
        q["babi_param"] = compact_json(babi_param)
    return q


def base_headers(device: Dict[str, Any], body_text: str) -> Dict[str, str]:
    now = str(int(time.time()))
    headers = {
        "content-type": "application/json",
        "appvr": device["appvr"],
        "ch": device["channel"],
        "device-time": now,
        "lan": device.get("lan", "vi-VN"),
        "loc": device.get("loc", "VN"),
        "pf": device.get("pf", "3"),
        "sign-ver": "1",
        "tdid": device["tdid"],
        "x-ss-stub": make_x_ss_stub(body_text),
        "x-ss-dp": device["aid"],
        "x-khronos": now,
        "x-tt-trace-id": make_trace_id(),
        "user-agent": "Cronet/TTNetVersion:1d7cc3b1 2025-07-16 QuicVersion:52c2b40d 2025-04-03",
        "store-country-code": device.get("loc", "VN").lower(),
        "store-country-code-src": "did",
        "is-dispatch-us-ttp": "0",
        "is-app-region-us-ttp": "0",
    }
    return headers


class CapCutSubtitleClient:
    """Client kết nối trực tiếp đám mây ByteDance / CapCut ASR hoàn toàn không cần tài khoản."""

    def __init__(
        self,
        endpoint: str = DEFAULT_CAPCUT_ENDPOINT,
        session_token: str = "",
        timeout: float = 60.0,
    ) -> None:
        self.endpoint = (endpoint or DEFAULT_CAPCUT_ENDPOINT).rstrip("/")
        self.session_token = session_token.strip()
        self.timeout = timeout
        self.device = DEFAULT_DEVICE

    def map_language_code(self, lang: str) -> str:
        """Chuẩn hóa mã ngôn ngữ sang định dạng chuẩn ByteDance ASR."""
        clean = (lang or "auto").lower().strip()
        if clean in ("vi", "vie", "vi-vn"):
            return "vi-VN"
        if clean in ("zh", "zho", "chi", "zh-cn", "cmn"):
            return "zh-CN"
        if clean in ("en", "eng", "en-us"):
            return "en-US"
        # Mặc định tiếng Trung đối với phim kịch ngắn
        return "zh-CN"

    def _request_upload_sign(self) -> Dict[str, Any]:
        body = {"biz": "cc_pc_text_recognize", "key_version": "v5"}
        body_text = compact_json(body)
        query = common_query(self.device, None, include_region=False)
        url = f"{self.endpoint}/lv/v1/upload_sign?{urlencode(query)}"
        headers = base_headers(self.device, body_text)
        headers["sign"] = make_sign_header(
            url, self.device["appvr"], headers["device-time"], self.device["tdid"]
        )

        req = urllib.request.Request(
            url, data=body_text.encode("utf-8"), headers=headers, method="POST"
        )
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def test_connection(self) -> Dict[str, Any]:
        """Kiểm tra kết nối trực tiếp tới đám mây CapCut ByteDance."""
        start_time = time.time()
        try:
            sign_res = self._request_upload_sign()
            latency = round((time.time() - start_time) * 1000, 1)
            ret = str(sign_res.get("ret", ""))
            if ret == "0":
                data = sign_res.get("data", {})
                space = data.get("space_name", "cc_pc_text_recognize_sg")
                return {
                    "ok": True,
                    "endpoint": self.endpoint,
                    "status_code": 200,
                    "latency_ms": latency,
                    "message": f"Kết nối đám mây CapCut ByteDance thành công ({latency}ms)! VOD Space: {space}. Sẵn sàng bóc tách phụ đề không cần tài khoản.",
                }
            return {
                "ok": False,
                "endpoint": self.endpoint,
                "status_code": 400,
                "latency_ms": latency,
                "message": f"Máy chủ CapCut phản hồi: ret={ret}, errmsg={sign_res.get('errmsg')}",
            }
        except Exception as exc:
            latency = round((time.time() - start_time) * 1000, 1)
            logger.exception("Lỗi khi kiểm tra kết nối CapCut Cloud API")
            return {
                "ok": False,
                "endpoint": self.endpoint,
                "latency_ms": latency,
                "message": f"Không thể kết nối máy chủ CapCut Cloud: {exc}",
            }

    def parse_utterances_to_cues(
        self, utterances: List[Dict[str, Any]]
    ) -> List[SubtitleCueV1]:
        """Chuyển đổi kết quả utterances của CapCut ASR sang định dạng chuẩn SubtitleCueV1."""
        cues: List[SubtitleCueV1] = []
        for ut in utterances:
            text = ut.get("text", "").strip()
            if not text:
                continue
            # ByteDance trả về millisecond (ms)
            start_ms = float(ut.get("start_time", 0))
            end_ms = float(ut.get("end_time", 0))
            start_sec = round(start_ms / 1000.0, 3)
            end_sec = round(end_ms / 1000.0, 3)

            if end_sec > start_sec:
                cues.append(
                    SubtitleCueV1(
                        cue_id=f"capcut-{uuid.uuid4().hex[:8]}",
                        start_pts=start_sec,
                        end_pts=end_sec,
                        source_text=text,
                        quality_flags=["capcut_cloud_extracted"],
                    )
                )
        cues.sort(key=lambda x: x.start_pts)
        return cues

    def extract_subtitles_from_audio(
        self,
        audio_path: str | Path,
        source_lang: str = "auto",
        progress_cb: Optional[Callable[[float, str], None]] = None,
    ) -> List[SubtitleCueV1]:
        """Tải audio lên đám mây ByteDance và nhận diện phụ đề qua CapCut Cloud ASR."""
        path_obj = Path(audio_path)
        if not path_obj.exists():
            raise FileNotFoundError(f"Không tìm thấy file audio: {audio_path}")

        data = path_obj.read_bytes()
        local_md5 = file_md5(path_obj)
        part_crc32 = crc32_hex(data)

        # 1. Cấp quyền VOD Upload Sign
        if progress_cb:
            progress_cb(0.15, "Đang kết nối đám mây CapCut ByteDance...")
        sign_res = self._request_upload_sign()
        if str(sign_res.get("ret")) != "0":
            raise RuntimeError(f"CapCut upload_sign thất bại: {sign_res}")
        creds = sign_res["data"]

        # 2. Apply Upload Inner (AWS SigV4)
        if progress_cb:
            progress_cb(0.3, "Đang xin phiên tải VOD đám mây...")
        apply_url = f"https://{creds['domain']}/top/v1?" + urlencode({
            "Action": "ApplyUploadInner",
            "SpaceName": creds["space_name"],
            "UseQuic": "false",
            "Version": "2020-11-19",
            "device_platform": "win",
        })
        amz_date, http_date = utc_now_for_vod()
        vod_headers = {
            "Authorization": aws4_authorization(
                "GET",
                apply_url,
                b"",
                creds["access_key_id"],
                creds["secret_access_key"],
                creds["session_token"],
                amz_date,
            ),
            "Date": http_date,
            "User-Agent": f"BDFileUpload({int(time.time() * 1000)})",
            "X-Amz-Date": amz_date,
            "X-Amz-Expires": "31536000",
            "X-Amz-Security-Token": creds["session_token"],
            "accept-encoding": "identity",
            "store-country-code": self.device.get("loc", "VN").lower(),
            "store-country-code-src": "did",
            "tdid": self.device["tdid"],
            "pf": self.device.get("pf", "3"),
        }
        req_apply = urllib.request.Request(apply_url, headers=vod_headers, method="GET")
        with urllib.request.urlopen(req_apply, timeout=self.timeout) as resp:
            apply_data = json.loads(resp.read().decode("utf-8"))

        node = apply_data["Result"]["InnerUploadAddress"]["UploadNodes"][0]
        store = node["StoreInfos"][0]
        upload_host = node["UploadHost"]
        store_uri = store["StoreUri"]
        upload_id = store["UploadID"]
        upload_auth = store["Auth"]
        vid = node.get("Vid") or (node.get("Vids") or [None])[0]

        # 3. Tải dữ liệu âm thanh (Transfer binary)
        if progress_cb:
            progress_cb(0.45, "Đang tải âm thanh lên máy chủ CapCut...")
        transfer_url = f"https://{upload_host}/upload/v1/{store_uri}?" + urlencode({
            "uploadid": upload_id,
            "part_number": "0",
            "phase": "transfer",
        })
        transfer_headers = {
            "Authorization": upload_auth,
            "Date": utc_now_for_vod()[1],
            "User-Agent": f"BDFileUpload({int(time.time() * 1000)})",
            "accept-encoding": "identity",
            "store-country-code": self.device.get("loc", "VN").lower(),
            "store-country-code-src": "did",
            "tdid": self.device["tdid"],
            "pf": self.device.get("pf", "3"),
            "X-Upload-Content-CRC32": part_crc32,
        }
        req_transfer = urllib.request.Request(
            transfer_url, data=data, headers=transfer_headers, method="POST"
        )
        with urllib.request.urlopen(req_transfer, timeout=120) as resp:
            pass

        # 4. Hoàn tất tải (Finish upload)
        finish_url = f"https://{upload_host}/upload/v1/{store_uri}?" + urlencode({
            "uploadmode": "part",
            "phase": "finish",
            "uploadid": upload_id,
        })
        finish_headers = {
            "Authorization": upload_auth,
            "Date": utc_now_for_vod()[1],
            "User-Agent": f"BDFileUpload({int(time.time() * 1000)})",
            "accept-encoding": "identity",
            "store-country-code": self.device.get("loc", "VN").lower(),
            "store-country-code-src": "did",
            "tdid": self.device["tdid"],
            "pf": self.device.get("pf", "3"),
        }
        req_finish = urllib.request.Request(
            finish_url, data=f"0:{part_crc32}".encode("utf-8"), headers=finish_headers, method="POST"
        )
        with urllib.request.urlopen(req_finish, timeout=60) as resp:
            pass

        # 5. Xác nhận upload (Commit Upload Inner)
        if progress_cb:
            progress_cb(0.6, "Đang xử lý âm thanh trên đám mây...")
        commit_url = f"https://{creds['domain']}/top/v1?" + urlencode({
            "Action": "CommitUploadInner",
            "SpaceName": creds["space_name"],
            "Version": "2020-11-19",
            "device_platform": "win",
        })
        commit_body = compact_json({
            "Functions": [{"Input": {"SnapshotTime": 0.0}, "Name": "Snapshot"}],
            "SessionKey": node["SessionKey"],
        })
        c_bytes = commit_body.encode("utf-8")
        amz_date, http_date = utc_now_for_vod()
        commit_headers = {
            "Authorization": aws4_authorization(
                "POST",
                commit_url,
                c_bytes,
                creds["access_key_id"],
                creds["secret_access_key"],
                creds["session_token"],
                amz_date,
            ),
            "Date": http_date,
            "User-Agent": f"BDFileUpload({int(time.time() * 1000)})",
            "X-Amz-Date": amz_date,
            "X-Amz-Expires": "31536000",
            "X-Amz-Security-Token": creds["session_token"],
            "accept-encoding": "identity",
            "content-type": "application/json",
            "store-country-code": self.device.get("loc", "VN").lower(),
            "store-country-code-src": "did",
            "tdid": self.device["tdid"],
            "pf": self.device.get("pf", "3"),
        }
        req_commit = urllib.request.Request(
            commit_url, data=c_bytes, headers=commit_headers, method="POST"
        )
        with urllib.request.urlopen(req_commit, timeout=60) as resp:
            commit_data = json.loads(resp.read().decode("utf-8"))

        res_node = commit_data["Result"]["Results"][0]
        final_vid = res_node.get("Vid") or vid
        video_meta = res_node.get("VideoMeta") or {}
        duration_ms = int(float(video_meta.get("Duration") or 10.0) * 1000)

        # 6. Gửi tác vụ nhận diện ASR
        if progress_cb:
            progress_cb(0.75, "Đang nhận diện giọng nói qua CapCut ASR...")
        babi = {
            "feature_entrance": "editor",
            "feature_entrance_detail": "editor-elements-captions-subtitle_recognition",
            "feature_key": "subtitle_recognition",
            "scenario": "video_editor",
        }
        target_lang = self.map_language_code(source_lang)
        cap_json = {
            "adjust_endtime": 200,
            "audio": final_vid,
            "audio_type": "vid",
            "caption_type": 0,
            "client_request_id": str(uuid.uuid4()),
            "duration": duration_ms,
            "enable_cache": True,
            "enter_from": "asr",
            "language": target_lang,
            "max_lines": 1,
            "md5": video_meta.get("Md5") or local_md5,
            "pack_options": {"need_attribute": True},
            "songs_info": [{"end_time": float(duration_ms) - 10.0, "id": "", "start_time": 0}],
            "translation_language": "vi-VN",
            "use_translation": False,
            "words_per_line": 15,
        }
        stt_body = {
            "bind_id": str(uuid.uuid4()).upper(),
            "can_queue": True,
            "enter_from": "asr",
            "tasks": [
                {
                    "context": str(uuid.uuid4()),
                    "payload": compact_json({"cap_json": cap_json}),
                    "req_key": "cc_audio_subtitle_asr",
                    "task_version": "v3",
                }
            ],
        }
        stt_body_text = compact_json(stt_body)
        stt_query = common_query(self.device, babi, include_region=True)
        stt_url = f"{self.endpoint}/lv/v1/common_task/new?{urlencode(stt_query)}"
        stt_headers = base_headers(self.device, stt_body_text)
        stt_headers["sign"] = make_sign_header(
            stt_url, self.device["appvr"], stt_headers["device-time"], self.device["tdid"]
        )

        req_stt = urllib.request.Request(
            stt_url, data=stt_body_text.encode("utf-8"), headers=stt_headers, method="POST"
        )
        with urllib.request.urlopen(req_stt, timeout=60) as resp:
            stt_res = json.loads(resp.read().decode("utf-8"))

        if str(stt_res.get("ret")) != "0":
            raise RuntimeError(f"Gửi tác vụ CapCut ASR thất bại: {stt_res}")

        task_info = stt_res["data"]["tasks"][0]
        task_id = task_info["id"]
        task_token = task_info["token"]

        # 7. Thăm dò kết quả ASR
        if progress_cb:
            progress_cb(0.9, "Đang bóc tách câu thoại và mốc thời gian...")
        query_body = {
            "tasks": [
                {
                    "bind_id": "",
                    "id": task_id,
                    "req_key": "cc_audio_subtitle_asr",
                    "task_version": "v3",
                    "token": task_token,
                }
            ]
        }
        query_body_text = compact_json(query_body)
        query_q = common_query(self.device, None, include_region=False)
        query_url = f"{self.endpoint}/lv/v1/common_task/query?{urlencode(query_q)}"
        query_headers = base_headers(self.device, query_body_text)
        query_headers["sign"] = make_sign_header(
            query_url, self.device["appvr"], query_headers["device-time"], self.device["tdid"]
        )

        for _ in range(30):
            time.sleep(1.0)
            req_poll = urllib.request.Request(
                query_url, data=query_body_text.encode("utf-8"), headers=query_headers, method="POST"
            )
            with urllib.request.urlopen(req_poll, timeout=30) as resp:
                poll_res = json.loads(resp.read().decode("utf-8"))

            q_tasks = (poll_res.get("data") or {}).get("tasks") or []
            if q_tasks:
                status = q_tasks[0].get("status")
                if status in ("succeed", "success"):
                    resp_str = q_tasks[0].get("resp") or q_tasks[0].get("payload") or "{}"
                    resp_dict = json.loads(resp_str) if isinstance(resp_str, str) else resp_str
                    utterances = resp_dict.get("utterances") or []
                    return self.parse_utterances_to_cues(utterances)
                if status == "failed":
                    raise RuntimeError(f"Tác vụ CapCut ASR báo lỗi thất bại: {poll_res}")

        raise TimeoutError("Hết thời gian chờ kết quả phụ đề từ CapCut Cloud ASR.")

    def extract_subtitles_from_video(
        self,
        video_path: str | Path,
        source_lang: str = "auto",
        progress_cb: Optional[Callable[[float, str], None]] = None,
    ) -> List[SubtitleCueV1]:
        """Tự động tách âm thanh 16kHz từ video và gửi tới CapCut Cloud ASR."""
        v_path = Path(video_path)
        if not v_path.exists():
            raise FileNotFoundError(f"Không tìm thấy file video: {video_path}")

        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp_audio:
            tmp_audio_path = Path(tmp_audio.name)

        try:
            if progress_cb:
                progress_cb(0.05, "Đang trích xuất luồng âm thanh 16kHz...")
            cmd = [
                "ffmpeg",
                "-y",
                "-i",
                str(v_path),
                "-vn",
                "-ar",
                "16000",
                "-ac",
                "1",
                "-b:a",
                "64k",
                str(tmp_audio_path),
            ]
            subprocess.run(
                cmd,
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return self.extract_subtitles_from_audio(
                tmp_audio_path, source_lang=source_lang, progress_cb=progress_cb
            )
        finally:
            if tmp_audio_path.exists():
                try:
                    tmp_audio_path.unlink()
                except Exception:
                    pass
