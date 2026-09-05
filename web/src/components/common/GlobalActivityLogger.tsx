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
type OpenListener = (isOpen: boolean) => void;
type CountListener = (count: number) => void;

class AppLoggerService {
  private listeners: Set<LoggerListener> = new Set();
  private openListeners: Set<OpenListener> = new Set();
  private countListeners: Set<CountListener> = new Set();
  private logs: ActivityLogItem[] = [];
  private _isOpen: boolean = false;

  subscribe(listener: LoggerListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeOpen(listener: OpenListener) {
    this.openListeners.add(listener);
    listener(this._isOpen);
    return () => {
      this.openListeners.delete(listener);
    };
  }

  subscribeCount(listener: CountListener) {
    this.countListeners.add(listener);
    listener(this.logs.length);
    return () => {
      this.countListeners.delete(listener);
    };
  }

  isOpen(): boolean {
    return this._isOpen;
  }

  setOpen(open: boolean) {
    this._isOpen = open;
    this.openListeners.forEach((fn) => {
      try {
        fn(open);
      } catch (e) {
        console.error('Lỗi listener open:', e);
      }
    });
  }

  toggle() {
    this.setOpen(!this._isOpen);
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

    const notify = () => {
      this.listeners.forEach((fn) => {
        try {
          fn(item, showToast);
        } catch (e) {
          console.error('Lỗi listener logger:', e);
        }
      });
      this.countListeners.forEach((fn) => {
        try {
          fn(this.logs.length);
        } catch (e) {
          console.error('Lỗi listener count:', e);
        }
      });
    };

    if (typeof queueMicrotask === 'function') {
      queueMicrotask(notify);
    } else {
      setTimeout(notify, 0);
    }
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
    this.countListeners.forEach((fn) => {
      try {
        fn(0);
      } catch (e) {
        console.error('Lỗi listener count:', e);
      }
    });
  }
}

export const appLogger = new AppLoggerService();

export function useAppLoggerCount(): number {
  const [count, setCount] = useState<number>(0);
  useEffect(() => {
    return appLogger.subscribeCount((cnt) => setCount(cnt));
  }, []);
  return count;
}

export const GlobalActivityLogger: React.FC = () => {
  const [logs, setLogs] = useState<ActivityLogItem[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [filterLevel, setFilterLevel] = useState<'all' | LogLevel>('all');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const unsubLog = appLogger.subscribe((newItem, showToast) => {
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

    const unsubOpen = appLogger.subscribeOpen((open) => {
      setIsOpen(open);
    });

    return () => {
      unsubLog();
      unsubOpen();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
        appLogger.setOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

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
      {/* 1. Toasts positioned at top-14 right-4 so they NEVER cover bottom toolbar/timeline */}
      <div className='fixed top-14 right-4 z-50 flex flex-col gap-2 pointer-events-none max-w-sm w-full'>
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={
              'pointer-events-auto px-3.5 py-2.5 rounded-xl border text-xs shadow-2xl backdrop-blur-md flex items-start gap-2.5 animate-in slide-in-from-right-3 duration-200 ' +
              (toast.type === 'success'
                ? 'bg-emerald-950/90 border-emerald-700/60 text-emerald-100 shadow-emerald-950/40'
                : toast.type === 'error'
                ? 'bg-rose-950/90 border-rose-700/60 text-rose-100 shadow-rose-950/40'
                : toast.type === 'warning'
                ? 'bg-amber-950/90 border-amber-700/60 text-amber-100 shadow-amber-950/40'
                : 'bg-slate-900/90 border-slate-700/70 text-slate-100 shadow-slate-950/50')
            }
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

      {/* 2. Slide-over drawer on the right side - Clean, desktop style */}
      {isOpen && (
        <>
          <div
            className='fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] transition-opacity animate-in fade-in duration-150'
            onClick={() => {
              setIsOpen(false);
              appLogger.setOpen(false);
            }}
          />

          <div className='fixed top-0 right-0 h-full w-96 max-w-[calc(100vw-2rem)] z-50 bg-slate-900/98 border-l border-slate-800 shadow-2xl backdrop-blur-xl flex flex-col overflow-hidden text-xs animate-in slide-in-from-right duration-200'>
            <div className='h-12 px-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/70 shrink-0'>
              <div className='flex items-center gap-2 font-semibold text-slate-200'>
                <Activity className='w-4 h-4 text-cyan-400' />
                <span>Nhật ký hoạt động</span>
                {logs.length > 0 && (
                  <span className='px-1.5 py-0.2 rounded-full bg-slate-800 text-[10px] text-cyan-300 border border-slate-700 font-mono'>
                    {logs.length}
                  </span>
                )}
              </div>

              <div className='flex items-center gap-1.5'>
                <button
                  onClick={handleCopyLogs}
                  className='p-1.5 text-slate-400 hover:text-cyan-300 rounded-md hover:bg-slate-800 transition'
                  title='Sao chép toàn bộ log'
                >
                  {copied ? <Check className='w-3.5 h-3.5 text-emerald-400' /> : <Copy className='w-3.5 h-3.5' />}
                </button>
                <button
                  onClick={handleClear}
                  className='p-1.5 text-slate-400 hover:text-rose-400 rounded-md hover:bg-slate-800 transition'
                  title='Xóa lịch sử log'
                >
                  <Trash2 className='w-3.5 h-3.5' />
                </button>
                <button
                  onClick={() => {
                    setIsOpen(false);
                    appLogger.setOpen(false);
                  }}
                  className='p-1.5 text-slate-400 hover:text-white rounded-md hover:bg-slate-800 transition'
                  title='Đóng'
                >
                  <X className='w-4 h-4' />
                </button>
              </div>
            </div>

            <div className='px-3 py-2 border-b border-slate-800 flex items-center gap-1 bg-slate-950/40 text-[11px] shrink-0'>
              {(
                [
                  { key: 'all', label: 'Tất cả' },
                  { key: 'info', label: 'Thông tin' },
                  { key: 'success', label: 'Thành công' },
                  { key: 'warning', label: 'Cảnh báo' },
                  { key: 'error', label: 'Lỗi' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setFilterLevel(tab.key)}
                  className={
                    'px-2.5 py-1 rounded-md transition font-medium text-[10px] ' +
                    (filterLevel === tab.key
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/80')
                  }
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className='flex-1 overflow-y-auto p-3 space-y-2 font-mono text-[11px]'>
              {filteredLogs.length === 0 ? (
                <div className='h-40 flex flex-col items-center justify-center text-slate-500 text-center'>
                  <Clock className='w-5 h-5 mb-1.5 opacity-40' />
                  <span className='font-sans text-xs'>Chưa có hoạt động nào được ghi lại</span>
                </div>
              ) : (
                filteredLogs.map((log) => (
                  <div
                    key={log.id}
                    className={
                      'p-2 rounded-lg border flex items-start gap-2 leading-relaxed ' +
                      (log.level === 'success'
                        ? 'bg-emerald-950/20 border-emerald-900/40 text-emerald-300'
                        : log.level === 'error'
                        ? 'bg-rose-950/30 border-rose-900/50 text-rose-300'
                        : log.level === 'warning'
                        ? 'bg-amber-950/20 border-amber-900/40 text-amber-300'
                        : 'bg-slate-950/50 border-slate-800 text-slate-300')
                    }
                  >
                    <span className='text-[10px] text-slate-500 shrink-0 mt-0.5'>{log.time}</span>
                    {log.category && (
                      <span className='px-1.5 py-0.2 rounded bg-slate-900 text-slate-400 border border-slate-800 text-[9px] shrink-0 font-sans font-medium'>
                        {log.category}
                      </span>
                    )}
                    <span className='flex-1 break-words font-sans text-xs'>{log.message}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
};
