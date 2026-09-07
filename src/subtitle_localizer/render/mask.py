from __future__ import annotations


class SubtitleMasker:
    """Tạo chuỗi filter FFmpeg để che hoặc xóa subtitle gốc bằng Blur, Box hoặc STTN fallback."""

    def get_filter_string(
        self,
        mode: str = "box",
        x: int | str = 0,
        y: int | str = 0,
        width: int | str = 1920,
        height: int | str = 200,
        opacity: float = 0.85,
    ) -> str:
        """Sinh biểu thức FFmpeg video filter tương ứng."""
        if mode == "box":
            return f"drawbox=x={x}:y={y}:w={width}:h={height}:color=black@{opacity}:t=fill"

        elif mode in ("blur", "feather_tight", "optical_blend", "soft_cinema", "feather", "glass", "ambient", "mosaic", "gradient"):
            # Áp dụng boxblur lên vùng ROI với thông số tối ưu
            overlay_x = str(x).replace("iw", "main_w").replace("ih", "main_h")
            overlay_y = str(y).replace("iw", "main_w").replace("ih", "main_h")
            radius = 14 if mode in ("feather_tight", "optical_blend") else 10
            # Giới hạn an toàn bán kính: trong video YUV420p, luma/chroma radius không được vượt quá kích thước frame
            # Thiết lập chroma_radius=0 và clamp luma_radius triệt tiêu vĩnh viễn lỗi FFmpeg -22 trên ROI hẹp
            try:
                h_val = int(height)
                if h_val > 0:
                    radius = max(1, min(radius, max(1, (h_val // 2) - 1)))
            except (ValueError, TypeError):
                # Khi height là biểu thức chuỗi (ví dụ "ih*0.02") không thể parse sang int,
                # ép radius an toàn <= 4 để FFmpeg không bị crash -22 kể cả khi frame cực hẹp
                radius = min(radius, 4)
            power = 3
            return f"split[main][sub];[sub]crop={width}:{height}:{x}:{y},boxblur=luma_radius={radius}:luma_power={power}:chroma_radius=0[blurred];[main][blurred]overlay={overlay_x}:{overlay_y}"

        elif mode == "crop":
            # Cắt bớt phần dưới
            return f"crop=iw:ih-{height}:0:0"

        elif mode == "sttn_lama":
            # Adapter thử nghiệm STTN / LaMa - Khi weights chưa tải đầy đủ thì fallback an toàn về box
            return f"drawbox=x={x}:y={y}:w={width}:h={height}:color=black@{opacity}:t=fill"

        return ""

    def get_multi_filter_string(
        self,
        boxes: list[tuple[int, int, int, int]],
        mode: str = "blur",
        opacity: float = 0.85,
    ) -> str:
        """Sinh chuỗi filter FFmpeg che đồng thời nhiều vùng (boxes)."""
        if not boxes:
            return ""
        if len(boxes) == 1:
            x, y, w, h = boxes[0]
            return self.get_filter_string(mode=mode, x=x, y=y, width=w, height=h, opacity=opacity)

        if mode in ("box", "sttn_lama"):
            return ",".join(
                f"drawbox=x={x}:y={y}:w={w}:h={h}:color=black@{opacity}:t=fill"
                for x, y, w, h in boxes
            )

        if mode in ("blur", "feather_tight", "optical_blend", "soft_cinema", "feather", "glass", "ambient", "mosaic", "gradient"):
            chain_parts = []
            for i, (bx, by, bw, bh) in enumerate(boxes):
                ox = str(bx).replace("iw", "main_w").replace("ih", "main_h")
                oy = str(by).replace("iw", "main_w").replace("ih", "main_h")
                radius = 14 if mode in ("feather_tight", "optical_blend") else 10
                try:
                    h_val = int(bh)
                    if h_val > 0:
                        radius = max(1, min(radius, max(1, (h_val // 2) - 1)))
                except (ValueError, TypeError):
                    radius = min(radius, 4)
                power = 3
                in_tag = f"[m{i-1}]" if i > 0 else ""
                is_last = (i == len(boxes) - 1)
                out_tag = "" if is_last else f"[m{i}]"
                chain_parts.append(
                    f"{in_tag}split[main{i}][sub{i}];[sub{i}]crop={bw}:{bh}:{bx}:{by},boxblur=luma_radius={radius}:luma_power={power}:chroma_radius=0[blurred{i}];[main{i}][blurred{i}]overlay={ox}:{oy}{out_tag}"
                )
            return ";".join(chain_parts)

        return ""
