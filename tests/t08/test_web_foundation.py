import json
import sys
import unittest
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


class WebFoundationTest(unittest.TestCase):
    def test_web_directory_structure_exists(self) -> None:
        web_dir = REPOSITORY_ROOT / "web"
        self.assertTrue((web_dir / "package.json").exists())
        self.assertTrue((web_dir / "tsconfig.json").exists())
        self.assertTrue((web_dir / "vite.config.ts").exists())
        self.assertTrue((web_dir / "src" / "types" / "api.ts").exists())
        self.assertTrue((web_dir / "src" / "types" / "presets.ts").exists())
        self.assertTrue((web_dir / "src" / "api" / "client.ts").exists())
        self.assertTrue((web_dir / "src" / "components" / "layout" / "StudioHeader.tsx").exists())
        self.assertTrue((web_dir / "src" / "components" / "project" / "DashboardBatchHub.tsx").exists())
        self.assertTrue((web_dir / "src" / "components" / "project" / "NewProjectModal.tsx").exists())
        self.assertTrue((web_dir / "src" / "components" / "player" / "VideoPlayer.tsx").exists())
        self.assertTrue((web_dir / "src" / "components" / "player" / "VideoTransformOverlay.tsx").exists())
        self.assertTrue((web_dir / "src" / "components" / "timeline" / "BottomTimeline.tsx").exists())

    def test_package_json_validity(self) -> None:
        pkg_file = REPOSITORY_ROOT / "web" / "package.json"
        data = json.loads(pkg_file.read_text(encoding="utf-8"))
        self.assertEqual(data["name"], "subtitle-localizer-web")
        self.assertIn("react", data["dependencies"])
        self.assertIn("vite", data["devDependencies"])

    def test_typescript_contracts_include_v1_models(self) -> None:
        ts_file = REPOSITORY_ROOT / "web" / "src" / "types" / "api.ts"
        content = ts_file.read_text(encoding="utf-8")
        self.assertIn("export interface SubtitleCueV1", content)
        self.assertIn("export interface ProjectManifestV1", content)
        self.assertIn("export interface RegionTrackV1", content)
        self.assertIn("export interface BridgeEventV1", content)

    def test_preset_profiles_contract_and_defaults(self) -> None:
        presets_file = REPOSITORY_ROOT / "web" / "src" / "types" / "presets.ts"
        content = presets_file.read_text(encoding="utf-8")
        self.assertIn("export interface PresetProfile", content)
        self.assertIn("export type AspectRatioType", content)
        self.assertIn("export const BUILTIN_PRESETS", content)
        self.assertIn("16:9", content)
        self.assertIn("9:16", content)
        self.assertIn("1:1", content)

    def test_batch_video_card_interactive_roi_and_realtime_subtitles(self) -> None:
        hub_file = REPOSITORY_ROOT / "web" / "src" / "components" / "project" / "DashboardBatchHub.tsx"
        content = hub_file.read_text(encoding="utf-8")
        # 1. ROI bounding box removed (R4) — replaced with clean subtitle banner
        #    Verify old ROI handles are NOT present
        self.assertNotIn("cursor-nwse-resize", content)
        self.assertNotIn("cursor-nesw-resize", content)

        # 2. Đồng bộ phụ đề thật thời gian thực
        self.assertIn("getCues", content)
        self.assertIn("activeCue", content)
        self.assertIn("renderSubtitleText", content)

        # 3. Mini scrubber tua video
        self.assertIn("group/scrubber", content)

    def test_batch_delete_and_url_download_ui_contracts(self) -> None:
        # Check UrlDownloadModal exists
        modal_file = REPOSITORY_ROOT / "web" / "src" / "components" / "project" / "UrlDownloadModal.tsx"
        self.assertTrue(modal_file.exists())
        modal_content = modal_file.read_text(encoding="utf-8")
        self.assertIn("parseDownloadTarget", modal_content)
        self.assertIn("startDownload", modal_content)
        self.assertIn("getDownloadStatus", modal_content)
        self.assertIn("Hồng Quả", modal_content)

        # Check DashboardBatchHub has batch delete and download from link
        hub_file = REPOSITORY_ROOT / "web" / "src" / "components" / "project" / "DashboardBatchHub.tsx"
        hub_content = hub_file.read_text(encoding="utf-8")
        self.assertIn("batchDeleteProjects", hub_content)
        self.assertIn("Xóa tất cả", hub_content)
        self.assertIn("Xóa đã chọn", hub_content)
        self.assertIn("Tải từ Link", hub_content)
        self.assertIn("UrlDownloadModal", hub_content)

    def test_video_player_clips_overflow_to_standard_frame(self) -> None:
        """Kiểm tra VideoPlayer có lớp bọc cố định canvas với overflow-hidden để clip video out ra khỏi khung chuẩn."""
        player_file = REPOSITORY_ROOT / "web" / "src" / "components" / "player" / "VideoPlayer.tsx"
        self.assertTrue(player_file.exists())
        content = player_file.read_text(encoding="utf-8")
        # Khung chứa video phải có lớp cố định inset-0 overflow-hidden độc lập với transform
        self.assertIn("absolute inset-0 overflow-hidden", content)
        # Transform không được đặt cùng div với overflow-hidden để tránh làm tràn video ra ngoài khung chuẩn
        self.assertNotIn("relative w-full h-full overflow-hidden rounded-xl", content)

    def test_video_player_square_corners_no_rounded(self) -> None:
        """Kiểm tra khung canvas chuẩn và transform overlay sử dụng góc vuông (rounded-none), không bo góc."""
        player_file = REPOSITORY_ROOT / "web" / "src" / "components" / "player" / "VideoPlayer.tsx"
        overlay_file = REPOSITORY_ROOT / "web" / "src" / "components" / "player" / "VideoTransformOverlay.tsx"
        self.assertTrue(player_file.exists())
        self.assertTrue(overlay_file.exists())
        player_content = player_file.read_text(encoding="utf-8")
        overlay_content = overlay_file.read_text(encoding="utf-8")

        # Khung video canvas không bo góc
        self.assertNotIn("rounded-xl border border-slate-800", player_content)
        # Transform overlay không bo góc
        self.assertNotIn("rounded-xl", overlay_content)

    def test_dashboard_batch_hub_removes_pipeline_and_tune_tabs(self) -> None:
        """Kiểm tra DashboardBatchHub đã loại bỏ tab Pipeline và Tinh chỉnh video ở góc phải UI."""
        hub_file = REPOSITORY_ROOT / "web" / "src" / "components" / "project" / "DashboardBatchHub.tsx"
        self.assertTrue(hub_file.exists())
        content = hub_file.read_text(encoding="utf-8")

        # Không còn các tab thừa Pipeline và Tinh chỉnh video
        self.assertNotIn("Tinh chỉnh video", content)
        self.assertNotIn("Cấu Hình Pipeline", content)
        self.assertNotIn("Hiệu Chỉnh Video", content)
        self.assertNotIn("sidebarTab", content)

    def test_dashboard_batch_hub_eight_point_requirements(self) -> None:
        """Kiểm tra DashboardBatchHub đáp ứng đầy đủ 8 yêu cầu thiết kế mới."""
        hub_file = REPOSITORY_ROOT / "web" / "src" / "components" / "project" / "DashboardBatchHub.tsx"
        self.assertTrue(hub_file.exists())
        content = hub_file.read_text(encoding="utf-8")

        # 1. Box chọn ngôn ngữ dịch
        self.assertIn("Ngôn ngữ dịch", content)

        # 2. Thanh kéo giảm âm lượng
        self.assertIn("Giảm âm lượng video gốc", content)

        # 3. Box chọn lồng tiếng (Đơn giọng / Đa giọng giới tính)
        self.assertIn("Lồng tiếng AI", content)
        self.assertIn("Đơn giọng", content)
        self.assertIn("Đa giọng", content)

        # 4. Sắp xếp theo tập / sort tùy ý
        self.assertIn("Sắp xếp", content)
        self.assertIn("Tập tăng dần", content)
        self.assertIn("Tập giảm dần", content)

        # 5. Định dạng + độ phân giải khi xuất
        self.assertIn("Độ phân giải", content)
        self.assertIn("1080p", content)

        # 6. Bánh răng chi tiết từng tập dạng popup
        self.assertIn("Thông số kỹ thuật", content)

        # 7. Thanh phần trăm từng bước & tổng thể toàn bộ
        self.assertIn("Tiến trình tổng thể", content)

        # 8. Popup xác nhận trước khi chạy (Quick Batch Review)
        self.assertIn("Xác Nhận & Bắt Đầu", content)

    def test_dashboard_batch_hub_tổng_thể_và_cá_nhân_controls(self) -> None:
        """Kiểm tra DashboardBatchHub đã gỡ các nút thừa ở footer và trang bị điều khiển tổng thể + cá nhân."""
        hub_file = REPOSITORY_ROOT / "web" / "src" / "components" / "project" / "DashboardBatchHub.tsx"
        self.assertTrue(hub_file.exists())
        content = hub_file.read_text(encoding="utf-8")

        # 1. Đã loại bỏ 5 nút dư thừa ở thanh footer dưới đáy
        self.assertNotIn("Trích phụ đề", content)
        self.assertNotIn("title=\"Trích xuất phụ đề hàng loạt\"", content)
        self.assertNotIn("title=\"Dịch toàn bộ dự án\"", content)
        self.assertNotIn("title=\"Lồng tiếng AI hàng loạt\"", content)
        self.assertNotIn("title=\"Kết xuất MP4 hàng loạt\"", content)
        self.assertNotIn("title=\"Dừng toàn bộ tiến trình\"", content)

        # 2. Điều khiển tổng thể (Batch stages selector & review modal)
        self.assertIn("Công đoạn thực hiện", content)
        self.assertIn("batchStages", content)

        # 3. Điều khiển cá nhân cho từng video cụ thể (Episode Inspector actions)
        self.assertIn("Thao tác cá nhân cho tập này", content)
        self.assertIn("Quét OCR", content)
        self.assertIn("Dịch lại", content)
        self.assertIn("Tạo giọng", content)
        self.assertIn("Xuất MP4", content)
        self.assertIn("handleRunSingleStage", content)

        # 4. Tiến trình tổng thể đặt ở đáy phía trên thanh công cụ
        self.assertIn("Tiến trình tổng thể", content)

    def test_dashboard_multi_drama_folder_architecture(self) -> None:
        """Kiểm tra giao diện phân cấp Thư mục / Bộ phim lớn (Multi-Drama Folder Architecture)."""
        card_file = REPOSITORY_ROOT / "web" / "src" / "components" / "project" / "DramaFolderCard.tsx"
        self.assertTrue(card_file.exists(), "DramaFolderCard.tsx must exist")
        card_content = card_file.read_text(encoding="utf-8")
        self.assertIn("DramaFolderCard", card_content)
        self.assertIn("tập", card_content)
        self.assertIn("tiến độ", card_content.lower())

        hub_file = REPOSITORY_ROOT / "web" / "src" / "components" / "project" / "DashboardBatchHub.tsx"
        self.assertTrue(hub_file.exists())
        hub_content = hub_file.read_text(encoding="utf-8")

        # 1. State & Logic gom nhóm bộ phim
        self.assertIn("dramaViewMode", hub_content)
        self.assertIn("selectedDramaTitle", hub_content)
        self.assertIn("dramaGroups", hub_content)

        # 2. Chuyển đổi chế độ xem & Breadcrumb điều hướng 2 tầng
        self.assertIn("Theo Bộ phim", hub_content)
        self.assertIn("Tất cả tập", hub_content)
        self.assertIn("Danh sách Bộ phim", hub_content)

    def test_client_has_reveal_project_export(self) -> None:
        """Kiểm tra StudioApiClient có phương thức revealProjectExport."""
        client_file = REPOSITORY_ROOT / "web" / "src" / "api" / "client.ts"
        self.assertTrue(client_file.exists())
        content = client_file.read_text(encoding="utf-8")
        self.assertIn("revealProjectExport", content)
        self.assertIn("/projects/${projectId}/reveal-export", content)

    def test_enlarged_inspector_modal_and_verified_path_box(self) -> None:
        """Kiểm tra Episode Inspector Modal kích thước lớn, fix thời lượng và ô đường dẫn tuyệt đối đã verify."""
        hub_file = REPOSITORY_ROOT / "web" / "src" / "components" / "project" / "DashboardBatchHub.tsx"
        self.assertTrue(hub_file.exists())
        content = hub_file.read_text(encoding="utf-8")

        # 1. Kích thước modal lớn (max-w-5xl hoặc max-w-6xl)
        self.assertTrue("max-w-5xl" in content or "max-w-6xl" in content)

        # 2. Switcher nguồn video xem trước (bản xuất MP4 vs video gốc)
        self.assertIn("Video Đã Xuất Bản (MP4)", content)
        self.assertIn("Video Gốc", content)
        self.assertIn("previewVideoMode", content)

        # 3. Khắc phục lỗi thời lượng 00:00 qua onLoadedMetadata
        self.assertIn("onLoadedMetadata", content)
        self.assertIn("setInspectorDuration", content)

        # 4. Ô đường dẫn tuyệt đối đã verify
        self.assertIn("Bản xuất MP4 hoàn thiện", content)
        self.assertIn("Đường dẫn tuyệt đối tệp MP4 kết xuất", content)
        self.assertIn("Đường dẫn tuyệt đối video gốc đầu vào", content)
        self.assertIn("Mở trong Thư Mục", content)
        self.assertIn("Tải MP4", content)
        self.assertIn("handleRevealExport", content)
        self.assertIn("handleCopyPath", content)

        # 5. Nhấp vào tiêu đề / thanh trên để mở Thông số kỹ thuật & Chi tiết tập
        self.assertIn("Bấm vào tiêu đề / thanh trên để mở Thông số kỹ thuật & Chi tiết tập", content)

    def test_app_viewmode_and_tab_persistence_on_f5(self) -> None:
        """Kiểm tra App.tsx lưu và khôi phục chính xác viewMode, downloaderTab, settingsTab khi F5."""
        app_file = REPOSITORY_ROOT / "web" / "src" / "App.tsx"
        self.assertTrue(app_file.exists())
        content = app_file.read_text(encoding="utf-8")

        # 1. StoredStudioState mở rộng các trường điều hướng
        self.assertIn("viewMode?: 'dashboard' | 'studio' | 'queue' | 'downloader' | 'settings'", content)
        self.assertIn("downloaderTab?: 'search' | 'direct' | 'queue' | 'auth' | 'settings'", content)
        self.assertIn("settingsTab?: 'ocr' | 'translation' | 'dubbing' | 'render'", content)

        # 2. Khởi tạo lazy state từ savedState
        self.assertIn("savedState?.viewMode || 'dashboard'", content)
        self.assertIn("savedState?.downloaderTab || 'search'", content)
        self.assertIn("savedState?.settingsTab || 'ocr'", content)

        # 3. selectProject hỗ trợ tham số navigate và không ép chuyển viewMode khi navigate=false
        self.assertIn("selectProject = useCallback((proj: ProjectManifestV1, navigate: boolean = true)", content)
        self.assertIn("selectProject(found, false)", content)

        # 4. Bảo toàn regions, sourceLang, targetLang khi khôi phục không navigate
        self.assertIn("if (!navigate && savedState?.activeProjectId === proj.project_id)", content)
        self.assertIn("savedState.regions", content)
        self.assertIn("setRegions(savedState.regions);", content)

        # 5. Hàng đợi sử dụng downloaderTab dự phòng thay vì hardcode
        self.assertIn("initialTab={downloaderTab || 'queue'}", content)

    def test_multi_roi_and_separated_toolbar_ui_contract(self) -> None:
        """Kiểm tra hợp đồng UI: Thanh công cụ tách biệt trên cùng, Multi-ROI thêm/xóa/chọn và default roi mode."""
        app_file = REPOSITORY_ROOT / "web" / "src" / "App.tsx"
        player_file = REPOSITORY_ROOT / "web" / "src" / "components" / "player" / "VideoPlayer.tsx"
        inspector_file = REPOSITORY_ROOT / "web" / "src" / "components" / "inspector" / "RightInspectorPanel.tsx"
        roi_file = REPOSITORY_ROOT / "web" / "src" / "components" / "roi" / "RoiOverlay.tsx"

        app_content = app_file.read_text(encoding="utf-8")
        player_content = player_file.read_text(encoding="utf-8")
        inspector_content = inspector_file.read_text(encoding="utf-8")
        roi_content = roi_file.read_text(encoding="utf-8")

        # 1. App.tsx: default interactionMode là 'roi', quản lý regions & activeRegionId
        self.assertIn("const [interactionMode, setInteractionMode] = useState<'video' | 'roi'>('roi');", app_content)
        self.assertIn("const [regions, setRegions] = useState<RegionTrackV1[]>", app_content)
        self.assertIn("handleAddRegion", app_content)
        self.assertIn("handleDeleteRegion", app_content)

        # 2. VideoPlayer: Dedicated Top Toolbar không đè video
        self.assertIn("Dedicated Top Toolbar - Tách biệt độc lập, không che hay chạm sát Video", player_content)
        self.assertIn("interactionMode = 'roi'", player_content)
        self.assertIn("regions={regions}", player_content)

        # 3. RightInspectorPanel: Thẻ Quản lý Đa Vùng Quét OCR (Thêm / Xóa / Chọn)
        self.assertIn("Quản lý Đa Vùng Quét OCR", inspector_content)
        self.assertIn("Vùng quét OCR", inspector_content)
        self.assertIn("Thêm Vùng", inspector_content)

        # 4. RoiOverlay: Hỗ trợ đa vùng và vùng phụ (inactiveRegions)
        self.assertIn("inactiveRegions", roi_content)
        self.assertIn("onSelectRegion", roi_content)

    def test_dashboard_and_tab_sync_edge_cases_on_f5(self) -> None:
        """Kiểm tra persistence của dramaViewMode, dọn drama đã xóa, và đồng bộ tab giữa parent/child."""
        hub_file = REPOSITORY_ROOT / "web" / "src" / "components" / "project" / "DashboardBatchHub.tsx"
        downloader_file = REPOSITORY_ROOT / "web" / "src" / "components" / "project" / "VideoDownloaderHub.tsx"
        settings_file = REPOSITORY_ROOT / "web" / "src" / "components" / "project" / "GlobalSettingsView.tsx"

        hub_content = hub_file.read_text(encoding="utf-8")
        # 1. Persist dramaViewMode (folders vs flat) vào localStorage
        self.assertIn("localStorage.getItem('sls_drama_view_mode')", hub_content)
        self.assertIn("localStorage.setItem('sls_drama_view_mode', dramaViewMode)", hub_content)

        # 2. Tự động dọn selectedDramaTitle khi bộ phim bị xóa
        self.assertIn("selectedDramaTitle && projects.length > 0 && !dramaGroups.has(selectedDramaTitle)", hub_content)

        # 3. VideoDownloaderHub đồng bộ initialTab khi prop thay đổi
        downloader_content = downloader_file.read_text(encoding="utf-8")
        self.assertIn("initialTab && initialTab !== activeTab", downloader_content)

        # 4. GlobalSettingsView đồng bộ initialTab khi prop thay đổi
        settings_content = settings_file.read_text(encoding="utf-8")
        self.assertIn("initialTab && initialTab !== activeTab", settings_content)


if __name__ == "__main__":
    unittest.main()


