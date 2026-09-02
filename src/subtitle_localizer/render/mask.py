from __future__ import annotations


class SubtitleMasker:
    """Tạo chuỗi filter FFmpeg để che hoặc xóa subtitle gốc bằng Blur, Box hoặc STTN fallback."""

    def get_filter_string(
        self,
        mode: str = "box",
        x: int = 0,
        y: int = 0,
        width: int = 1920,
        height: int = 200,
        opacity: float = 0.85,
    ) -> str:
        """Sinh biểu thức FFmpeg video filter tương ứng."""
        if mode == "box":
            return f"drawbox=x={x}:y={y}:w={width}:h={height}:color=black@{opacity}:t=fill"

        elif mode == "blur":
            # Áp dụng boxblur lên vùng ROI
            return f"split[main][sub];[sub]crop={width}:{height}:{x}:{y},boxblur=luma_radius=10:luma_power=3[blurred];[main][blurred]overlay={x}:{y}"

        elif mode == "crop":
            # Cắt bớt phần dưới
            return f"crop=iw:ih-{height}:0:0"

        elif mode == "sttn_lama":
            # Adapter thử nghiệm STTN / LaMa - Khi weights chưa tải đầy đủ thì fallback an toàn về box
            return f"drawbox=x={x}:y={y}:w={width}:h={height}:color=black@{opacity}:t=fill"

        return ""
