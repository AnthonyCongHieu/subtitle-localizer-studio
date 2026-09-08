import React, { useState, useEffect } from 'react';
import {
  Crop,
  Eye,
  EyeOff,
  Sliders,
  Sparkles,
  Tv,
  Crosshair,
  RotateCw,
  FlipHorizontal,
  FlipVertical,
  Maximize2,
  ChevronRight,
  ChevronLeft,
  Key,
  Loader2,
  FileVideo,
  Square,
  Layers,
  Plus,
  Trash2,
  Droplet,
  Scan,
  RotateCcw,
  Edit2,
  Save,
  Mic,
  CheckCircle2,
} from 'lucide-react';
import { RegionTrackV1, ProjectManifestV1, SubtitleCueV1 } from '../../types/api';
import {
  AspectRatioType,
  MaskStyleType,
  SubtitlePlacementMode,
} from '../../types/presets';
import { apiClient } from '../../api/client';

export type RightPanelTab = 'roi' | 'mask' | 'transform' | 'ai_export';

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
}

export const RightInspectorPanel: React.FC<RightInspectorPanelProps> = ({
  region,
  onUpdateRegion,
  onAutoDetectRoi,
  sourceLang,
  targetLang,
  onLanguageChange,
  previewMask,
  onTogglePreviewMask,
  maskStyle = 'feather_tight',
  onMaskStyleChange,
  blurStrength = 20,
  onBlurStrengthChange,
  showSubtitleOverlay,
  onToggleSubtitleOverlay,
  subtitlePlacement = 'roi',
  onSubtitlePlacementChange,
  aspectRatio,
  onAspectRatioChange,
  fitMode = 'contain',
  onToggleFitMode,
  isFlippedH,
  onToggleFlipH,
  isFlippedV,
  onToggleFlipV,
  rotation,
  onRotationChange,
  onRotate,
  videoPosition,
  onPositionChange,
  onResetTransform,
  onResetAllParameters,
  activeProject,
  cues = [],
  onRefreshCues,
  isScanning = false,
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
}) => {
  // Kiểm tra dự án có phụ đề hay không để khóa thao tác Dịch và Lồng tiếng (P1 Guard)
  const hasCues = (cues && cues.length > 0) || (activeProject?.cues_count ? activeProject.cues_count > 0 : false);
  const [activeTab, setActiveTab] = useState<RightPanelTab>('roi');

  // Mẫu vị trí gợi ý động (Position Templates CRUD)
  const [positionTemplates, setPositionTemplates] = useState<PositionTemplate[]>(() => {
    const DEFAULT_POSITION_TEMPLATES: PositionTemplate[] = [
      { id: 'one_line', name: '1 Dòng Đáy', y: 0.82, height: 0.12, width: 0.84, x: 0.08, is_builtin: true },
      { id: 'two_lines', name: '2 Dòng Đáy', y: 0.78, height: 0.18, width: 0.88, x: 0.06, is_builtin: true },
      { id: 'tiktok_portrait', name: 'Dọc TikTok', y: 0.70, height: 0.24, width: 0.90, x: 0.05, is_builtin: true },
      { id: 'top_header', name: 'Tiêu Đề Trên', y: 0.06, height: 0.12, width: 0.86, x: 0.07, is_builtin: true },
    ];
    try {
      const raw = localStorage.getItem('sub_studio_pos_templates_v1');
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
      localStorage.setItem('sub_studio_pos_templates_v1', JSON.stringify(templates));
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
  const [geminiStatus, setGeminiStatus] = useState<{ configured: boolean; masked_key?: string }>({
    configured: false,
  });
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [isSavingKey, setIsSavingKey] = useState(false);
  const [keyMessage, setKeyMessage] = useState<string | null>(null);

  const [isTranslatingAll, setIsTranslatingAll] = useState(false);
  const [translateMsg, setTranslateMsg] = useState<string | null>(null);

  const [isExportingMp4, setIsExportingMp4] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  useEffect(() => {
    if (activeTab === 'ai_export') {
      apiClient.getGeminiStatus().then(setGeminiStatus).catch(() => {});
    }
  }, [activeTab]);

  const handleSaveGeminiKey = async () => {
    if (!apiKeyInput.trim()) return;
    setIsSavingKey(true);
    setKeyMessage(null);
    try {
      await apiClient.setGeminiKey(apiKeyInput.trim());
      setGeminiStatus({ configured: true, masked_key: '••••••••' + apiKeyInput.slice(-4) });
      setKeyMessage('Đã lưu Gemini API Key thành công!');
      setApiKeyInput('');
    } catch (err: any) {
      setKeyMessage(`Lỗi: ${err?.message || 'Không thể lưu key'}`);
    } finally {
      setIsSavingKey(false);
    }
  };

  const [isDubbingAll, setIsDubbingAll] = useState(false);
  const [dubMsg, setDubMsg] = useState<string | null>(null);

  const handleDubAllVideo = async () => {
    if (!activeProject) return;
    setIsDubbingAll(true);
    setDubMsg('Đang gọi AI lồng tiếng toàn bộ video...');
    try {
      const dubSettings = activeProject.custom_pipeline_settings?.dubbing;
      const res = await apiClient.runDubbing(activeProject.project_id, {
        mode: dubSettings?.mode || 'single',
        voice: dubSettings?.voice,
        voice_male: dubSettings?.voice_male,
        voice_female: dubSettings?.voice_female,
        provider: dubSettings?.provider,
        rate: dubSettings?.rate,
      });
      setDubMsg('✓ Lồng tiếng toàn bộ video thành công!');
      if (onUpdateActiveProject) {
        onUpdateActiveProject({
          has_voiceover: true,
          voiceover_path: res.audio_url,
        });
      }
      if (onRefreshCues) onRefreshCues();
      if (onRefreshProject) onRefreshProject();
    } catch (err: any) {
      setDubMsg(`Lỗi lồng tiếng: ${err?.message || 'Thất bại'}`);
    } finally {
      setIsDubbingAll(false);
    }
  };

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
            setActiveTab('transform');
            onToggleCollapse?.();
          }}
          className={`p-2 rounded-lg transition ${
            activeTab === 'transform' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
          }`}
          title="Biến Đổi Video"
        >
          <Sliders className="w-4 h-4" />
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
    <aside className="w-88 xl:w-96 bg-slate-950 border-l border-slate-800/80 flex flex-col shrink-0 select-none z-20 min-h-0 overflow-hidden shadow-lg transition-all duration-200">
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
            onClick={() => setActiveTab('transform')}
            className={`flex-1 py-1 rounded-md font-medium text-center transition ${
              activeTab === 'transform'
                ? 'bg-indigo-600 text-white font-semibold shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Biến Đổi Video & Khung Hình"
          >
            Biến Đổi
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
          <div className="space-y-4 animate-in fade-in duration-150">
            {/* Thanh Phím Tắt Tiện Lợi (Quick Action Icons Strip) */}
            <div className="flex items-center justify-between gap-1 p-1 bg-slate-900/90 border border-slate-800 rounded-xl shadow-sm">
              {onAutoDetectRoi && (
                <button
                  type="button"
                  onClick={onAutoDetectRoi}
                  className="flex-1 py-1.5 px-2 bg-indigo-600/30 hover:bg-indigo-600 border border-indigo-500/40 hover:border-indigo-400 text-indigo-200 hover:text-white rounded-lg text-[10px] font-bold flex items-center justify-center gap-1 transition cursor-pointer"
                  title="🎯 Tự động quét và bắt dính vùng chữ phụ đề"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                  <span>Bắt Dính Chữ</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => onUpdateRegion({ ...region, x: 0.06, y: 0.81, width: 0.88, height: 0.15 })}
                className="p-1.5 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-indigo-300 hover:text-white rounded-lg text-[10px] flex items-center justify-center transition cursor-pointer"
                title="⌖ Căn giữa chuẩn phụ đề đáy"
              >
                <Crosshair className="w-3.5 h-3.5 text-indigo-400" />
              </button>
              <button
                type="button"
                onClick={onTogglePreviewMask}
                className={`p-1.5 border rounded-lg text-[10px] flex items-center justify-center transition cursor-pointer ${
                  previewMask ? 'bg-emerald-600 text-white border-emerald-500' : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                }`}
                title={previewMask ? 'Đang BẬT xem trước lớp che sub trên video' : 'Đang TẮT che (Nhấp để xem trước lớp che)'}
              >
                {previewMask ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              </button>
              {onAddRegion && (
                <button
                  type="button"
                  onClick={onAddRegion}
                  className="p-1.5 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-emerald-400 hover:text-emerald-300 rounded-lg text-[10px] flex items-center justify-center transition cursor-pointer"
                  title="+ Thêm vùng quét phụ đề mới (Multi-ROI)"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  if (onResetAllParameters) onResetAllParameters();
                  else onResetTransform();
                }}
                className="p-1.5 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-rose-400 hover:text-rose-300 rounded-lg text-[10px] flex items-center justify-center transition cursor-pointer"
                title="🔄 Reset toàn bộ thông số video và vùng quét về mặc định"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Quản lý Đa Vùng Quét OCR (Multi-ROI: Thêm / Xóa / Chọn vùng) */}
            <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-xl space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-indigo-400" />
                  <span className="text-[11px] font-semibold text-slate-200">
                    Vùng quét OCR ({(regions && regions.length > 0 ? regions : [region]).length})
                  </span>
                </div>
                {onAddRegion && (
                  <button
                    type="button"
                    onClick={onAddRegion}
                    className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition shadow-sm active:scale-95 cursor-pointer"
                    title="Thêm một vùng quét phụ đề OCR mới"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Thêm Vùng</span>
                  </button>
                )}
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

              {/* Tùy chỉnh Làm Mờ / Chỉ Quét Sub cho Vùng Đang Chọn */}
              <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2">
                <div className="space-y-0.5 min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-200">
                    {region.mask_enabled !== false ? (
                      <Droplet className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                    ) : (
                      <Scan className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    )}
                    <span>Hiệu ứng Làm Mờ (Vùng này)</span>
                  </div>
                  <p className="text-[10px] text-slate-400 leading-tight">
                    {region.mask_enabled !== false
                      ? 'Đang BẬT: Che chữ gốc bằng Blur khi xuất video & xem trước'
                      : 'Đang TẮT: Chỉ quét OCR, giữ nguyên video 100% không làm mờ'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const nextMask = region.mask_enabled === false;
                    onUpdateRegion({ ...region, mask_enabled: nextMask });
                  }}
                  className={`shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition cursor-pointer flex items-center gap-1 shadow-sm active:scale-95 ${
                    region.mask_enabled !== false
                      ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
                      : 'bg-amber-600 hover:bg-amber-500 text-white'
                  }`}
                  title="Chuyển đổi giữa Bật làm mờ và Chỉ quét Sub cho vùng này"
                >
                  {region.mask_enabled !== false ? (
                    <>
                      <Droplet className="w-3 h-3" />
                      <span>Bật Làm Mờ</span>
                    </>
                  ) : (
                    <>
                      <Scan className="w-3 h-3" />
                      <span>Chỉ Quét Sub</span>
                    </>
                  )}
                </button>
              </div>

              {/* Xem trước Lớp Che Sub Toàn Cục */}
              <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2">
                <div className="space-y-0.5 min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-200">
                    {previewMask ? (
                      <Eye className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    ) : (
                      <EyeOff className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    )}
                    <span>Hiển Thị Lớp Che Trên Video</span>
                  </div>
                  <p className="text-[10px] text-slate-400 leading-tight">
                    {previewMask
                      ? 'Đang hiển thị vùng làm mờ che phụ đề trên màn hình xem video'
                      : 'Đang ẩn lớp che mờ, hiển thị video nguyên bản'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onTogglePreviewMask}
                  className={`shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition cursor-pointer flex items-center gap-1 shadow-sm active:scale-95 ${
                    previewMask
                      ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                  }`}
                  title="Bật/Tắt xem trước lớp che sub gốc trên video"
                >
                  {previewMask ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                  <span>{previewMask ? 'Đang Bật Che' : 'Đang Tắt Che'}</span>
                </button>
              </div>
            </div>

            {/* Tự Bắt Dính Chữ */}
            {onAutoDetectRoi && (
              <button
                type="button"
                onClick={onAutoDetectRoi}
                className="w-full py-2 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white rounded-xl font-semibold flex items-center justify-center gap-1.5 transition shadow-md shadow-indigo-600/20 active:scale-98"
              >
                <Sparkles className="w-4 h-4 text-amber-300" />
                <span>🎯 Tự Động Bắt Dính Vùng Chữ</span>
              </button>
            )}

            {/* Ngôn ngữ Nguồn & Đích */}
            <div className="p-3 bg-slate-900/70 border border-slate-800 rounded-xl space-y-2">
              <label className="text-slate-300 font-medium block text-[11px]">Ngôn ngữ nhận diện & Dịch:</label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-[10px] text-slate-500 block mb-1">Gốc:</span>
                  <select
                    value={sourceLang}
                    onChange={(e) => onLanguageChange && onLanguageChange(e.target.value, targetLang)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-1.5 text-slate-200 text-xs focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="zh">🇨🇳 Tiếng Trung</option>
                    <option value="en">🇬🇧 Tiếng Anh</option>
                    <option value="ja">🇯🇵 Tiếng Nhật</option>
                    <option value="ko">🇰🇷 Tiếng Hàn</option>
                    <option value="auto">🌐 Tự động</option>
                  </select>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block mb-1">Dịch sang:</span>
                  <select
                    value={targetLang}
                    onChange={(e) => onLanguageChange && onLanguageChange(sourceLang, e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-1.5 text-slate-200 text-xs focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="vi">🇻🇳 Tiếng Việt</option>
                    <option value="en">🇬🇧 Tiếng Anh</option>
                    <option value="zh">🇨🇳 Tiếng Trung</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Mẫu vị trí gợi ý & Quản lý Thêm/Sửa/Xóa Mẫu */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-slate-400 font-medium block text-[11px]">Mẫu vị trí gợi ý:</label>
                <button
                  type="button"
                  onClick={() => {
                    setIsAddingPosTemplate(true);
                    setNewPosTemplateName(`Mẫu ${positionTemplates.length + 1}`);
                  }}
                  className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-indigo-600/40 hover:bg-indigo-600 border border-indigo-500/40 text-indigo-200 hover:text-white transition shadow-sm cursor-pointer"
                  title="Lưu tọa độ Y, Chiều cao, Chiều rộng hiện tại thành mẫu vị trí mới"
                >
                  <Plus className="w-3 h-3" />
                  <span>+ Thêm Mẫu</span>
                </button>
              </div>

              {/* Form tạo mới Mẫu vị trí */}
              {isAddingPosTemplate && (
                <div className="p-2 bg-slate-950 border border-indigo-500 rounded-xl space-y-2 animate-in fade-in">
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
                      className="px-2.5 py-1 rounded bg-slate-800 text-slate-300 text-[10px]"
                    >
                      Hủy
                    </button>
                    <button
                      type="button"
                      onClick={handleCreatePosTemplate}
                      className="px-3 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold flex items-center gap-1 shadow"
                    >
                      <Save className="w-3 h-3" />
                      <span>Lưu Mẫu</span>
                    </button>
                  </div>
                </div>
              )}

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
                          : 'bg-slate-900/80 border-slate-800 hover:border-slate-700 text-slate-300'
                      }`}
                    >
                      {isEditing ? (
                        <div className="space-y-1" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="text"
                            value={editingPosTemplateName}
                            onChange={(e) => setEditingPosTemplateName(e.target.value)}
                            className="w-full bg-slate-950 border border-indigo-400 rounded px-1.5 py-0.5 text-[10px] text-white focus:outline-none"
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
            </div>

            {/* Tọa độ chi tiết (Sliders) */}
            <div className="p-3 bg-slate-900/70 border border-slate-800 rounded-xl space-y-3">
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
                  <span className="text-indigo-400 font-mono font-bold">{Math.round(region.width * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="40"
                  max="100"
                  value={Math.round(region.width * 100)}
                  onChange={(e) => {
                    const w = parseInt(e.target.value) / 100;
                    const x = Math.max(0, (1.0 - w) / 2);
                    onUpdateRegion({ ...region, x: parseFloat(x.toFixed(4)), width: parseFloat(w.toFixed(4)) });
                  }}
                  className="w-full h-1.5 bg-slate-800 rounded appearance-none cursor-pointer accent-indigo-500"
                />
              </div>
            </div>

            {/* Căn giữa chuẩn */}
            <button
              type="button"
              onClick={() => onUpdateRegion({ region_id: 'roi-main', x: 0.06, y: 0.81, width: 0.88, height: 0.15 })}
              className="w-full py-2 bg-slate-900 hover:bg-slate-850 text-indigo-300 rounded-xl text-[11px] font-medium transition flex items-center justify-center gap-1.5 border border-slate-800"
            >
              <Crosshair className="w-3.5 h-3.5 text-indigo-400" />
              <span>Căn giữa chuẩn phụ đề</span>
            </button>

            {/* Nút Quét Sub Nhanh & Dừng / Hủy */}
            {onStartScan && (
              isScanning ? (
                <div className="flex items-center gap-2 w-full animate-in fade-in duration-150">
                  <div className="flex-1 py-2.5 bg-indigo-950/70 border border-indigo-700/60 text-indigo-300 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 shadow-inner">
                    <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                    <span>Đang Quét Phụ Đề...</span>
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
                <label className="text-[11px] text-slate-400 block">Kiểu làm mờ hòa tan:</label>
                <select
                  value={maskStyle}
                  onChange={(e) => onMaskStyleChange && onMaskStyleChange(e.target.value as MaskStyleType)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
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
          </div>
        )}

        {/* ================= TAB 3: BIẾN ĐỔI VIDEO ================= */}
        {activeTab === 'transform' && (
          <div className="space-y-4 animate-in fade-in duration-150">
            {/* Tỉ lệ Canvas */}
            <div className="p-3 bg-slate-900/70 border border-slate-800 rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-slate-300 font-medium block text-[11px]">Tỉ lệ khung hình Canvas:</label>
                {onToggleFitMode && (
                  <button
                    type="button"
                    onClick={onToggleFitMode}
                    className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border transition ${
                      fitMode === 'cover'
                        ? 'bg-amber-950/80 border-amber-600 text-amber-300 font-semibold'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                    title={fitMode === 'cover' ? 'Chế độ Tràn viền (Cover)' : 'Chế độ Đệm đen chuẩn (Contain)'}
                  >
                    <Maximize2 className="w-2.5 h-2.5" />
                    <span>{fitMode === 'cover' ? 'Tràn viền' : 'Đệm chuẩn'}</span>
                  </button>
                )}
              </div>
              <div className="grid grid-cols-3 gap-1.5 text-[11px] font-mono">
                {[
                  { id: 'original', label: 'Gốc' },
                  { id: '9:16', label: '9:16 TikTok' },
                  { id: '16:9', label: '16:9 YT/TV' },
                  { id: '1:1', label: '1:1 Vuông' },
                  { id: '4:3', label: '4:3' },
                  { id: '2.35:1', label: '2.35:1' },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onAspectRatioChange(item.id as AspectRatioType)}
                    className={`p-1.5 rounded-lg border text-center transition ${
                      aspectRatio === item.id
                        ? 'bg-indigo-600 text-white font-bold shadow-sm'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Lật & Xoay video */}
            <div className="p-3 bg-slate-900/70 border border-slate-800 rounded-xl space-y-3">
              <label className="text-slate-300 font-medium block text-[11px]">Lật & Xoay Video:</label>
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={onToggleFlipH}
                  className={`p-2 rounded-lg border flex flex-col items-center gap-1 text-[11px] transition ${
                    isFlippedH
                      ? 'bg-indigo-600/40 border-indigo-500 text-white font-bold'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <FlipHorizontal className="w-3.5 h-3.5" />
                  <span>Lật Ngang</span>
                </button>
                <button
                  type="button"
                  onClick={onToggleFlipV}
                  className={`p-2 rounded-lg border flex flex-col items-center gap-1 text-[11px] transition ${
                    isFlippedV
                      ? 'bg-indigo-600/40 border-indigo-500 text-white font-bold'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <FlipVertical className="w-3.5 h-3.5" />
                  <span>Lật Dọc</span>
                </button>
                <button
                  type="button"
                  onClick={onRotate}
                  className="p-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 hover:text-white flex flex-col items-center gap-1 text-[11px] transition"
                  title="Xoay nhanh +90 độ"
                >
                  <RotateCw className="w-3.5 h-3.5 text-cyan-400" />
                  <span>+90°</span>
                </button>
              </div>

              {/* Slider góc xoay mịn */}
              <div className="space-y-1 pt-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-400">Góc xoay tự do:</span>
                  <span className="text-cyan-400 font-mono font-bold">{rotation}°</span>
                </div>
                <input
                  type="range"
                  min={-180}
                  max={180}
                  step={1}
                  value={rotation}
                  onChange={(e) => onRotationChange && onRotationChange(parseInt(e.target.value, 10))}
                  className="w-full h-1.5 bg-slate-800 rounded appearance-none cursor-pointer accent-cyan-500"
                />
              </div>
            </div>

            {/* Vị trí Lệch tâm (X, Y) & Reset */}
            <div className="p-3 bg-slate-900/70 border border-slate-800 rounded-xl space-y-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400">Vị trí lệch tâm (Kéo thả):</span>
                <span className="font-mono text-indigo-300">X: {videoPosition.x} | Y: {videoPosition.y}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onResetTransform}
                  className="flex-1 py-2 bg-slate-900 hover:bg-slate-850 text-slate-300 hover:text-white rounded-lg border border-slate-800 text-[11px] font-medium transition"
                >
                  Đặt Lại Video Về Tâm (Reset 0, 0)
                </button>
                {onPositionChange && (videoPosition.x !== 0 || videoPosition.y !== 0) && (
                  <button
                    type="button"
                    onClick={() => onPositionChange({ x: 0, y: 0 })}
                    className="px-2.5 py-2 bg-indigo-950/80 hover:bg-indigo-900 text-indigo-300 rounded-lg border border-indigo-700/60 text-[11px] font-mono transition"
                    title="Đưa tọa độ X, Y về 0"
                  >
                    Về 0
                  </button>
                )}
              </div>
            </div>

            {/* Nút Reset Toàn Bộ Thông Số Video Về Mặc Định */}
            <button
              type="button"
              onClick={onResetAllParameters || onResetTransform}
              className="w-full py-2.5 bg-slate-900 hover:bg-rose-950/40 border border-slate-800 hover:border-rose-700/60 text-slate-300 hover:text-rose-300 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer shadow-sm active:scale-98"
              title="Khôi phục toàn bộ góc xoay, tỷ lệ, vị trí, zoom, lật và mask về mặc định"
            >
              <RotateCcw className="w-4 h-4 text-rose-400" />
              <span>Khôi Phục Toàn Bộ Thông Số Video Về Mặc Định</span>
            </button>
          </div>
        )}

        {/* ================= TAB 4: AI & XUẤT BẢN ================= */}
        {activeTab === 'ai_export' && (
          <div className="space-y-4 animate-in fade-in duration-150">
            {/* Cấu hình Gemini AI */}
            <div className="p-3 bg-slate-900/70 border border-slate-800 rounded-xl space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5 text-indigo-400" />
                  <span className="font-semibold text-slate-200">Google Gemini AI</span>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                  geminiStatus.configured
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                }`}>
                  {geminiStatus.configured ? 'Đã Cấu Hình' : 'Chưa Nhập Key'}
                </span>
              </div>

              <input
                type="password"
                placeholder={geminiStatus.configured ? 'Dán key mới nếu muốn đổi...' : 'Dán mã AIzaSy...'}
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 placeholder-slate-600 focus:border-indigo-500 focus:outline-none"
              />

              <div className="flex items-center justify-between">
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] text-indigo-400 hover:underline"
                >
                  Lấy Key Miễn Phí (15 RPM)
                </a>
                <button
                  type="button"
                  onClick={handleSaveGeminiKey}
                  disabled={isSavingKey || !apiKeyInput.trim()}
                  className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold disabled:opacity-50 transition"
                >
                  {isSavingKey ? 'Đang lưu...' : 'Lưu Key'}
                </button>
              </div>

              {keyMessage && <div className="text-[11px] text-indigo-400 font-medium">{keyMessage}</div>}
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

            {/* Lồng Tiếng AI Toàn Video */}
            <div className="p-3 bg-amber-950/30 border border-amber-800/40 rounded-xl space-y-2">
              <div className="flex items-center gap-1.5 font-semibold text-amber-300">
                <Mic className="w-4 h-4 text-amber-400" />
                <span>Lồng Tiếng AI Toàn Bộ Video</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Tạo giọng đọc thuyết minh tiếng Việt tự nhiên và đồng bộ chuẩn thời lượng từng câu phụ đề.
              </p>
              <button
                type="button"
                onClick={handleDubAllVideo}
                disabled={isDubbingAll || !activeProject || !hasCues}
                title={!hasCues ? "Cần quét hoặc nhập phụ đề trước khi lồng tiếng" : "Lồng Tiếng Toàn Bộ Video"}
                className={`w-full py-2 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-slate-950 font-bold rounded-lg flex items-center justify-center gap-1.5 transition shadow disabled:opacity-50 ${!hasCues ? 'cursor-not-allowed' : 'cursor-pointer'}`}
              >
                {isDubbingAll ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                    <span>Đang Tạo Giọng Đọc...</span>
                  </>
                ) : (
                  <>
                    <Mic className="w-4 h-4 text-slate-950" />
                    <span>Lồng Tiếng Toàn Bộ Video</span>
                  </>
                )}
              </button>
              {dubMsg && (
                <div className="text-[11px] text-amber-300 bg-slate-950/60 p-2 rounded border border-amber-900 font-medium">
                  {dubMsg}
                </div>
              )}

              {/* Trình phát Master Voiceover Audio nếu có */}
              {activeProject?.has_voiceover && (
                <div className="pt-2 border-t border-amber-800/40 space-y-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-emerald-400 font-semibold flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Đã có tệp giọng đọc</span>
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
            </div>

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
