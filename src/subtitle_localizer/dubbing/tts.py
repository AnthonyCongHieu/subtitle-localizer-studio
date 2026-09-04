from __future__ import annotations

import asyncio
import logging
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np

from subtitle_localizer.domain.models import SubtitleCueV1

logger = logging.getLogger(__name__)

AVAILABLE_VOICES: Dict[str, str] = {
    "nam": "vi-VN-NamMinhNeural",
    "nu": "vi-VN-HoaiMyNeural",
    "nam_mien_bac": "vi-VN-NamMinhNeural",
    "nu_mien_bac": "vi-VN-HoaiMyNeural",
    "nam_mien_nam": "vi-VN-NamMinhNeural",
    "nu_mien_nam": "vi-VN-HoaiMyNeural",
    "male": "vi-VN-NamMinhNeural",
    "female": "vi-VN-HoaiMyNeural",
    "vi-VN-NamMinhNeural": "vi-VN-NamMinhNeural",
    "vi-VN-HoaiMyNeural": "vi-VN-HoaiMyNeural",
    "default": "vi-VN-NamMinhNeural",
}


def clean_subtitle_text(text: str) -> str:
    """
    Làm sạch phụ đề thoại:
    - Loại bỏ các chú thích âm thanh, nhạc nền trong ngoặc đơn/ngoặc vuông: (Nhạc), [Tiếng súng], （音乐）, 【Nhạc dạo】
    - Loại bỏ các hành động trong dấu sao: *cười lớn*, *hành động*, *thở dài*
    - Loại bỏ các ký hiệu nốt nhạc: ♪, ♫, ♬, ♩, ♭, ♮, ♯, §
    - Loại bỏ các dòng chỉ có dấu câu hoặc ký tự rác: ..., ——, !!!, ~~~
    - Giữ nguyên số học (1.500.000), văn bản tiếng Việt, Trung, Anh, Nhật, Hàn.
    """
    if not text:
        return ""

    # 1. Loại bỏ âm thanh/chú thích trong các loại ngoặc tròn và ngoặc vuông (kể cả fullwidth Á Đông)
    s = re.sub(r"[\(\（\[【〔][^\)\）\]】〕]*[\)\）\]】〕]", " ", text)

    # 2. Loại bỏ hành động trong dấu sao: *cười*, *khóc*
    s = re.sub(r"\*[^*]+\*", " ", s)

    # 3. Loại bỏ ký hiệu nốt nhạc và ký tự tượng thanh
    s = re.sub(r"[♪♫♬♩♭♮♯§~∼]+", " ", s)

    # 4. Thu gọn khoảng trắng thừa
    s = re.sub(r"\s+", " ", s).strip()

    # 5. Dọn dẹp dấu câu mồ côi ở đầu câu sau khi cắt ngoặc (ví dụ: "(Nhạc) , hôm nay" -> "hôm nay")
    s = re.sub(r"^[\s,;:!\?\.\-]+", "", s).strip()

    # 6. Nếu sau khi làm sạch chỉ còn toàn dấu câu, dấu gạch, dấu chấm, dấu phẩy không chứa chữ/số thì trả về rỗng
    # Hỗ trợ chữ cái Latin/Việt, số, chữ Hán (CJK), Kana, Hangul
    if not re.search(r"[\w\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]", s):
        return ""

    return s


def calculate_slot_stretch(
    speech_duration: float,
    slot_duration: float,
    min_rate: float = 1.0,
    max_rate: float = 1.45,
) -> float:
    """
    Tính toán tốc độ co giãn tự động để khớp thời lượng cue.
    Nếu thời lượng phát âm vượt quá slot thời gian, tăng tốc độ đọc từ 1.0x đến max_rate (mặc định 1.45x).
    Nếu thời lượng phát âm đã nhỏ hơn hoặc bằng slot, giữ nguyên 1.0x để câu thoại tự nhiên.
    """
    if slot_duration <= 0.05 or speech_duration <= 0.05:
        return 1.0

    if speech_duration <= slot_duration:
        return 1.0

    ratio = speech_duration / slot_duration
    return round(float(np.clip(ratio, min_rate, max_rate)), 3)


