import React, { useState } from 'react';
import {
  Crop,
  Eye,
  EyeOff,
  Sparkles,
  Tv,
  Crosshair,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Loader2,
  FileVideo,
  Square,
  Layers,
  Plus,
  Trash2,
  Droplet,
  RotateCcw,
  Edit2,
  Save,
  CheckCircle2,
  Globe,
} from 'lucide-react';
import { RegionTrackV1, ProjectManifestV1, SubtitleCueV1 } from '../../types/api';
import {
  AspectRatioType,
  MaskStyleType,
  SubtitlePlacementMode,
} from '../../types/presets';
import { apiClient } from '../../api/client';

export type RightPanelTab = 'roi' | 'mask' | 'ai_export';

export interface PositionTemplate {
  id: string;
  name: string;
  y: number;
  height: number;
  width: number;
  x?: number;
  is_builtin?: boolean;
}

interface RightInspectorPanelProps {
  region: RegionTrackV1;
  onUpdateRegion: (r: RegionTrackV1) => void;
  onAutoDetectRoi?: () => void;
  sourceLang: string;
  targetLang: string;
  onLanguageChange?: (s: string, t: string) => void;
  previewMask: boolean;
  onTogglePreviewMask: () => void;
  maskStyle?: MaskStyleType;
  onMaskStyleChange?: (s: MaskStyleType) => void;
  blurStrength?: number;
  onBlurStrengthChange?: (b: number) => void;
  showSubtitleOverlay: boolean;
  onToggleSubtitleOverlay: () => void;
  subtitlePlacement?: SubtitlePlacementMode;
  onSubtitlePlacementChange?: (p: SubtitlePlacementMode) => void;
  aspectRatio: AspectRatioType;
  onAspectRatioChange: (r: AspectRatioType) => void;
  fitMode?: 'contain' | 'cover';
  onToggleFitMode?: () => void;
  isFlippedH: boolean;
  onToggleFlipH: () => void;
  isFlippedV: boolean;
  onToggleFlipV: () => void;
  rotation: number;
  onRotationChange?: (deg: number) => void;
  onRotate: () => void;
  videoPosition: { x: number; y: number };
  onPositionChange?: (pos: { x: number; y: number }) => void;
  onResetTransform: () => void;
  onResetAllParameters?: () => void;
  activeProject: ProjectManifestV1 | null;
  cues?: SubtitleCueV1[];
  onRefreshCues?: () => void;
  isScanning?: boolean;
  scanProgress?: number | null;
  statusMessage?: string | null;
  onStartScan?: () => void;
  onStopScan?: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  regions?: RegionTrackV1[];
  activeRegionId?: string;
  onSelectRegion?: (id: string) => void;
  onAddRegion?: () => void;
  onDeleteRegion?: (id: string) => void;
  onUpdateActiveProject?: (patch: Partial<ProjectManifestV1>) => void;
  onRefreshProject?: () => void;
  subtitleFontSize?: number;
  onSubtitleFontSizeChange?: (size: number) => void;
  subtitleFontFamily?: string;
  onSubtitleFontFamilyChange?: (font: string) => void;
  subtitleTextColor?: string;
  onSubtitleTextColorChange?: (color: string) => void;
  maskOpacity?: number;
  onMaskOpacityChange?: (opacity: number) => void;
  maskPadding?: number;
  onMaskPaddingChange?: (padding: number) => void;
  maskBorderRadius?: number;
  onMaskBorderRadiusChange?: (radius: number) => void;
  responsiveFontScale?: boolean;
  onResponsiveFontScaleChange?: (enabled: boolean) => void;
  subtitleStroke?: 'none' | 'soft' | 'stroke' | 'glow';
  onSubtitleStrokeChange?: (stroke: 'none' | 'soft' | 'stroke' | 'glow') => void;
  subtitleLineHeight?: number;
  onSubtitleLineHeightChange?: (lh: number) => void;
  width?: number;
}

