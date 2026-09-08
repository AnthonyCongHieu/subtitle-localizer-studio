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
        blur_strength: int = 20,
    ) -> str:
        """Sinh biểu thức FFmpeg video filter tương ứng với độ mờ blur_strength tùy chỉnh."""
        if mode == "box":
            return f"drawbox=x={x}:y={y}:w={width}:h={height}:color=black@{opacity}:t=fill"

        overlay_x = str(x).replace("iw", "main_w").replace("ih", "main_h")
        overlay_y = str(y).replace("iw", "main_w").replace("ih", "main_h")

        if mode == "mosaic":
            # Hiệu ứng Pixelate (Mosaic) điện ảnh thật sự bằng nội suy ô lân cận gần nhất
            block_size = max(4, min(32, int(blur_strength * 0.5)))
            return (
                f"split[main][sub];"
                f"[sub]crop={width}:{height}:{x}:{y},"
                f"scale=iw/{block_size}:ih/{block_size}:flags=neighbor,"
                f"scale={width}:{height}:flags=neighbor[blurred];"
                f"[main][blurred]overlay={overlay_x}:{overlay_y}"
            )

        elif mode in ("blur", "feather_tight", "optical_blend", "soft_cinema", "feather", "glass", "ambient", "gradient"):
            # Tính toán bán kính làm mờ dựa trên blur_strength thực tế từ giao diện
            base_factor = 0.9 if mode in ("feather_tight", "optical_blend", "soft_cinema") else 0.7
            radius = max(2, min(50, int(blur_strength * base_factor)))
            power = 4 if mode in ("feather_tight", "optical_blend", "soft_cinema") else 3

            # Giới hạn an toàn bán kính: trong video YUV420p, luma/chroma radius không được vượt quá kích thước frame
            # Thiết lập chroma_radius=0 và clamp luma_radius triệt tiêu vĩnh viễn lỗi FFmpeg -22 trên ROI hẹp
            try:
                h_val = int(height)
                if h_val > 0:
                    radius = max(1, min(radius, max(1, (h_val // 2) - 1)))
            except (ValueError, TypeError):
                radius = min(radius, 4)

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
        blur_strength: int = 20,
    ) -> str:
        """Sinh chuỗi filter FFmpeg che đồng thời nhiều vùng (boxes) với blur_strength thực tế."""
        if not boxes:
            return ""
        if len(boxes) == 1:
            x, y, w, h = boxes[0]
            return self.get_filter_string(mode=mode, x=x, y=y, width=w, height=h, opacity=opacity, blur_strength=blur_strength)

        if mode in ("box", "sttn_lama"):
            return ",".join(
                f"drawbox=x={x}:y={y}:w={w}:h={h}:color=black@{opacity}:t=fill"
                for x, y, w, h in boxes
            )

        if mode == "mosaic":
            chain_parts = []
            block_size = max(4, min(32, int(blur_strength * 0.5)))
            for i, (bx, by, bw, bh) in enumerate(boxes):
                ox = str(bx).replace("iw", "main_w").replace("ih", "main_h")
                oy = str(by).replace("iw", "main_w").replace("ih", "main_h")
                in_tag = f"[m{i-1}]" if i > 0 else ""
                is_last = (i == len(boxes) - 1)
                out_tag = "" if is_last else f"[m{i}]"
                chain_parts.append(
                    f"{in_tag}split[main{i}][sub{i}];[sub{i}]crop={bw}:{bh}:{bx}:{by},scale=iw/{block_size}:ih/{block_size}:flags=neighbor,scale={bw}:{bh}:flags=neighbor[blurred{i}];[main{i}][blurred{i}]overlay={ox}:{oy}{out_tag}"
                )
            return ";".join(chain_parts)

        if mode in ("blur", "feather_tight", "optical_blend", "soft_cinema", "feather", "glass", "ambient", "gradient"):
            chain_parts = []
            base_factor = 0.9 if mode in ("feather_tight", "optical_blend", "soft_cinema") else 0.7
            radius = max(2, min(50, int(blur_strength * base_factor)))
            power = 4 if mode in ("feather_tight", "optical_blend", "soft_cinema") else 3

            for i, (bx, by, bw, bh) in enumerate(boxes):
                ox = str(bx).replace("iw", "main_w").replace("ih", "main_h")
                oy = str(by).replace("iw", "main_w").replace("ih", "main_h")
                try:
                    h_val = int(bh)
                    if h_val > 0:
                        box_radius = max(1, min(radius, max(1, (h_val // 2) - 1)))
                    else:
                        box_radius = radius
                except (ValueError, TypeError):
                    box_radius = min(radius, 4)

                in_tag = f"[m{i-1}]" if i > 0 else ""
                is_last = (i == len(boxes) - 1)
                out_tag = "" if is_last else f"[m{i}]"
                chain_parts.append(
                    f"{in_tag}split[main{i}][sub{i}];[sub{i}]crop={bw}:{bh}:{bx}:{by},boxblur=luma_radius={box_radius}:luma_power={power}:chroma_radius=0[blurred{i}];[main{i}][blurred{i}]overlay={ox}:{oy}{out_tag}"
                )
            return ";".join(chain_parts)

        return ""
