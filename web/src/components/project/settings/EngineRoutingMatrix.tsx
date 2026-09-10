import React, { useState } from 'react';
import {
  RoutingServiceMatrix,
  EngineNodeConfig,
  ServiceType,
  saveRouterMatrix,
} from '../../../types/engineRouter';
import {
  Network,
  Languages,
  FileText,
  Mic,
  Settings,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import { EngineConfigModal } from './EngineConfigModal';

interface EngineRoutingMatrixProps {
  matrix: RoutingServiceMatrix[];
  onUpdateMatrix: (newMatrix: RoutingServiceMatrix[]) => void;
  onSelectPipelineProvider?: (
    service: ServiceType,
    engine: EngineNodeConfig,
    isFallback?: boolean
  ) => void;
}

export const EngineRoutingMatrix: React.FC<EngineRoutingMatrixProps> = ({
  matrix,
  onUpdateMatrix,
  onSelectPipelineProvider,
}) => {
  const [editingEngine, setEditingEngine] = useState<EngineNodeConfig | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);


  // Đổi Active Engine cho 1 dịch vụ
  const handleSwitchActiveEngine = (serviceType: ServiceType, targetEngineId: string) => {
    const updated = matrix.map((s) => {
      if (s.serviceType === serviceType) {
        return { ...s, activeEngineId: targetEngineId };
      }
      return s;
    });
    onUpdateMatrix(updated);
    saveRouterMatrix(updated);

    const targetService = updated.find((s) => s.serviceType === serviceType);
    const targetEngine = targetService?.availableEngines.find((e) => e.id === targetEngineId);
    if (targetEngine && onSelectPipelineProvider) {
      onSelectPipelineProvider(serviceType, targetEngine, false);
    }
  };

  // Đổi Fallback Engine cho 1 dịch vụ
  const handleSwitchFallbackEngine = (serviceType: ServiceType, targetEngineId: string) => {
    const updated = matrix.map((s) => {
      if (s.serviceType === serviceType) {
        return { ...s, fallbackEngineId: targetEngineId || undefined };
      }
      return s;
    });
    onUpdateMatrix(updated);
    saveRouterMatrix(updated);

    const targetService = updated.find((s) => s.serviceType === serviceType);
    const targetEngine = targetService?.availableEngines.find((e) => e.id === targetEngineId);
    if (targetEngine && onSelectPipelineProvider) {
      onSelectPipelineProvider(serviceType, targetEngine, true);
    }
  };

  // Bật/tắt chế độ tự động Failover
  const handleToggleAutoFallback = (serviceType: ServiceType, enabled: boolean) => {
    const updated = matrix.map((s) => {
      if (s.serviceType === serviceType) {
        return { ...s, autoFallback: enabled };
      }
      return s;
    });
    onUpdateMatrix(updated);
    saveRouterMatrix(updated);
  };

  // Thêm mới Custom Engine Node (chuẩn OpenAI Compatible)
  const handleAddNewCustomEngine = (serviceType: ServiceType) => {
    const newId = `custom-${serviceType}-${Date.now().toString(36)}`;
    const newEngine: EngineNodeConfig = {
      id: newId,
      name: `Custom Engine (${serviceType.toUpperCase()})`,
      serviceType,
      protocol: 'openai_compatible',
      model: 'default-model',
      baseUrl: 'https://api.openai.com/v1',
      isCustom: true,
      status: 'ready',
      statusMessage: 'Custom Endpoint tùy chỉnh',
    };

    setEditingEngine(newEngine);
    setIsModalOpen(true);
  };

  // Lưu cấu hình chỉnh sửa từ modal
  const handleSaveEngineConfig = (updatedEngine: EngineNodeConfig) => {
    const updated = matrix.map((s) => {
      if (s.serviceType === updatedEngine.serviceType) {
        const exists = s.availableEngines.some((e) => e.id === updatedEngine.id);
        const newEngines = exists
          ? s.availableEngines.map((e) => (e.id === updatedEngine.id ? updatedEngine : e))
          : [...s.availableEngines, updatedEngine];
        return { ...s, availableEngines: newEngines };
      }
      return s;
    });

    onUpdateMatrix(updated);
    saveRouterMatrix(updated);

    // Đồng bộ nếu đây là engine đang active
    const curService = updated.find((s) => s.serviceType === updatedEngine.serviceType);
    if (curService?.activeEngineId === updatedEngine.id && onSelectPipelineProvider) {
      onSelectPipelineProvider(updatedEngine.serviceType, updatedEngine, false);
    }
  };

  // Xóa Custom Engine
  const handleDeleteEngine = (engineId: string) => {
    const updated = matrix.map((s) => {
      const filtered = s.availableEngines.filter((e) => e.id !== engineId);
      let newActive = s.activeEngineId;
      let newFallback = s.fallbackEngineId;

      if (s.activeEngineId === engineId && filtered.length > 0) {
        newActive = filtered[0].id;
      }
      if (s.fallbackEngineId === engineId) {
        newFallback = undefined;
      }

      return {
        ...s,
        activeEngineId: newActive,
        fallbackEngineId: newFallback,
        availableEngines: filtered,
      };
    });

    onUpdateMatrix(updated);
    saveRouterMatrix(updated);
  };

  const getServiceIcon = (type: ServiceType) => {
    switch (type) {
      case 'translation':
        return <Languages className="w-4 h-4 text-amber-400" />;
      case 'ocr':
        return <FileText className="w-4 h-4 text-indigo-400" />;
      case 'dubbing':
        return <Mic className="w-4 h-4 text-emerald-400" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Thông Tin Router Matrix */}
      <div className="p-5 rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950/20 to-slate-900 border border-indigo-900/40 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
              <Network className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span>Bảng Ma Trận Định Tuyến Động Cơ (Engine Routing Matrix)</span>
                <span className="px-2 py-0.5 rounded-full bg-indigo-900/60 border border-indigo-700/50 text-indigo-300 text-[10px] font-mono">
                  9Router Architecture
                </span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Kiểm soát luồng xử lý độc lập cho từng dịch vụ OCR, Dịch thuật và Dubbing. Hỗ trợ Failover tự động và Custom Endpoint chuẩn OpenAI.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="px-3 py-1 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 text-xs font-mono flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>3/3 Dịch vụ kết nối</span>
          </span>
        </div>
      </div>

      {/* BẢNG MA TRẬN ROUTING TABLE */}
      <div className="border border-slate-800 rounded-2xl bg-slate-900/80 overflow-hidden shadow-md">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-950/80 border-b border-slate-800 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                <th className="py-3.5 px-4 w-[220px]">Dịch Vụ (Service)</th>
                <th className="py-3.5 px-4 w-[260px]">Động Cơ Chính (Active Engine)</th>
                <th className="py-3.5 px-4 w-[240px]">Động Cơ Dự Phòng (Failover)</th>
                <th className="py-3.5 px-4">Thông Số Endpoint & Model</th>
                <th className="py-3.5 px-4 text-right w-[140px]">Thao Tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 font-sans">
              {matrix.map((service) => {
                const activeEngine = service.availableEngines.find(
                  (e) => e.id === service.activeEngineId
                );


                return (
                  <tr
                    key={service.serviceType}
                    className="hover:bg-slate-850/40 transition-colors"
                  >
                    {/* Cột 1: Tên Dịch Vụ */}
                    <td className="py-4 px-4 align-top">
                      <div className="flex items-start gap-2.5">
                        <div className="p-2 rounded-xl bg-slate-950 border border-slate-800 mt-0.5">
                          {getServiceIcon(service.serviceType)}
                        </div>
                        <div>
                          <div className="font-bold text-slate-100 text-xs">
                            {service.displayName}
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5 leading-relaxed line-clamp-2">
                            {service.description}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleAddNewCustomEngine(service.serviceType)}
                            className="mt-2 text-[10px] text-indigo-400 hover:text-indigo-300 font-semibold flex items-center gap-1 transition cursor-pointer"
                          >
                            <Plus className="w-3 h-3" />
                            <span>Thêm Custom Endpoint</span>
                          </button>
                        </div>
                      </div>
                    </td>

                    {/* Cột 2: Active Engine */}
                    <td className="py-4 px-4 align-top">
                      <div className="space-y-1.5">
                        <select
                          value={service.activeEngineId}
                          onChange={(e) =>
                            handleSwitchActiveEngine(service.serviceType, e.target.value)
                          }
                          className="w-full bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-slate-100 font-medium focus:outline-none focus:border-indigo-500 transition"
                        >
                          {service.availableEngines.map((eng) => (
                            <option key={eng.id} value={eng.id}>
                              {eng.name} {eng.isCustom ? '★ Custom' : ''}
                            </option>
                          ))}
                        </select>

                        {activeEngine && (
                          <div className="p-2 rounded-lg bg-slate-950/70 border border-slate-800/80 flex items-center justify-between text-[11px]">
                            <span className="flex items-center gap-1.5 text-emerald-400 font-mono">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                              <span>{activeEngine.status === 'ready' ? 'Hoạt động' : 'Chờ kiểm tra'}</span>
                            </span>
                            {activeEngine.latencyMs && (
                              <span className="text-slate-500 font-mono text-[10px]">
                                {activeEngine.latencyMs}ms
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Cột 3: Fallback Engine */}
                    <td className="py-4 px-4 align-top">
                      <div className="space-y-1.5">
                        <select
                          value={service.fallbackEngineId || ''}
                          onChange={(e) =>
                            handleSwitchFallbackEngine(service.serviceType, e.target.value)
                          }
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-indigo-500 transition"
                        >
                          <option value="">-- Không dùng Fallback --</option>
                          {service.availableEngines
                            .filter((eng) => eng.id !== service.activeEngineId)
                            .map((eng) => (
                              <option key={eng.id} value={eng.id}>
                                {eng.name}
                              </option>
                            ))}
                        </select>

                        <label className="flex items-center gap-1.5 cursor-pointer text-[10.5px] text-slate-400 pt-0.5">
                          <input
                            type="checkbox"
                            checked={service.autoFallback}
                            onChange={(e) =>
                              handleToggleAutoFallback(service.serviceType, e.target.checked)
                            }
                            className="rounded accent-indigo-500 cursor-pointer"
                          />
                          <span className="flex items-center gap-1">
                            <ShieldCheck className="w-3 h-3 text-indigo-400" />
                            <span>Tự cứu hộ khi lỗi/rate-limit</span>
                          </span>
                        </label>
                      </div>
                    </td>

                    {/* Cột 4: Chi Tiết Endpoint / Model */}
                    <td className="py-4 px-4 align-top">
                      {activeEngine ? (
                        <div className="space-y-1 text-xs">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-indigo-300">
                              {activeEngine.protocol}
                            </span>
                            <span className="font-mono text-cyan-300 font-medium truncate max-w-[180px]">
                              {activeEngine.model}
                            </span>
                          </div>
                          {activeEngine.baseUrl && (
                            <div className="font-mono text-[10px] text-slate-500 truncate max-w-[220px]">
                              {activeEngine.baseUrl}
                            </div>
                          )}
                          <div className="text-[11px] text-slate-400 truncate">
                            {activeEngine.statusMessage || 'Sẵn sàng xử lý request'}
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-600 italic">Chưa chọn engine</span>
                      )}
                    </td>

                    {/* Cột 5: Hành Động */}
                    <td className="py-4 px-4 align-top text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {activeEngine && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingEngine(activeEngine);
                              setIsModalOpen(true);
                            }}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition cursor-pointer"
                            title="Tùy chỉnh thông số Engine"
                          >
                            <Settings className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* DANH SÁCH CHI TIẾT TẤT CẢ CÁC ENGINE NODE HIỆN CÓ */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-indigo-400" />
            <span>Kho Lưu Trữ & Quản Lý Động Cơ (Engine Nodes Pool)</span>
          </h4>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {matrix
            .flatMap((s) => s.availableEngines)
            .map((eng) => (
              <div
                key={eng.id}
                className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 hover:border-slate-700 transition flex flex-col justify-between space-y-2"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="font-bold text-xs text-white truncate" title={eng.name}>
                      {eng.name}
                    </span>
                    {eng.isCustom ? (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                        CUSTOM
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-mono text-slate-400 bg-slate-800">
                        BUILTIN
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 text-[11px] font-mono text-cyan-300">
                    <span className="text-slate-500">Model:</span>
                    <span className="truncate">{eng.model}</span>
                  </div>

                  {eng.baseUrl && (
                    <div className="text-[10px] font-mono text-slate-500 truncate mt-0.5">
                      {eng.baseUrl}
                    </div>
                  )}

                  <div className="text-[11px] text-slate-400 mt-1 line-clamp-1">
                    {eng.statusMessage || 'Đã tích hợp vào hệ thống'}
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
                  <span className="text-[10px] font-mono text-slate-500 uppercase">
                    {eng.protocol}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingEngine(eng);
                      setIsModalOpen(true);
                    }}
                    className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 cursor-pointer flex items-center gap-1 transition"
                  >
                    <Settings className="w-3 h-3" />
                    <span>Tùy chỉnh</span>
                  </button>
                </div>
              </div>
            ))}
        </div>
      </div>

      {/* Modal Tùy Chỉnh Engine */}
      <EngineConfigModal
        engine={editingEngine}
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingEngine(null);
        }}
        onSave={handleSaveEngineConfig}
        onDelete={handleDeleteEngine}
      />
    </div>
  );
};