export const RightInspectorPanel: React.FC<RightInspectorPanelProps> = ({
  region,
  onUpdateRegion,
  onAutoDetectRoi: _onAutoDetectRoi,
  sourceLang,
  targetLang,
  onLanguageChange,
  previewMask,
  onTogglePreviewMask,
  maskStyle = 'feather_tight',
  onMaskStyleChange,
  blurStrength = 20,
  onBlurStrengthChange,
  maskOpacity = 1.0,
  onMaskOpacityChange,
  maskPadding = 0,
  onMaskPaddingChange,
  maskBorderRadius = 0,
  onMaskBorderRadiusChange,
  showSubtitleOverlay,
  onToggleSubtitleOverlay,
  subtitlePlacement = 'roi',
  onSubtitlePlacementChange,
  responsiveFontScale = false,
  onResponsiveFontScaleChange,
  subtitleStroke = 'soft',
  onSubtitleStrokeChange,
  subtitleLineHeight = 1.35,
  onSubtitleLineHeightChange,
  aspectRatio: _aspectRatio,
  onAspectRatioChange: _onAspectRatioChange,
  fitMode: _fitMode = 'contain',
  onToggleFitMode: _onToggleFitMode,
  isFlippedH,
  onToggleFlipH: _onToggleFlipH,
  isFlippedV,
  onToggleFlipV: _onToggleFlipV,
  rotation,
  onRotationChange: _onRotationChange,
  onRotate: _onRotate,
  videoPosition,
  onPositionChange: _onPositionChange,
  onResetTransform,
  onResetAllParameters,
  activeProject,
  cues = [],
  onRefreshCues,
  isScanning = false,
  scanProgress,
  statusMessage = null,
  onStartScan,
  onStopScan,
  isCollapsed = false,
  onToggleCollapse,
  regions = [],
  activeRegionId,
  onSelectRegion,
  onAddRegion,
  onDeleteRegion,
  onUpdateActiveProject,
  onRefreshProject,
  subtitleFontSize = 16,
  onSubtitleFontSizeChange,
  subtitleFontFamily = 'Inter, sans-serif',
  onSubtitleFontFamilyChange,
  subtitleTextColor = '#fde047',
  onSubtitleTextColorChange,
  width,
}) => {
  // Kiểm tra dự án có phụ đề hay không để khóa thao tác Dịch và Lồng tiếng (P1 Guard)
  const hasCues = (cues && cues.length > 0) || (activeProject?.cues_count ? activeProject.cues_count > 0 : false);
  const [activeTab, setActiveTab] = useState<RightPanelTab>('roi');

  // Mẫu vị trí gợi ý động (Position Templates CRUD)
  const [positionTemplates, setPositionTemplates] = useState<PositionTemplate[]>(() => {
    const DEFAULT_POSITION_TEMPLATES: PositionTemplate[] = [
      { id: 'one_line', name: '1 Dòng Sub', y: 0.61, height: 0.08, width: 0.94, x: 0.03, is_builtin: true },
      { id: 'two_lines', name: '2 Dòng Sub', y: 0.59, height: 0.13, width: 0.94, x: 0.03, is_builtin: true },
      { id: 'three_lines', name: '3 Dòng Sub', y: 0.57, height: 0.17, width: 0.94, x: 0.03, is_builtin: true },
      { id: 'top_header', name: 'Tiêu Đề Trên', y: 0.06, height: 0.08, width: 0.94, x: 0.03, is_builtin: true },
    ];
    try {
      const raw = localStorage.getItem('sub_studio_pos_templates_v2');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return DEFAULT_POSITION_TEMPLATES;
  });

  const [isAddingPosTemplate, setIsAddingPosTemplate] = useState(false);
  const [newPosTemplateName, setNewPosTemplateName] = useState('');
  const [editingPosTemplateId, setEditingPosTemplateId] = useState<string | null>(null);
  const [editingPosTemplateName, setEditingPosTemplateName] = useState('');

  const savePosTemplates = (templates: PositionTemplate[]) => {
    setPositionTemplates(templates);
    try {
      localStorage.setItem('sub_studio_pos_templates_v2', JSON.stringify(templates));
    } catch {}
  };

  const handleCreatePosTemplate = () => {
    if (!newPosTemplateName.trim()) return;
    const newTpl: PositionTemplate = {
      id: `pos-${Date.now()}`,
      name: newPosTemplateName.trim(),
      y: region.y,
      height: region.height,
      width: region.width,
      x: region.x,
    };
    const updated = [...positionTemplates, newTpl];
    savePosTemplates(updated);
    setIsAddingPosTemplate(false);
    setNewPosTemplateName('');
  };

  const handleDeletePosTemplate = (id: string) => {
    const updated = positionTemplates.filter((t) => t.id !== id);
    savePosTemplates(updated);
  };

  const handleRenamePosTemplate = (id: string, name: string) => {
    const updated = positionTemplates.map((t) => (t.id === id ? { ...t, name } : t));
    savePosTemplates(updated);
    setEditingPosTemplateId(null);
  };

  // AI & Export states
  const [isTranslatingAll, setIsTranslatingAll] = useState(false);
  const [translateMsg, setTranslateMsg] = useState<string | null>(null);

  const [isExportingMp4, setIsExportingMp4] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);


  const handleTranslateAllWithAi = async () => {
    if (!activeProject) return;
    setIsTranslatingAll(true);
    setTranslateMsg('Đang gọi AI dịch thuật ngữ cảnh toàn bộ tập phim...');
    try {
      await apiClient.retranslateProject(activeProject.project_id);
      setTranslateMsg('Dịch thuật và xử lý AI hoàn tất!');
      if (onRefreshCues) onRefreshCues();
      if (onRefreshProject) onRefreshProject();
    } catch (err: any) {
      setTranslateMsg(`Lỗi dịch AI: ${err?.message || 'Thất bại'}`);
    } finally {
      setIsTranslatingAll(false);
    }
  };

  const handleExportMp4 = async () => {
    if (!activeProject) return;
    setIsExportingMp4(true);
    setExportMessage('Đang kết xuất video MP4 gắn phụ đề...');
    try {
      const res = await apiClient.exportMp4(activeProject.project_id, {
        use_translated: true,
        mask_mode: previewMask ? (maskStyle || 'blur') : 'none',
        blur_strength: blurStrength,
        subtitle_placement: subtitlePlacement,
        regions: regions,
        flip_h: isFlippedH,
        flip_v: isFlippedV,
        video_x: videoPosition.x,
        video_y: videoPosition.y,
        rotation: rotation,
      });
      setExportMessage(`Xuất video thành công: ${res.output_path || 'Thành công'}`);
      if (onUpdateActiveProject) {
        onUpdateActiveProject({
          has_export: true,
          export_path: res.output_path,
        });
      }
      if (onRefreshProject) onRefreshProject();
    } catch (err: any) {
      setExportMessage(`Lỗi xuất video: ${err?.message || 'Không thành công'}`);
    } finally {
      setIsExportingMp4(false);
    }
  };

  if (isCollapsed) {
    return (
      <aside className="w-12 bg-slate-950 border-l border-slate-800/80 flex flex-col items-center py-3 space-y-4 shrink-0 select-none z-20">
        <button
          onClick={onToggleCollapse}
          className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white transition"
          title="Mở rộng Bảng Thuộc Tính (Inspector)"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button
          onClick={() => {
            setActiveTab('roi');
            onToggleCollapse?.();
          }}
          className={`p-2 rounded-lg transition ${
            activeTab === 'roi' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
          }`}
          title="Vùng Quét & ROI"
        >
          <Crop className="w-4 h-4" />
        </button>
        <button
          onClick={() => {
            setActiveTab('mask');
            onToggleCollapse?.();
          }}
          className={`p-2 rounded-lg transition ${
            activeTab === 'mask' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
          }`}
          title="Che Sub & Kiểu Chữ"
        >
          <Eye className="w-4 h-4" />
        </button>
        <button
          onClick={() => {
            setActiveTab('ai_export');
            onToggleCollapse?.();
          }}
          className={`p-2 rounded-lg transition ${
            activeTab === 'ai_export' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
          }`}
          title="AI Dịch & Xuất Bản"
        >
          <Sparkles className="w-4 h-4" />
        </button>
      </aside>
    );
  }

  return (
    <aside
      style={width ? { width: `${width}px` } : undefined}
      className="w-88 xl:w-96 bg-slate-950 border-l border-slate-800/80 flex flex-col shrink-0 select-none z-20 min-h-0 overflow-hidden shadow-lg"
    >
      {/* 1. Header Tab Bar (4 Tab Rõ Ràng Chuẩn Inspector) */}
      <div className="h-11 bg-slate-900/60 border-b border-slate-800/80 px-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1 bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-[11px] flex-1 mr-2">
          <button
            type="button"
            onClick={() => setActiveTab('roi')}
            className={`flex-1 py-1 rounded-md font-medium text-center transition ${
              activeTab === 'roi'
                ? 'bg-indigo-600 text-white font-semibold shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Vùng Quét Sub & OCR"
          >
            Quét/ROI
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('mask')}
            className={`flex-1 py-1 rounded-md font-medium text-center transition ${
              activeTab === 'mask'
                ? 'bg-indigo-600 text-white font-semibold shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Che Sub & Kiểu Chữ"
          >
            Che/Chữ
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('ai_export')}
            className={`flex-1 py-1 rounded-md font-medium text-center transition ${
              activeTab === 'ai_export'
                ? 'bg-indigo-600 text-white font-semibold shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="AI Dịch & Xuất Bản"
          >
            AI/Xuất
          </button>
        </div>

        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-900 transition"
            title="Thu gọn Bảng Thuộc Tính"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* 2. Nội dung Chi Tiết Từng Tab */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3.5 space-y-4 text-xs">

        {/* ================= TAB 1: QUÉT & ROI ================= */}
        {activeTab === 'roi' && (
          <div className="space-y-3.5 animate-in fade-in duration-150">
            {/* Thanh Tác Vụ Nhanh (Thêm Vùng + Reset) */}
            <div className="flex items-center gap-1.5 p-1 bg-slate-900/90 border border-slate-800 rounded-xl shadow-sm">
              {onAddRegion && (
                <button
                  type="button"
                  onClick={onAddRegion}
                  className="flex-1 py-2 px-3 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-emerald-400 hover:text-emerald-300 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer"
                  title="+ Thêm vùng quét phụ đề mới (Multi-ROI)"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ Thêm Vùng Quét</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  if (onResetAllParameters) onResetAllParameters();
                  else onResetTransform();
                }}
                className="px-3 py-2 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-rose-400 hover:text-rose-300 rounded-lg text-xs flex items-center justify-center gap-1 transition cursor-pointer"
                title="🔄 Đặt lại toàn bộ thông số vùng quét về mặc định"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Đặt Lại</span>
              </button>
            </div>

            {/* THẺ 1: Quản lý Đa Vùng Quét OCR (Multi-ROI) */}
            <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-xl space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-indigo-400" />
                  <span className="text-[11px] font-semibold text-slate-200">
                    Vùng quét OCR ({(regions && regions.length > 0 ? regions : [region]).length})
                  </span>
                </div>
                <span className="text-[10px] text-slate-400">
                  Nhấp chọn vùng để căn chỉnh
                </span>
              </div>

              {/* Danh sách các chip vùng */}
              <div className="flex flex-wrap gap-1.5">
                {(regions && regions.length > 0 ? regions : [region]).map((reg, idx) => {
                  const isSelected = reg.region_id === (activeRegionId || region.region_id);
                  const isBottom = reg.y > 0.5;
                  const isMasked = reg.mask_enabled !== false;
                  return (
                    <div
                      key={reg.region_id}
                      onClick={() => onSelectRegion?.(reg.region_id)}
                      className={`group flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium cursor-pointer transition select-none ${
                        isSelected
                          ? 'bg-indigo-600/30 border-indigo-500 text-white font-bold shadow-sm ring-1 ring-indigo-500/50'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                      }`}
                    >
                      <Crosshair className={`w-3 h-3 ${isSelected ? 'text-indigo-400' : 'text-slate-500'}`} />
                      <span>Vùng {idx + 1} {isBottom ? '(Đáy)' : '(Trên)'}</span>
                      <span className="text-[10px] opacity-70 font-mono">
                        {Math.round(reg.y * 100)}%
                      </span>
                      <span
                        className={`text-[9px] px-1 py-0.2 rounded font-mono ${
                          isMasked
                            ? 'bg-indigo-950/80 text-indigo-300 border border-indigo-700/60'
                            : 'bg-amber-950/80 text-amber-300 border border-amber-700/60'
                        }`}
                        title={isMasked ? 'Vùng này có làm mờ' : 'Vùng này chỉ quét phụ đề, không làm mờ'}
                      >
                        {isMasked ? 'Mờ' : 'Quét'}
                      </span>
                      {(regions && regions.length > 1) && onDeleteRegion && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteRegion(reg.region_id);
                          }}
                          className="ml-0.5 p-0.5 text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 rounded transition cursor-pointer"
                          title={`Xóa Vùng ${idx + 1}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* THẺ 2: Chế Độ Che Mờ & Hiển Thị Video (iOS Toggle Switches) */}
            <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-xl space-y-3">
              <div className="flex items-center gap-1.5 pb-1 border-b border-slate-800/80">
                <Droplet className="w-3.5 h-3.5 text-indigo-400" />
                <span className="text-[11px] font-semibold text-slate-200">
                  Chế Độ Che Mờ & Hiển Thị Video
                </span>
              </div>

              {/* Công tắc 1: Làm mờ vùng đang chọn */}
              {(() => {
                const isMaskOn = region.mask_enabled !== false;
                return (
                  <div className="flex items-center justify-between gap-3 p-2 bg-slate-950/60 border border-slate-800/60 rounded-lg">
                    <div className="space-y-0.5 min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-semibold text-slate-200">
                          Làm Mờ Vùng Đang Chọn
                        </span>
                        <span
                          className={`text-[9px] font-bold px-1.5 py-0.5 rounded transition-colors ${
                            isMaskOn
                              ? 'bg-indigo-950 text-indigo-300 border border-indigo-700/60'
                              : 'bg-slate-800 text-slate-400 border border-slate-700'
                          }`}
                        >
                          {isMaskOn ? 'ĐANG BẬT' : 'ĐANG TẮT'}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-400 leading-tight">
                        {isMaskOn
                          ? 'Bật hiệu ứng Blur che chữ gốc khi xuất video & xem trước'
                          : 'Tắt hiệu ứng làm mờ, chỉ quét OCR giữ nguyên video'}
                      </p>
                    </div>

                    <button
                      type="button"
                      role="switch"
                      aria-checked={isMaskOn}
                      onClick={() => {
                        onUpdateRegion({ ...region, mask_enabled: !isMaskOn });
                      }}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500/50 ${
                        isMaskOn ? 'bg-indigo-600' : 'bg-slate-700'
                      }`}
                      title={isMaskOn ? 'Nhấp để TẮT làm mờ vùng này' : 'Nhấp để BẬT làm mờ vùng này'}
                    >
                      <span
                        aria-hidden="true"
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                          isMaskOn ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                );
              })()}

              {/* Công tắc 2: Xem trước lớp che trên video */}
              <div className="flex items-center justify-between gap-3 p-2 bg-slate-950/60 border border-slate-800/60 rounded-lg">
                <div className="space-y-0.5 min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-semibold text-slate-200">
                      Hiển Thị Lớp Che Trên Video
                    </span>
                    <span
                      className={`text-[9px] font-bold px-1.5 py-0.5 rounded transition-colors ${
                        previewMask
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/60'
                          : 'bg-slate-800 text-slate-400 border border-slate-700'
                      }`}
                    >
                      {previewMask ? 'ĐANG HIỆN' : 'ĐANG ẨN'}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400 leading-tight">
                    {previewMask
                      ? 'Đang hiển thị hộp mờ che chữ trên màn hình xem video'
                      : 'Đang ẩn hộp mờ, hiển thị video nguyên bản rõ nét'}
                  </p>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={previewMask}
                  onClick={onTogglePreviewMask}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-emerald-500/50 ${
                    previewMask ? 'bg-emerald-600' : 'bg-slate-700'
                  }`}
                  title={previewMask ? 'Nhấp để ẨN lớp che trên video' : 'Nhấp để HIỆN lớp che trên video'}
                >
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                      previewMask ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* THẺ 3: Vị Trí & Kích Thước Khung Quét */}
            <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-xl space-y-3">
              {/* Tiêu đề & Nút Thêm Mẫu */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Tv className="w-3.5 h-3.5 text-indigo-400" />
                  <span className="text-[11px] font-semibold text-slate-200">
                    Mẫu Vị Trí Gợi Ý
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsAddingPosTemplate(true);
                    setNewPosTemplateName(`Mẫu ${positionTemplates.length + 1}`);
                  }}
                  className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-lg bg-indigo-600/30 hover:bg-indigo-600 border border-indigo-500/40 text-indigo-200 hover:text-white transition shadow-sm cursor-pointer"
                  title="Lưu tọa độ hiện tại thành mẫu vị trí mới"
                >
                  <Plus className="w-3 h-3" />
                  <span>+ Thêm Mẫu</span>
                </button>
              </div>

              {/* Form tạo mới Mẫu vị trí */}
              {isAddingPosTemplate && (
                <div className="p-2 bg-slate-950 border border-indigo-500/60 rounded-xl space-y-2 animate-in fade-in">
                  <label className="text-[10px] text-slate-300 font-semibold block">Tên Mẫu Vị Trí Mới:</label>
                  <input
                    type="text"
                    value={newPosTemplateName}
                    onChange={(e) => setNewPosTemplateName(e.target.value)}
                    placeholder="Ví dụ: Vùng Phụ Đề Chuẩn..."
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-white focus:outline-none focus:border-indigo-400"
                    autoFocus
                  />
                  <div className="flex justify-end gap-1.5 pt-0.5">
                    <button
                      type="button"
                      onClick={() => setIsAddingPosTemplate(false)}
                      className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 text-[10px]"
                    >
                      Hủy
                    </button>
                    <button
                      type="button"
                      onClick={handleCreatePosTemplate}
                      className="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold flex items-center gap-1 shadow"
                    >
                      <Save className="w-3 h-3" />
                      <span>Lưu Mẫu</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Grid 4 mẫu vị trí */}
              <div className="grid grid-cols-2 gap-1.5">
                {positionTemplates.map((tpl) => {
                  const isEditing = editingPosTemplateId === tpl.id;
                  const isCurrent =
                    Math.abs(region.y - tpl.y) < 0.03 &&
                    Math.abs(region.height - tpl.height) < 0.03;

                  return (
                    <div
                      key={tpl.id}
                      onClick={() => {
                        onUpdateRegion({
                          ...region,
                          y: tpl.y,
                          height: tpl.height,
                          width: tpl.width,
                          x: tpl.x ?? region.x,
                        });
                      }}
                      className={`p-2 rounded-xl border flex flex-col gap-1 transition cursor-pointer relative group/tpl ${
                        isCurrent
                          ? 'bg-indigo-950/80 border-indigo-500 text-white ring-1 ring-indigo-500/40'
                          : 'bg-slate-950 border-slate-800 hover:border-slate-700 text-slate-300'
                      }`}
                    >
                      {isEditing ? (
                        <div className="space-y-1" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="text"
                            value={editingPosTemplateName}
                            onChange={(e) => setEditingPosTemplateName(e.target.value)}
                            className="w-full bg-slate-900 border border-indigo-400 rounded px-1.5 py-0.5 text-[10px] text-white focus:outline-none"
                            autoFocus
                          />
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => setEditingPosTemplateId(null)}
                              className="px-1.5 py-0.5 rounded bg-slate-800 text-[9px] text-slate-400"
                            >
                              Hủy
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRenamePosTemplate(tpl.id, editingPosTemplateName)}
                              className="px-2 py-0.5 rounded bg-indigo-600 text-[9px] text-white font-semibold"
                            >
                              Lưu
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1 font-semibold text-[11px] truncate">
                              <Tv className="w-3 h-3 text-indigo-400 shrink-0" />
                              <span className="truncate">{tpl.name}</span>
                            </div>
                            <div className="flex items-center gap-0.5 opacity-0 group-hover/tpl:opacity-100 transition">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingPosTemplateId(tpl.id);
                                  setEditingPosTemplateName(tpl.name);
                                }}
                                className="p-0.5 hover:text-white text-slate-400"
                                title="Đổi tên mẫu vị trí"
                              >
                                <Edit2 className="w-2.5 h-2.5" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeletePosTemplate(tpl.id);
                                }}
                                className="p-0.5 hover:text-rose-400 text-slate-400"
                                title="Xóa mẫu vị trí này"
                              >
                                <Trash2 className="w-2.5 h-2.5" />
                              </button>
                            </div>
                          </div>
                          <div className="text-[9px] font-mono text-slate-400 flex items-center gap-1.5">
                            <span>Y: {Math.round(tpl.y * 100)}%</span>
                            <span>H: {Math.round(tpl.height * 100)}%</span>
                            <span>W: {Math.round(tpl.width * 100)}%</span>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Tọa độ chi tiết (Sliders) */}
              <div className="space-y-2.5 pt-2 border-t border-slate-800/80">
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-400">Vị trí Dọc (Y):</span>
                    <span className="text-indigo-400 font-mono font-bold">{Math.round(region.y * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="95"
                    value={Math.round(region.y * 100)}
                    onChange={(e) => onUpdateRegion({ ...region, y: parseFloat((parseInt(e.target.value) / 100).toFixed(4)) })}
                    className="w-full h-1.5 bg-slate-800 rounded appearance-none cursor-pointer accent-indigo-500"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-400">Chiều Cao (H):</span>
                    <span className="text-indigo-400 font-mono font-bold">{Math.round(region.height * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="5"
                    max="40"
                    value={Math.round(region.height * 100)}
                    onChange={(e) => onUpdateRegion({ ...region, height: parseFloat((parseInt(e.target.value) / 100).toFixed(4)) })}
                    className="w-full h-1.5 bg-slate-800 rounded appearance-none cursor-pointer accent-indigo-500"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-400">Chiều Rộng (W):</span>
                    <span className="text-indigo-400 font-mono font-bold">{Math.min(100, Math.round(region.width * 100))}%</span>
                  </div>
                  <input
                    type="range"
                    min="40"
                    max="100"
                    value={Math.min(100, Math.round(region.width * 100))}
                    onChange={(e) => {
                      const w = parseInt(e.target.value) / 100;
                      const x = Math.max(0, (1.0 - w) / 2);
                      onUpdateRegion({ ...region, x: parseFloat(x.toFixed(4)), width: parseFloat(w.toFixed(4)) });
                    }}
                    className="w-full h-1.5 bg-slate-800 rounded appearance-none cursor-pointer accent-indigo-500"
                  />
                </div>

                {/* Nút Căn giữa chuẩn */}
                <button
                  type="button"
                  onClick={() => onUpdateRegion({ ...region, x: 0.03, y: 0.61, width: 0.94, height: 0.08 })}
                  className="w-full py-2 bg-slate-950 hover:bg-slate-800 text-indigo-300 hover:text-white rounded-lg text-[11px] font-medium transition flex items-center justify-center gap-1.5 border border-slate-800 cursor-pointer"
                >
                  <Crosshair className="w-3.5 h-3.5 text-indigo-400" />
                  <span>⌖ Căn giữa chuẩn full ngang (W: 94%)</span>
                </button>
              </div>
            </div>

            {/* Nút Quét Sub Nhanh & Dừng / Hủy */}
            {onStartScan && (
              isScanning ? (
                <div className="flex items-center gap-2 w-full animate-in fade-in duration-150">
                  <div className="flex-1 py-2 px-2.5 bg-indigo-950/70 border border-indigo-700/60 text-indigo-300 rounded-xl text-xs font-semibold flex flex-col items-center justify-center gap-0.5 shadow-inner min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400 shrink-0" />
                      <span>
                        {scanProgress !== null && scanProgress !== undefined
                          ? `Đang Quét (${Math.round(scanProgress)}%)...`
                          : 'Đang Quét Phụ Đề...'}
                      </span>
                    </div>
                    {statusMessage && (
                      <span className="text-[10px] text-indigo-300/80 font-mono truncate max-w-full font-normal">
                        {statusMessage}
                      </span>
                    )}
                  </div>
                  {onStopScan && (
                    <button
                      type="button"
                      onClick={onStopScan}
                      className="px-4 py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-lg shadow-rose-600/30 active:scale-98 transition cursor-pointer"
                      title="Dừng hoặc Hủy tiến trình quét ngay lập tức"
                    >
                      <Square className="w-3.5 h-3.5 fill-white" />
                      <span>Dừng / Hủy</span>
                    </button>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={onStartScan}
                  className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20 active:scale-98 transition cursor-pointer"
                >
                  <Crop className="w-4 h-4" />
                  <span>Bắt Đầu Quét Sub Theo Vùng Này</span>
                </button>
              )
            )}
          </div>
        )}

        {/* ================= TAB 2: CHE SUB & CHỮ DỊCH ================= */}
        {activeTab === 'mask' && (
          <div className="space-y-4 animate-in fade-in duration-150">
            {/* Lớp che mờ chữ Trung gốc */}
            <div className="p-3 bg-slate-900/70 border border-slate-800 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200">Lớp Che Sub Gốc (Mask)</span>
                <button
                  type="button"
                  onClick={onTogglePreviewMask}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition ${
                    previewMask
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  {previewMask ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                  <span>{previewMask ? 'Đang Bật' : 'Đang Tắt'}</span>
                </button>
              </div>

              {/* Kiểu làm mờ */}
              <div className="space-y-1">
                <label className="text-[11px] text-slate-400 block font-medium">Kiểu làm mờ hòa tan:</label>
                <div className="relative flex items-center">
                  <select
                    value={maskStyle}
                    onChange={(e) => onMaskStyleChange && onMaskStyleChange(e.target.value as MaskStyleType)}
                    className="w-full bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 focus:border-indigo-500 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 appearance-none pr-7 focus:outline-none transition shadow-sm font-medium cursor-pointer"
                  >
                    <option value="feather_tight">Mờ siêu mỏng bám sát dòng chữ (Khuyên dùng)</option>
                    <option value="optical_blend">Hòa tan quang học thuần khiết (Không viền tối)</option>
                    <option value="soft_cinema">Gradient điện ảnh mềm (Soft Cinema Ambient)</option>
                    <option value="blur">Mờ hòa tan tự nhiên</option>
                    <option value="glass">Kính mờ trong suốt (Frosted Glass)</option>
                    <option value="ambient">Gradient đáy êm dịu</option>
                    <option value="feather">Viền lông mềm nhung</option>
                    <option value="mosaic">Khảm Mosaic nhẹ</option>
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 pointer-events-none" />
                </div>
              </div>

              {/* Độ mạnh làm mờ (Blur strength) */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-400">Độ mạnh làm mờ (Blur):</span>
                  <span className="text-amber-400 font-mono font-bold">{blurStrength}px</span>
                </div>
                <input
                  type="range"
                  min="5"
                  max="40"
                  step="1"
                  value={blurStrength}
                  onChange={(e) => onBlurStrengthChange && onBlurStrengthChange(parseInt(e.target.value, 10))}
                  className="w-full h-1.5 bg-slate-800 rounded appearance-none cursor-pointer accent-amber-500"
                />
              </div>

              {/* Độ che phủ / Độ mờ đục (Mask Opacity) */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-400">Độ che phủ (Opacity):</span>
                  <span className="text-amber-400 font-mono font-bold">{Math.round(maskOpacity * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="100"
                  step="5"
                  value={Math.round(maskOpacity * 100)}
                  onChange={(e) => onMaskOpacityChange && onMaskOpacityChange(parseInt(e.target.value, 10) / 100)}
                  className="w-full h-1.5 bg-slate-800 rounded appearance-none cursor-pointer accent-amber-500"
                />
              </div>

              {/* Mở rộng viền che (Mask Padding) */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-400">Mở rộng lề khung che (Padding):</span>
                  <span className="text-amber-400 font-mono font-bold">{maskPadding > 0 ? `+${maskPadding}` : maskPadding}px</span>
                </div>
                <input
                  type="range"
                  min="-4"
                  max="24"
                  step="1"
                  value={maskPadding}
                  onChange={(e) => onMaskPaddingChange && onMaskPaddingChange(parseInt(e.target.value, 10))}
                  className="w-full h-1.5 bg-slate-800 rounded appearance-none cursor-pointer accent-amber-500"
                />
              </div>

              {/* Bo góc khung che (Border Radius) */}
              <div className="space-y-1.5">
                <label className="text-[11px] text-slate-400 block font-medium">Bo góc khung che:</label>
                <div className="grid grid-cols-4 gap-1">
                  {[
                    { val: 0, label: 'Vuông 0' },
                    { val: 4, label: 'Nhẹ 4px' },
                    { val: 8, label: 'Vừa 8px' },
                    { val: 16, label: 'Tròn 16px' },
                  ].map((rad) => (
                    <button
                      key={rad.val}
                      type="button"
                      onClick={() => onMaskBorderRadiusChange && onMaskBorderRadiusChange(rad.val)}
                      className={`py-1 rounded text-[10px] font-semibold transition cursor-pointer active:scale-95 ${
                        maskBorderRadius === rad.val
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50 shadow-sm'
                          : 'bg-slate-950 hover:bg-slate-850 text-slate-400 border border-slate-800'
                      }`}
                    >
                      {rad.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Hiển thị & Định vị Phụ đề dịch */}
            <div className="p-3 bg-slate-900/70 border border-slate-800 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200">Hiển Thị Phụ Đề Dịch</span>
                <button
                  type="button"
                  onClick={onToggleSubtitleOverlay}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition ${
                    showSubtitleOverlay
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  <span>{showSubtitleOverlay ? 'BẬT' : 'TẮT'}</span>
                </button>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] text-slate-400 block">Vị trí đặt phụ đề:</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => onSubtitlePlacementChange && onSubtitlePlacementChange('roi')}
                    className={`py-2 px-2.5 rounded-lg border text-center transition text-[11px] font-medium ${
                      subtitlePlacement === 'roi'
                        ? 'bg-indigo-600/30 border-indigo-500 text-white font-bold'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Vùng quét (Đè chữ gốc)
                  </button>
                  <button
                    type="button"
                    onClick={() => onSubtitlePlacementChange && onSubtitlePlacementChange('bottom')}
                    className={`py-2 px-2.5 rounded-lg border text-center transition text-[11px] font-medium ${
                      subtitlePlacement === 'bottom'
                        ? 'bg-indigo-600/30 border-indigo-500 text-white font-bold'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Đáy video (Điện ảnh)
                  </button>
                </div>
              </div>
            </div>

            {/* Kiểu Dáng & Cỡ Chữ Phụ Đề (Typography) */}
            <div className="p-3 bg-slate-900/70 border border-slate-800 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200">Kiểu Dáng & Cỡ Chữ</span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-indigo-400 font-mono font-bold">{subtitleFontSize || 16}px</span>
                </div>
              </div>

              {/* Phông chữ */}
              <div className="space-y-1">
                <label className="text-[11px] text-slate-400 block font-medium">Phông chữ (Font Family):</label>
                <div className="relative flex items-center">
                  <select
                    value={subtitleFontFamily || 'Inter, sans-serif'}
                    onChange={(e) => onSubtitleFontFamilyChange && onSubtitleFontFamilyChange(e.target.value)}
                    className="w-full bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 focus:border-indigo-500 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 appearance-none pr-7 focus:outline-none transition shadow-sm font-medium cursor-pointer"
                  >
                    <option value="Inter, sans-serif">Inter (Mặc định - Chuẩn hiện đại)</option>
                    <option value="Roboto, sans-serif">Roboto (Google Font chuẩn)</option>
                    <option value="'Be Vietnam Pro', sans-serif">Be Vietnam Pro (Việt hóa đẹp)</option>
                    <option value="Montserrat, sans-serif">Montserrat (Đậm & Điện ảnh)</option>
                    <option value="Oswald, sans-serif">Oswald (Tiêu đề ấn tượng)</option>
                    <option value="'Playfair Display', serif">Playfair Display (Cổ điển sang trọng)</option>
                    <option value="'Noto Sans', sans-serif">Noto Sans (Đa ngôn ngữ rõ nét)</option>
                    <option value="Arial, sans-serif">Arial (Không chân cơ bản)</option>
                    <option value="'Times New Roman', serif">Times New Roman (Cổ điển có chân)</option>
                    <option value="'Courier New', monospace">Courier New (Đơn cách Monospace)</option>
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 pointer-events-none" />
                </div>
              </div>

              {/* Kích cỡ chữ */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-400">Kích thước chữ (Font Size):</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onSubtitleFontSizeChange && onSubtitleFontSizeChange(Math.max(10, (subtitleFontSize || 16) - 1))}
                      className="w-5 h-5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold flex items-center justify-center text-xs"
                      title="Giảm 1px"
                    >
                      -
                    </button>
                    <span className="text-indigo-400 font-mono font-bold w-7 text-center">{subtitleFontSize || 16}px</span>
                    <button
                      type="button"
                      onClick={() => onSubtitleFontSizeChange && onSubtitleFontSizeChange(Math.min(36, (subtitleFontSize || 16) + 1))}
                      className="w-5 h-5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold flex items-center justify-center text-xs"
                      title="Tăng 1px"
                    >
                      +
                    </button>
                  </div>
                </div>
                <input
                  type="range"
                  min="10"
                  max="36"
                  step="1"
                  value={subtitleFontSize || 16}
                  data-testid="subtitle-font-size-slider"
                  onChange={(e) => onSubtitleFontSizeChange && onSubtitleFontSizeChange(parseInt(e.target.value, 10))}
                  className="w-full h-1.5 bg-slate-800 rounded appearance-none cursor-pointer accent-indigo-500"
                />
              </div>

              {/* Font chữ tỉ lệ theo khung hình (Responsive Font Scale) */}
              <div className="flex items-center justify-between p-2 bg-slate-950 rounded-lg border border-slate-800">
                <div>
                  <div className="text-[11px] font-medium text-slate-200">Font chữ tỉ lệ theo khung nhìn</div>
                  <div className="text-[10px] text-slate-400">Tự co giãn chữ khi phóng to hoặc xem toàn màn hình</div>
                </div>
                <button
                  type="button"
                  onClick={() => onResponsiveFontScaleChange && onResponsiveFontScaleChange(!responsiveFontScale)}
                  className={`px-2 py-0.5 rounded text-[10px] font-bold transition ${
                    responsiveFontScale
                      ? 'bg-cyan-600 text-white'
                      : 'bg-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  {responsiveFontScale ? 'BẬT' : 'TẮT'}
                </button>
              </div>

              {/* Kiểu viền & Đổ bóng chữ (Text Stroke / Shadow) */}
              <div className="space-y-1.5">
                <label className="text-[11px] text-slate-400 block font-medium">Viền & Đổ bóng chữ:</label>
                <div className="grid grid-cols-4 gap-1">
                  {[
                    { id: 'none', label: 'Không viền' },
                    { id: 'soft', label: 'Bóng nhẹ' },
                    { id: 'stroke', label: 'Viền đen' },
                    { id: 'glow', label: 'Phát sáng' },
                  ].map((st) => (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => onSubtitleStrokeChange && onSubtitleStrokeChange(st.id as any)}
                      className={`py-1 rounded text-[10px] font-semibold transition cursor-pointer active:scale-95 ${
                        subtitleStroke === st.id
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'bg-slate-950 hover:bg-slate-850 text-slate-400 border border-slate-800'
                      }`}
                    >
                      {st.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Khoảng cách dòng (Line Height) */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-400">Khoảng cách dòng (Line Height):</span>
                  <span className="text-indigo-400 font-mono font-bold">{subtitleLineHeight?.toFixed(2) || '1.35'}x</span>
                </div>
                <input
                  type="range"
                  min="1.1"
                  max="1.8"
                  step="0.05"
                  value={subtitleLineHeight || 1.35}
                  onChange={(e) => onSubtitleLineHeightChange && onSubtitleLineHeightChange(parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-slate-800 rounded appearance-none cursor-pointer accent-indigo-500"
                />
              </div>

              {/* Màu sắc chữ */}
              <div className="space-y-1.5">
                <label className="text-[11px] text-slate-400 block">Màu sắc chữ phụ đề:</label>
                <div className="flex items-center gap-2">
                  {[
                    { label: 'Vàng Phim', color: '#fde047' },
                    { label: 'Trắng', color: '#ffffff' },
                    { label: 'Xanh Ngọc', color: '#34d399' },
                    { label: 'Xanh Lam', color: '#38bdf8' },
                    { label: 'Cam', color: '#fb923c' },
                  ].map((item) => (
                    <button
                      key={item.color}
                      type="button"
                      onClick={() => onSubtitleTextColorChange && onSubtitleTextColorChange(item.color)}
                      style={{ backgroundColor: item.color }}
                      className={`w-6 h-6 rounded-full border transition cursor-pointer shadow-sm ${
                        (subtitleTextColor || '#fde047').toLowerCase() === item.color.toLowerCase()
                          ? 'ring-2 ring-indigo-500 ring-offset-2 ring-offset-slate-900 border-white scale-110'
                          : 'border-slate-700 hover:scale-105'
                      }`}
                      title={`${item.label} (${item.color})`}
                    />
                  ))}
                  <input
                    type="color"
                    value={subtitleTextColor || '#fde047'}
                    onChange={(e) => onSubtitleTextColorChange && onSubtitleTextColorChange(e.target.value)}
                    className="w-7 h-7 rounded border border-slate-700 bg-slate-950 cursor-pointer p-0.5"
                    title="Bảng chọn màu tùy chỉnh"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================= TAB 3: AI & XUẤT BẢN ================= */}
        {activeTab === 'ai_export' && (
          <div className="space-y-4 animate-in fade-in duration-150">
            {/* Ngôn Ngữ Nhận Diện (OCR) & Dịch Thuật (AI) */}
            <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-xl space-y-2.5">
              <div className="flex items-center gap-1.5 pb-1 border-b border-slate-800/80">
                <Globe className="w-3.5 h-3.5 text-indigo-400" />
                <span className="text-[11px] font-semibold text-slate-200">
                  Ngôn Ngữ Nhận Diện (OCR) & Dịch Thuật (AI)
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-[10px] text-slate-400 block mb-1 font-medium">Gốc (Video):</span>
                  <div className="relative flex items-center">
                    <select
                      value={sourceLang}
                      onChange={(e) => onLanguageChange && onLanguageChange(e.target.value, targetLang)}
                      className="w-full bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 focus:border-indigo-500 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 appearance-none pr-7 focus:outline-none transition shadow-sm font-medium cursor-pointer"
                    >
                      <option value="zh">🇨🇳 Tiếng Trung</option>
                      <option value="en">🇬🇧 Tiếng Anh</option>
                      <option value="auto">🌐 Tự động</option>
                    </select>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 pointer-events-none" />
                  </div>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block mb-1 font-medium">Dịch sang (AI):</span>
                  <div className="relative flex items-center">
                    <select
                      value={targetLang}
                      onChange={(e) => onLanguageChange && onLanguageChange(sourceLang, e.target.value)}
                      className="w-full bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 focus:border-indigo-500 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 appearance-none pr-7 focus:outline-none transition shadow-sm font-medium cursor-pointer"
                    >
                      <option value="vi">🇻🇳 Tiếng Việt</option>
                      <option value="en">🇬🇧 Tiếng Anh</option>
                      <option value="zh">🇨🇳 Tiếng Trung</option>
                    </select>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 pointer-events-none" />
                  </div>
                </div>
              </div>
            </div>



            {/* 1. Thẻ Quét Phụ Đề Tự Động */}
            <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-xl space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-semibold text-slate-200">
                  <Tv className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Quét Phụ Đề Tự Động</span>
                </div>
                {scanProgress !== null && scanProgress !== undefined && isScanning && (
                  <span className="font-mono text-[10px] font-bold text-cyan-400 bg-indigo-950 px-2 py-0.5 rounded border border-indigo-700/60">
                    {Math.round(scanProgress)}%
                  </span>
                )}
              </div>

              {isScanning ? (
                <div className="space-y-2">
                  <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-indigo-500 to-cyan-400 h-full rounded-full transition-all duration-300"
                      style={{ width: `${Math.max(0, Math.min(100, scanProgress || 0))}%` }}
                    />
                  </div>
                  <div className="text-[10px] font-mono text-indigo-300 truncate">
                    {statusMessage || 'Đang thực thi nhận diện OCR...'}
                  </div>
                  {onStopScan && (
                    <button
                      type="button"
                      onClick={onStopScan}
                      className="w-full py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition shadow"
                    >
                      <Square className="w-3 h-3 fill-white" />
                      <span>Dừng Quét Phụ Đề</span>
                    </button>
                  )}
                </div>
              ) : (
                onStartScan && (
                  <button
                    type="button"
                    onClick={onStartScan}
                    disabled={!activeProject}
                    className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-semibold flex items-center justify-center gap-1.5 transition shadow disabled:opacity-50 cursor-pointer"
                  >
                    <Tv className="w-3.5 h-3.5" />
                    <span>{cues.length > 0 ? 'Quét Lại Phụ Đề' : 'Bắt Đầu Quét Sub'}</span>
                  </button>
                )
              )}
            </div>

            {/* Nút Dịch AI Toàn Bộ */}
            <div className="p-3 bg-indigo-950/40 border border-indigo-800/40 rounded-xl space-y-2">
              <div className="flex items-center gap-1.5 font-semibold text-indigo-300">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span>Dịch Thuật Ngữ Cảnh Điện Ảnh</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Tự động hiểu mối quan hệ nhân vật, xưng hô chuẩn bối cảnh và nhịp điệu phụ đề.
              </p>
              <button
                type="button"
                onClick={handleTranslateAllWithAi}
                disabled={isTranslatingAll || !activeProject || !hasCues}
                title={!hasCues ? "Cần quét hoặc nhập phụ đề trước khi dịch" : "Dịch Toàn Bộ Tập Phim"}
                className={`w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-semibold flex items-center justify-center gap-1.5 transition shadow disabled:opacity-50 ${!hasCues ? 'cursor-not-allowed' : 'cursor-pointer'}`}
              >
                {isTranslatingAll ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Đang Dịch Bằng AI...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Dịch Toàn Bộ Tập Phim</span>
                  </>
                )}
              </button>
              {translateMsg && (
                <div className="text-[11px] text-indigo-300 bg-slate-950/60 p-2 rounded border border-indigo-900 font-medium">
                  {translateMsg}
                </div>
              )}
            </div>

            {/* Trình phát Master Voiceover Audio nếu đã lồng tiếng */}
            {activeProject?.has_voiceover && (
              <div className="p-3 bg-amber-950/20 border border-amber-800/40 rounded-xl space-y-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-emerald-400 font-semibold flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Tệp Thuyết Minh Video</span>
                  </span>
                  <span className="text-[10px] text-amber-300 font-mono">
                    voiceover.mp3
                  </span>
                </div>
                <audio
                  controls
                  src={apiClient.getVoiceoverAudioUrl(activeProject.project_id)}
                  className="w-full h-8 rounded-lg"
                />
              </div>
            )}

            {/* Xuất Bản Video & File */}
            <div className="p-3 bg-slate-900/70 border border-slate-800 rounded-xl space-y-2.5">
              <span className="font-semibold text-slate-200 block">Xuất Bản & Kết Xuất:</span>

              <button
                type="button"
                onClick={handleExportMp4}
                disabled={isExportingMp4 || !activeProject}
                className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold flex items-center justify-center gap-1.5 transition shadow disabled:opacity-50"
              >
                {isExportingMp4 ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Đang Kết Xuất MP4...</span>
                  </>
                ) : (
                  <>
                    <FileVideo className="w-4 h-4" />
                    <span>Xuất Video MP4 (Inpainting)</span>
                  </>
                )}
              </button>

              {exportMessage && (
                <div className="text-[11px] text-emerald-300 bg-slate-950/60 p-2 rounded border border-emerald-900 font-medium break-all">
                  {exportMessage}
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </aside>
  );
};
