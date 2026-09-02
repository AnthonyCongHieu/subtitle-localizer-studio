import React, { useEffect, useState } from 'react';
import { apiClient } from '../../api/client';

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

  useEffect(() => {
    const check = async () => {
      const ok = await apiClient.healthCheck();
      setBackendOnline(ok);
    };
    check();
    const interval = setInterval(check, 5000);
    return () => clearInterval(interval);
  }, []);

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

        <div className="flex items-center gap-4 text-xs font-mono">
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-zinc-800/80 border border-zinc-700/50">
            <span className={`w-2 h-2 rounded-full ${backendOnline ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
            <span className="text-zinc-300">{backendOnline ? 'BACKEND 127.0.0.1:8899' : 'OFFLINE'}</span>
          </div>
          <div className="px-2 py-1 rounded bg-zinc-800/50 text-zinc-400 border border-zinc-800">
            v0.1.0
          </div>
        </div>
      </header>

      {/* Main Studio Content Body */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {children}
      </main>
    </div>
  );
};
