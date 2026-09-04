import React, { useState, useEffect, useMemo } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Info,
  X,
  Copy,
  Trash2,
  Activity,
  Check,
  Clock,
} from 'lucide-react';

export type LogLevel = 'info' | 'success' | 'warning' | 'error';

export interface ActivityLogItem {
  id: string;
  time: string;
  level: LogLevel;
  message: string;
  category?: string;
}

export interface ToastItem {
  id: string;
  type: LogLevel;
  message: string;
  duration?: number;
}

type LoggerListener = (item: ActivityLogItem, showToast: boolean) => void;
class AppLoggerService {
  private listeners: Set<LoggerListener> = new Set();
  private logs: ActivityLogItem[] = [];

  subscribe(listener: LoggerListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  log(message: string, level: LogLevel = 'info', category: string = 'Hệ thống', showToast = true) {
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];
    const item: ActivityLogItem = {
      id: 'log_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      time: timeStr,
      level,
      message,
      category,
    };
    this.logs.unshift(item);
    if (this.logs.length > 200) this.logs.pop();

    this.listeners.forEach((fn) => fn(item, showToast));
  }

  success(message: string, category = 'Thành công', showToast = true) {
    this.log(message, 'success', category, showToast);
  }

  info(message: string, category = 'Thông tin', showToast = true) {
    this.log(message, 'info', category, showToast);
  }

  warn(message: string, category = 'Cảnh báo', showToast = true) {
    this.log(message, 'warning', category, showToast);
  }

  error(message: string, category = 'Lỗi', showToast = true) {
    this.log(message, 'error', category, showToast);
  }

  getRecentLogs(): ActivityLogItem[] {
    return [...this.logs];
  }

  clearLogs() {
    this.logs = [];
  }
}

export const appLogger = new AppLoggerService();

