from __future__ import annotations


def enhance_text_contrast(raw_bytes: bytes, width: int, height: int) -> bytes:
    """Tăng độ tương phản của crop ảnh để cải thiện tỷ lệ nhận dạng chữ nét mảnh."""
    if not raw_bytes:
        return b""
    # Thực hiện phép co dãn dải tương phản đơn giản
    min_val = min(raw_bytes)
    max_val = max(raw_bytes)
    if max_val == min_val:
        return raw_bytes

    scale = 255.0 / (max_val - min_val)
    return bytes(int((b - min_val) * scale) for b in raw_bytes)


def binarize_crop(grayscale_bytes: bytes, threshold: int = 128) -> bytes:
    """Nhị phân hóa ảnh đen trắng phục vụ OCR."""
    return bytes(255 if b >= threshold else 0 for b in grayscale_bytes)