def time_stretch_pcm(
    samples: np.ndarray,
    speed_factor: float,
    sample_rate: int = 44100,
) -> np.ndarray:
    """
    Co giãn thời gian âm thanh PCM bằng bộ lọc atempo của FFmpeg (giữ nguyên cao độ).
    speed_factor: hệ số tốc độ (1.00 -> 1.45).
    """
    if len(samples) == 0 or abs(speed_factor - 1.0) < 0.02:
        return samples

    speed = float(np.clip(speed_factor, 0.5, 2.0))

    clipped = np.clip(samples, -1.0, 1.0)
    int_samples = (clipped * 32767.0).astype(np.int16)
    raw_bytes = int_samples.tobytes()

    cmd = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "s16le",
        "-ar",
        str(sample_rate),
        "-ac",
        "1",
        "-i",
        "pipe:0",
        "-filter:a",
        f"atempo={speed:.4f}",
        "-f",
        "s16le",
        "pipe:1",
    ]
    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    out_bytes, _ = proc.communicate(input=raw_bytes)
    if not out_bytes:
        return samples

    res_int = np.frombuffer(out_bytes, dtype=np.int16)
    return res_int.astype(np.float32) / 32768.0


async def synthesize_text(
    text: str,
    voice: str = "vi-VN-NamMinhNeural",
    output_path: Optional[Path | str] = None,
    rate: str = "+0%",
    max_retries: int = 3,
) -> bytes:
    """
    Sinh file âm thanh từ văn bản bằng Microsoft Edge Neural TTS.
    Có cơ chế tự động thử lại (retry with exponential backoff) chống mất kết nối.
    """
    import edge_tts

    clean_text = text.strip()
    if not clean_text:
        return b""

    actual_voice = AVAILABLE_VOICES.get(voice, voice)
    if actual_voice not in ("vi-VN-NamMinhNeural", "vi-VN-HoaiMyNeural") and not ("-" in actual_voice and "Neural" in actual_voice):
        actual_voice = "vi-VN-NamMinhNeural"

    for attempt in range(max_retries):
        try:
            communicate = edge_tts.Communicate(clean_text, actual_voice, rate=rate)
            audio_chunks = bytearray()
            async for chunk in communicate.stream():
                if chunk.get("type") == "audio":
                    audio_chunks.extend(chunk.get("data", b""))

            if len(audio_chunks) > 0:
                data = bytes(audio_chunks)
                if output_path:
                    out = Path(output_path)
                    out.parent.mkdir(parents=True, exist_ok=True)
                    out.write_bytes(data)
                return data
        except Exception as e:
            if attempt == max_retries - 1:
                logger.warning(f"Thử lại TTS thất bại sau {max_retries} lần: {e}")
                return b""
            await asyncio.sleep(0.35 * (attempt + 1))

    return b""


def _decode_mp3_to_pcm(mp3_data: bytes, sample_rate: int = 44100) -> np.ndarray:
    """Giải mã dữ liệu MP3 thành mảng numpy PCM float32 [-1.0, 1.0] đơn kênh (mono)."""
    if not mp3_data:
        return np.array([], dtype=np.float32)

    cmd = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        "pipe:0",
        "-f",
        "s16le",
        "-ac",
        "1",
        "-ar",
        str(sample_rate),
        "pipe:1",
    ]
    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    raw_pcm, _ = proc.communicate(input=mp3_data)
    if not raw_pcm:
        return np.array([], dtype=np.float32)

    int_samples = np.frombuffer(raw_pcm, dtype=np.int16)
    return int_samples.astype(np.float32) / 32768.0


def _encode_pcm_to_mp3(
    samples: np.ndarray,
    output_path: Path | str,
    sample_rate: int = 44100,
) -> Path:
    """Mã hóa mảng numpy PCM float32 thành file MP3 chất lượng cao qua FFmpeg."""
    out = Path(output_path).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)

    # Chống clipping âm thanh
    clipped = np.clip(samples, -1.0, 1.0)
    int_samples = (clipped * 32767.0).astype(np.int16)
    raw_bytes = int_samples.tobytes()

    cmd = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "s16le",
        "-ar",
        str(sample_rate),
        "-ac",
        "1",
        "-i",
        "pipe:0",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "128k",
        str(out),
    ]
    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    _, err = proc.communicate(input=raw_bytes)
    if proc.returncode != 0:
        raise RuntimeError(f"FFmpeg MP3 encode failed: {err.decode('utf-8', errors='ignore')}")

    return out


