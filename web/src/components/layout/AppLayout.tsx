import React, { useEffect, useState } from 'react';
import { apiClient } from '../../api/client';
import { Sparkles, Key, Check, X, ExternalLink } from 'lucide-react';

interface AppLayoutProps {
  children: React.ReactNode;
  activeProjectTitle?: string;
  onBackToProjects?: () => void;
}

export const AppLayout: React.FC<AppLayoutProps> = ({
  children,
  activeProjectTitle,
  onBackToProjects,
}) => {
  const [backendOnline, setBackendOnline] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [geminiKey, setGeminiKey] = useState<string>('');
  const [geminiConfigured, setGeminiConfigured] = useState<boolean>(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  useEffect(() => {
    const check = async () => {
      const ok = await apiClient.healthCheck();
      setBackendOnline(ok);
    };
    check();
    const interval = setInterval(check, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const loadStatus = async () => {
      const status = await apiClient.getGeminiStatus();
      setGeminiConfigured(status.configured);
      if (status.masked_key) setGeminiKey(status.masked_key);
    };
    loadStatus();
  }, [isSettingsOpen]);

  const handleSaveGeminiKey = async () => {
    try {
      const ok = await apiClient.setGeminiKey(geminiKey);
      if (ok) {
        setGeminiConfigured(Boolean(geminiKey.trim()));
        setSaveStatus('✓ Đã lưu cấu hình AI thành công!');
        setTimeout(() => setSaveStatus(null), 3000);
      }
    } catch (err: any) {
      setSaveStatus(`Lỗi lưu: ${err.message}`);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100 antialiased font-sans">
      {/* Top Navigation Bar */}
      <header className="h-14 border-b border-zinc-800 bg-zinc-900/60 backdrop-blur px-6 flex items-center justify-between select-none">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 cursor-pointer" onClick={onBackToProjects}>
            <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/20">
              S
            </div>
            <span className="font-semibold tracking-tight text-zinc-100">Subtitle Localizer Studio</span>
          </div>

          {activeProjectTitle && (
            <div className="flex items-center gap-2 text-sm text-zinc-400 border-l border-zinc-800 pl-4">
              <span>/</span>
              <span className="text-zinc-200 font-medium truncate max-w-xs">{activeProjectTitle}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 text-xs font-mono">
          {/* AI Settings Button */}
          <button
            onClick={() => setIsSettingsOpen(true)}
            className={`px-3 py-1.5 rounded-lg border text-xs font-sans font-medium flex items-center gap-1.5 transition-all ${
              geminiConfigured
                ? 'bg-indigo-950/80 border-indigo-700 text-indigo-200 shadow-sm shadow-indigo-900/30'
                : 'bg-zinc-800/80 border-zinc-700 hover:border-zinc-600 text-zinc-300'
            }`}
            title="Cài đặt mô hình AI dịch thuật ngữ cảnh cao cấp"
          >
            <Sparkles className={`w-3.5 h-3.5 ${geminiConfigured ? 'text-amber-400 animate-pulse' : 'text-zinc-400'}`} />
            <span>{geminiConfigured ? 'Gemini AI: BẬT' : 'Cài Đặt AI Dịch'}</span>
          </button>

          <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-zinc-800/80 border border-zinc-700/50">
            <span className={`w-2 h-2 rounded-full ${backendOnline ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
            <span className="text-zinc-300">{backendOnline ? 'BACKEND 127.0.0.1:8899' : 'OFFLINE'}</span>
          </div>
          <div className="px-2 py-1 rounded bg-zinc-800/50 text-zinc-400 border border-zinc-800">
            v0.1.0
          </div>
        </div>
      </header>

      {/* Gemini AI Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl shadow-black/80">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-zinc-100">Cấu Hình Dịch Thuật AI Chuẩn Điện Ảnh</h3>
                  <p className="text-[11px] text-zinc-400">Giải quyết triệt để lỗi ngữ nghĩa và bối cảnh hội thoại</p>
                </div>
              </div>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="text-zinc-500 hover:text-zinc-300 p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-zinc-950/80 border border-zinc-800 space-y-2">
                <div className="flex items-center justify-between font-medium">
                  <span className="text-zinc-300">Trạng thái hiện tại:</span>
                  {geminiConfigured ? (
                    <span className="text-emerald-400 flex items-center gap-1 font-semibold">
                      <Check className="w-3.5 h-3.5" /> Gemini 2.5 Flash (Bật)
                    </span>
                  ) : (
                    <span className="text-amber-400">Google Ngữ Cảnh Nâng Cấp (Free)</span>
                  )}
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Dịch thuật AI theo bối cảnh hội thoại, chuẩn xưng hô và nhịp điệu phụ đề.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-zinc-300 font-medium flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Google Gemini API Key (Miễn phí 15 RPM):</span>
                </label>
                <input
                  type="password"
                  value={geminiKey}
                  onChange={(e) => setGeminiKey(e.target.value)}
                  placeholder="Dán mã AIzaSy... vào đây"
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded-xl px-3.5 py-2.5 text-xs text-zinc-100 font-mono focus:outline-none transition-colors"
                />
                <div className="flex items-center justify-between text-[11px] text-zinc-500 pt-1">
                  <span>Khóa được lưu cục bộ trên máy</span>
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noreferrer"
                    className="text-indigo-400 hover:text-indigo-300 flex items-center gap-1 underline"
                  >
                    <span>Lấy API Key Miễn Phí</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>

              {saveStatus && (
                <div className="p-2.5 rounded-lg bg-indigo-950/60 border border-indigo-800/80 text-indigo-300 text-center font-medium animate-pulse text-xs">
                  {saveStatus}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-zinc-800">
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition-colors"
              >
                Đóng
              </button>
              <button
                onClick={handleSaveGeminiKey}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/30 transition-all flex items-center gap-1.5"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Lưu Cấu Hình</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Studio Content Body */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {children}
      </main>
    </div>
  );
};