export const GlobalActivityLogger: React.FC = () => {
  const [logs, setLogs] = useState<ActivityLogItem[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [filterLevel, setFilterLevel] = useState<'all' | LogLevel>('all');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    return appLogger.subscribe((newItem, showToast) => {
      setLogs((prev) => [newItem, ...prev.slice(0, 199)]);

      if (showToast) {
        const toastId = 'toast_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        const duration = newItem.level === 'error' ? 5500 : 3500;

        setToasts((prev) => [...prev.slice(-3), { id: toastId, type: newItem.level, message: newItem.message }]);

        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== toastId));
        }, duration);
      }
    });
  }, []);

  const handleDismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const handleCopyLogs = () => {
    const text = logs
      .map((l) => '[' + l.time + '] [' + l.level.toUpperCase() + '] [' + (l.category || 'App') + '] ' + l.message)
      .join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleClear = () => {
    appLogger.clearLogs();
    setLogs([]);
  };

  const filteredLogs = useMemo(() => {
    if (filterLevel === 'all') return logs;
    return logs.filter((l) => l.level === filterLevel);
  }, [logs, filterLevel]);

  return (
    <>
      {/* 1. TOAST NOTIFICATION STACK */}
      <div className='fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none max-w-sm w-full'>
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={'pointer-events-auto flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl border shadow-2xl backdrop-blur-md text-xs transition-all duration-200 animate-in slide-in-from-bottom-3 ' + (
              toast.type === 'success'
                ? 'bg-emerald-950/90 border-emerald-700/60 text-emerald-100 shadow-emerald-950/40'
                : toast.type === 'error'
                ? 'bg-rose-950/95 border-rose-700/80 text-rose-100 shadow-rose-950/50'
                : toast.type === 'warning'
                ? 'bg-amber-950/90 border-amber-700/60 text-amber-100 shadow-amber-950/40'
                : 'bg-slate-900/90 border-slate-700/70 text-slate-100 shadow-slate-950/50'
            )}
          >
            {toast.type === 'success' && <CheckCircle2 className='w-4 h-4 text-emerald-400 shrink-0 mt-0.5' />}
            {toast.type === 'error' && <AlertCircle className='w-4 h-4 text-rose-400 shrink-0 mt-0.5' />}
            {toast.type === 'warning' && <AlertTriangle className='w-4 h-4 text-amber-400 shrink-0 mt-0.5' />}
            {toast.type === 'info' && <Info className='w-4 h-4 text-cyan-400 shrink-0 mt-0.5' />}

            <div className='flex-1 min-w-0 font-medium leading-relaxed break-words'>{toast.message}</div>

            <button
              onClick={() => handleDismissToast(toast.id)}
              className='text-slate-400 hover:text-white p-0.5 rounded transition shrink-0 ml-1'
            >
              <X className='w-3.5 h-3.5' />
            </button>
          </div>
        ))}
      </div>

      {/* 2. NÚT MỞ NHẬT KÝ HOẠT ĐỘNG */}
      <button
        type='button'
        onClick={() => setIsOpen(!isOpen)}
        className={'fixed bottom-3 left-3 z-40 px-2.5 py-1 rounded-lg border text-[11px] font-mono flex items-center gap-1.5 backdrop-blur transition shadow-lg ' + (
          isOpen
            ? 'bg-indigo-600 text-white border-indigo-400 shadow-indigo-600/30'
            : 'bg-slate-900/85 hover:bg-slate-800 text-slate-300 border-slate-700/80'
        )}
        title='Mở Nhật Ký Hoạt Động Toàn Cục (Logs & Notifications)'
      >
        <Activity className={'w-3.5 h-3.5 ' + (logs.length > 0 ? 'text-cyan-400 animate-pulse' : 'text-slate-400')} />
        <span>Nhật ký</span>
        {logs.length > 0 && (
          <span className='px-1.5 py-0.2 rounded-full bg-slate-800 text-[10px] text-cyan-300 border border-slate-700'>
            {logs.length}
          </span>
        )}
      </button>

      {/* 3. BẢNG NHẬT KÝ HOẠT ĐỘNG (DRAWER) */}
      {isOpen && (
        <div className='fixed bottom-12 left-3 z-50 w-96 max-w-[calc(100vw-24px)] max-h-[420px] bg-slate-900/95 border border-slate-800 rounded-xl shadow-2xl backdrop-blur-xl flex flex-col overflow-hidden text-xs animate-in slide-in-from-bottom-4'>
          <div className='h-9 px-3 border-b border-slate-800 flex items-center justify-between bg-slate-950/60 shrink-0'>
            <div className='flex items-center gap-1.5 font-semibold text-slate-200'>
              <Activity className='w-3.5 h-3.5 text-cyan-400' />
              <span>Nhật Ký Hoạt Động Toàn Cục</span>
            </div>

            <div className='flex items-center gap-1'>
              <button
                onClick={handleCopyLogs}
                className='p-1 text-slate-400 hover:text-cyan-300 rounded transition'
                title='Sao chép toàn bộ log'
              >
                {copied ? <Check className='w-3.5 h-3.5 text-emerald-400' /> : <Copy className='w-3.5 h-3.5' />}
              </button>
              <button
                onClick={handleClear}
                className='p-1 text-slate-400 hover:text-rose-400 rounded transition'
                title='Xóa lịch sử log'
              >
                <Trash2 className='w-3.5 h-3.5' />
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className='p-1 text-slate-400 hover:text-white rounded transition ml-1'
                title='Đóng'
              >
                <X className='w-3.5 h-3.5' />
              </button>
            </div>
          </div>

          <div className='px-3 py-1.5 border-b border-slate-800 flex items-center gap-1 bg-slate-950/30 text-[10px] shrink-0'>
            {(['all', 'info', 'success', 'warning', 'error'] as const).map((lvl) => (
              <button
                key={lvl}
                onClick={() => setFilterLevel(lvl)}
                className={'px-2 py-0.5 rounded capitalize transition ' + (
                  filterLevel === lvl
                    ? 'bg-indigo-600 text-white font-medium'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                )}
              >
                {lvl === 'all' ? 'Tất cả' : lvl}
              </button>
            ))}
          </div>

          <div className='flex-1 overflow-y-auto p-2 space-y-1.5 font-mono text-[11px] min-h-[160px]'>
            {filteredLogs.length === 0 ? (
              <div className='h-32 flex flex-col items-center justify-center text-slate-500 text-center'>
                <Clock className='w-5 h-5 mb-1 opacity-50' />
                <span>Chưa có hoạt động nào được ghi lại</span>
              </div>
            ) : (
              filteredLogs.map((log) => (
                <div
                  key={log.id}
                  className={'p-1.5 rounded border flex items-start gap-1.5 leading-snug ' + (
                    log.level === 'success'
                      ? 'bg-emerald-950/30 border-emerald-900/40 text-emerald-300'
                      : log.level === 'error'
                      ? 'bg-rose-950/40 border-rose-900/50 text-rose-300'
                      : log.level === 'warning'
                      ? 'bg-amber-950/30 border-amber-900/40 text-amber-300'
                      : 'bg-slate-950/40 border-slate-800 text-slate-300'
                  )}
                >
                  <span className='text-[10px] text-slate-500 shrink-0 mt-0.5'>{log.time}</span>
                  {log.category && (
                    <span className='px-1 py-0.2 rounded bg-slate-900 text-slate-400 border border-slate-800 text-[9px] shrink-0'>
                      {log.category}
                    </span>
                  )}
                  <span className='flex-1 break-words'>{log.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
};