async def generate_timed_voiceover(
    cues: List[SubtitleCueV1],
    voice: str = "vi-VN-NamMinhNeural",
    output_path: Path | str = "output_voiceover.mp3",
    total_duration: float = 0.0,
    sample_rate: int = 44100,
    batch_size: int = 5,
    max_stretch_rate: float = 1.45,
    export_cues_dir: Optional[Path | str] = None,
) -> Path:
    """
    Sinh toàn bộ giọng thuyết minh cho các câu phụ đề theo đúng mốc thời gian start_pts của video.
    Tự động lọc rác thoại (Nhạc, ♪, *action*) và co giãn thời lượng (Slot Time-Stretching 1.0x -> 1.45x).
    Đồng bộ chính xác từng mili-giây, hòa âm chuẩn điện ảnh.
    """
    valid_cues: List[tuple[SubtitleCueV1, str]] = []
    for c in cues:
        raw_text = (c.translated_text or c.source_text).strip()
        cleaned = clean_subtitle_text(raw_text)
        if cleaned:
            valid_cues.append((c, cleaned))

    if not valid_cues:
        raise ValueError("Không có câu phụ đề nào hợp lệ sau khi làm sạch để sinh giọng đọc thuyết minh")

    # Xác định tổng thời lượng âm thanh cần tạo
    max_cue_end = max((c.end_pts for c, _ in valid_cues), default=0.0)
    final_duration = max(float(total_duration), float(max_cue_end) + 2.0, 1.0)
    total_samples = int(final_duration * sample_rate)

    # Khởi tạo timeline âm thanh trống (silence)
    master_buffer = np.zeros(total_samples, dtype=np.float32)

    logger.info(
        f"Bắt đầu sinh thuyết minh TTS cho {len(valid_cues)} câu thoại hợp lệ (Tổng {final_duration:.1f}s)..."
    )

    cues_out_dir = Path(export_cues_dir).resolve() if export_cues_dir else None
    if cues_out_dir:
        cues_out_dir.mkdir(parents=True, exist_ok=True)

    # Xử lý tuần tự từng câu với khoảng nghỉ nhỏ để ổn định đường truyền
    for idx, (cue, cleaned_text) in enumerate(valid_cues):
        mp3_res = await synthesize_text(cleaned_text, voice=voice)
        if not mp3_res:
            logger.warning(f"Bỏ qua câu {cue.cue_id} do không nhận được audio")
            continue

        pcm_samples = _decode_mp3_to_pcm(mp3_res, sample_rate=sample_rate)
        if len(pcm_samples) == 0:
            continue

        # Co giãn khớp slot thời gian (Slot Time-Stretching 1.0x -> 1.45x)
        speech_dur = len(pcm_samples) / sample_rate
        slot_dur = max(0.0, cue.end_pts - cue.start_pts)
        speed_factor = calculate_slot_stretch(
            speech_dur, slot_dur, min_rate=1.0, max_rate=max_stretch_rate
        )

        if speed_factor > 1.02:
            pcm_samples = time_stretch_pcm(pcm_samples, speed_factor=speed_factor, sample_rate=sample_rate)
            logger.info(
                f"Co giãn khớp slot câu {cue.cue_id}: {speech_dur:.2f}s -> {len(pcm_samples)/sample_rate:.2f}s "
                f"(tốc độ {speed_factor:.2f}x, slot {slot_dur:.2f}s)"
            )

        # Xuất từng câu riêng biệt nếu được yêu cầu (CapCut-ready format)
        if cues_out_dir:
            cue_filename = f"{idx+1:03d}_{cue.start_pts:05.2f}-{cue.end_pts:05.2f}.mp3"
            _encode_pcm_to_mp3(pcm_samples, cues_out_dir / cue_filename, sample_rate=sample_rate)

        # Tính vị trí mẫu bắt đầu trong master buffer
        start_sample = max(0, int(cue.start_pts * sample_rate))
        end_sample = start_sample + len(pcm_samples)

        # Mở rộng buffer nếu câu thoại vượt quá thời lượng ban đầu
        if end_sample > len(master_buffer):
            extra = end_sample - len(master_buffer)
            master_buffer = np.pad(master_buffer, (0, extra), mode="constant")

        # Đặt mẫu âm thanh vào timeline
        master_buffer[start_sample:end_sample] += pcm_samples

        # Nghỉ nhẹ giữa các câu để tránh rate limit của edge-tts
        if idx < len(valid_cues) - 1:
            await asyncio.sleep(0.08)

    # Xuất ra file MP3 đồng bộ
    out = _encode_pcm_to_mp3(master_buffer, output_path, sample_rate=sample_rate)
    logger.info(f"Đã xuất file âm thanh thuyết minh đồng bộ: {out}")
    return out


