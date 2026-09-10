import React, { useState } from 'react';
import {
  Film,
  FolderKanban,
  Download,
  ListPlus,
  Settings,
  Activity,
  Layers,
  ChevronLeft,
  ChevronRight,
  Smartphone,
} from 'lucide-react';

export type AppViewMode = 'dashboard' | 'downloader' | 'queue' | 'settings' | 'admin' | 'studio';

interface AppSidebarProps {
  currentView: AppViewMode;
  onNavigate: (view: AppViewMode, tab?: string) => void;
  hasActiveProject?: boolean;
  activeProjectTitle?: string;
  isBackendOnline?: boolean;
}

export const AppSidebar: React.FC<AppSidebarProps> = ({
  currentView,
  onNavigate,
  hasActiveProject = false,
  activeProjectTitle,
  isBackendOnline = true,
}) => {
  // Trạng thái thu gọn (Mini 64px) hoặc mở rộng (Full 240px)
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    const saved = localStorage.getItem('sls_sidebar_collapsed');
    return saved !== null ? saved === 'true' : true; // Mặc định thu gọn theo thỏa thuận
  });

  const toggleCollapsed = () => {
    setIsCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('sls_sidebar_collapsed', String(next));
      return next;
    });
  };

  const navItems = [
    {
      id: 'dashboard' as AppViewMode,
      label: 'Dự Án / Tập Phim',
      shortLabel: 'Dự án',
      icon: FolderKanban,
      color: 'text-indigo-400',
      activeBg: 'bg-indigo-600/20 text-indigo-300 border-indigo-500/60 shadow-indigo-950/40',
    },
    {
      id: 'downloader' as AppViewMode,
      label: 'Tải Video Online',
      shortLabel: 'Tải video',
      icon: Download,
      color: 'text-emerald-400',
      activeBg: 'bg-emerald-600/20 text-emerald-300 border-emerald-500/60 shadow-emerald-950/40',
    },
    {
      id: 'queue' as AppViewMode,
      label: 'Hàng Đợi Tải Phim',
      shortLabel: 'Hàng đợi',
      icon: ListPlus,
      color: 'text-cyan-400',
      activeBg: 'bg-cyan-600/20 text-cyan-300 border-cyan-500/60 shadow-cyan-950/40',
    },
    {
      id: 'settings' as AppViewMode,
      label: 'Thiết Lập Hệ Thống',
      shortLabel: 'Thiết lập',
      icon: Settings,
      color: 'text-amber-400',
      activeBg: 'bg-amber-600/20 text-amber-300 border-amber-500/60 shadow-amber-950/40',
    },
    {
      id: 'admin' as AppViewMode,
      label: 'Admin Worker LAN',
      shortLabel: 'Admin LAN',
      icon: Activity,
      color: 'text-rose-400',
      activeBg: 'bg-rose-600/20 text-rose-300 border-rose-500/60 shadow-rose-950/40',
    },
  ];

  return (
    <aside
      className={`h-screen shrink-0 bg-slate-950/95 border-r border-slate-800/80 flex flex-col justify-between transition-all duration-300 ease-in-out z-40 select-none shadow-xl ${
        isCollapsed ? 'w-16' : 'w-60'
      }`}
    >
      {/* 1. Header Đỉnh: Logo Studio & Nút Toggle Thu/Phóng */}
      <div className="h-14 border-b border-slate-800/80 flex items-center px-3 justify-between">
        <div
          onClick={() => onNavigate('dashboard')}
          className="flex items-center gap-2.5 cursor-pointer overflow-hidden group"
          title="Subtitle Localizer Studio"
        >
          <div className="p-2 bg-gradient-to-br from-indigo-600 to-indigo-800 rounded-xl text-white shadow-md shadow-indigo-600/30 shrink-0 group-hover:scale-105 transition-transform">
            <Film className="w-5 h-5" />
          </div>
          {!isCollapsed && (
            <div className="flex flex-col min-w-0 transition-opacity duration-200">
              <span className="font-bold text-xs text-white tracking-wide truncate">
                LOCALIZER STUDIO
              </span>
              <span className="text-[10px] text-slate-400 font-mono">v2.5 Pro Engine</span>
            </div>
          )}
        </div>

        {/* Nút Thu Gọn / Mở Rộng */}
        <button
          onClick={toggleCollapsed}
          className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 transition cursor-pointer shrink-0"
          title={isCollapsed ? 'Mở rộng thanh menu (240px)' : 'Thu gọn thanh menu (64px)'}
        >
          {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* 2. Menu Điều Hướng Chính */}
      <div className="flex-1 py-3 px-2 space-y-1.5 overflow-y-auto no-scrollbar">
        {navItems.map((item) => {
          const isActive = currentView === item.id;
          const IconComponent = item.icon;

          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              title={isCollapsed ? item.label : undefined}
              className={`w-full flex items-center rounded-xl transition-all duration-200 cursor-pointer border ${
                isCollapsed
                  ? 'h-11 justify-center px-0'
                  : 'h-11 px-3 gap-3 justify-start'
              } ${
                isActive
                  ? `${item.activeBg} border-l-4 shadow-sm`
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/80'
              }`}
            >
              <IconComponent
                className={`w-5 h-5 shrink-0 ${
                  isActive ? 'text-white scale-105' : item.color
                } transition-transform`}
              />
              {!isCollapsed && (
                <span className={`text-xs font-semibold truncate ${isActive ? 'text-white' : ''}`}>
                  {item.label}
                </span>
              )}
            </button>
          );
        })}

        {/* Phân cách */}
        <div className="my-2 border-t border-slate-800/60 mx-1" />

        {/* Mục Phụ: Vào Studio Biên Tập (Nếu có dự án hoặc đang trong studio) */}
        <button
          onClick={() => onNavigate('studio')}
          disabled={!hasActiveProject && currentView !== 'studio'}
          title={
            isCollapsed
              ? hasActiveProject
                ? `Vào Studio (${activeProjectTitle || 'Đang mở'})`
                : 'Chưa chọn dự án nào'
              : undefined
          }
          className={`w-full flex items-center rounded-xl transition-all duration-200 cursor-pointer border ${
            isCollapsed
              ? 'h-11 justify-center px-0'
              : 'h-11 px-3 gap-3 justify-start'
          } ${
            currentView === 'studio'
              ? 'bg-purple-600/20 text-purple-300 border-purple-500/60 shadow-sm border-l-4'
              : hasActiveProject
              ? 'border-transparent text-slate-300 hover:text-purple-200 hover:bg-purple-950/30'
              : 'border-transparent text-slate-600 opacity-40 cursor-not-allowed'
          }`}
        >
          <Layers className={`w-5 h-5 shrink-0 ${currentView === 'studio' ? 'text-white' : 'text-purple-400'}`} />
          {!isCollapsed && (
            <div className="flex flex-col text-left min-w-0">
              <span className="text-xs font-semibold truncate">Vào Studio</span>
              <span className="text-[10px] text-slate-500 truncate max-w-[140px]">
                {activeProjectTitle || (hasActiveProject ? 'Dự án đã chọn' : 'Chưa chọn dự án')}
              </span>
            </div>
          )}
        </button>

        {/* Phím tắt nhanh vào Thiết bị & Proxy trong Settings */}
        <button
          onClick={() => onNavigate('settings', 'device')}
          title={isCollapsed ? 'Cấu hình Thiết bị & Proxy' : undefined}
          className={`w-full flex items-center rounded-xl transition-all duration-200 cursor-pointer border ${
            isCollapsed
              ? 'h-11 justify-center px-0'
              : 'h-11 px-3 gap-3 justify-start'
          } border-transparent text-slate-400 hover:text-emerald-300 hover:bg-emerald-950/20`}
        >
          <Smartphone className="w-5 h-5 shrink-0 text-emerald-400" />
          {!isCollapsed && (
            <span className="text-xs font-semibold truncate text-slate-300 hover:text-emerald-300">
              Thiết Bị & Proxy
            </span>
          )}
        </button>
      </div>

      {/* 3. Footer Đáy Sidebar: Trạng Thái Backend Engine */}
      <div className="p-2 border-t border-slate-800/80 bg-slate-950">
        <div
          className={`flex items-center rounded-xl p-2 bg-slate-900/60 border border-slate-800/60 ${
            isCollapsed ? 'justify-center' : 'gap-2.5 justify-between'
          }`}
          title={isBackendOnline ? 'Hệ thống Engine hoạt động bình thường' : 'Engine ngoại tuyến hoặc đang khởi động'}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                isBackendOnline ? 'bg-emerald-400 shadow-sm shadow-emerald-500 animate-pulse' : 'bg-rose-500'
              }`}
            />
            {!isCollapsed && (
              <div className="flex flex-col min-w-0">
                <span className="text-[11px] font-bold text-slate-200">
                  {isBackendOnline ? 'Engine Online' : 'Mất kết nối'}
                </span>
                <span className="text-[9px] text-slate-500 font-mono">127.0.0.1:5000</span>
              </div>
            )}
          </div>
          {!isCollapsed && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-800/50">
              LAN READY
            </span>
          )}
        </div>
      </div>
    </aside>
  );
};