def generate_voiceover_sync(
    cues: List[SubtitleCueV1],
    voice: str = "vi-VN-NamMinhNeural",
    output_path: Path | str = "output_voiceover.mp3",
    total_duration: float = 0.0,
    max_stretch_rate: float = 1.45,
    export_cues_dir: Optional[Path | str] = None,
) -> Path:
    """Wrapper đồng bộ để gọi từ luồng worker thông thường."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                return pool.submit(
                    asyncio.run,
                    generate_timed_voiceover(
                        cues=cues,
                        voice=voice,
                        output_path=output_path,
                        total_duration=total_duration,
                        max_stretch_rate=max_stretch_rate,
                        export_cues_dir=export_cues_dir,
                    ),
                ).result()
        else:
            return loop.run_until_complete(
                generate_timed_voiceover(
                    cues=cues,
                    voice=voice,
                    output_path=output_path,
                    total_duration=total_duration,
                    max_stretch_rate=max_stretch_rate,
                    export_cues_dir=export_cues_dir,
                )
            )
    except RuntimeError:
        return asyncio.run(
            generate_timed_voiceover(
                cues=cues,
                voice=voice,
                output_path=output_path,
                total_duration=total_duration,
                max_stretch_rate=max_stretch_rate,
                export_cues_dir=export_cues_dir,
            )
        )


def mix_voiceover_into_video(
    video_path: Path | str,
    voiceover_path: Path | str,
    output_path: Path | str,
    ducking_volume: float = 0.25,
) -> Path:
    """
    Hòa trộn luồng thuyết minh với âm thanh gốc của video.
    Áp dụng hạ âm lượng nền gốc (ducking) để giọng đọc thuyết minh nổi bật, rõ ràng.
    """
    video = Path(video_path).resolve()
    voice = Path(voiceover_path).resolve()
    out = Path(output_path).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)

    if not video.exists():
        raise FileNotFoundError(f"Video gốc không tồn tại: {video}")
    if not voice.exists():
        raise FileNotFoundError(f"File thuyết minh không tồn tại: {voice}")

    # Bộ lọc FFmpeg:
    # [0:a]volume=ducking[bg]; [1:a]volume=1.2[vox]; [bg][vox]amix=inputs=2:duration=first:dropout_transition=2[aout]
    filter_complex = (
        f"[0:a]volume={ducking_volume}[bg];"
        f"[1:a]volume=1.2[vox];"
        f"[bg][vox]amix=inputs=2:duration=first:dropout_transition=2[aout]"
    )

    cmd = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(video),
        "-i",
        str(voice),
        "-filter_complex",
        filter_complex,
        "-map",
        "0:v:0",
        "-map",
        "[aout]",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        str(out),
    ]

    res = subprocess.run(cmd, capture_output=True)
    if res.returncode != 0:
        # Nếu video gốc không có track âm thanh, chỉ gắn track voiceover
        cmd_fallback = [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(video),
            "-i",
            str(voice),
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            str(out),
        ]
        res_fb = subprocess.run(cmd_fallback, capture_output=True)
        if res_fb.returncode != 0:
            raise RuntimeError(f"Hòa trộn audio thất bại: {res.stderr.decode('utf-8', errors='ignore')}")

    return out
