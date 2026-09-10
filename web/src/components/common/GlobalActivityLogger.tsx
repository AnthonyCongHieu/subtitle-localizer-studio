import React, { useState, useEffect, useMemo } from 'react';
import {
  AlertCircle,
  X,
  Copy,
  Trash2,
  Activity,
  Check,
  Clock,
  Loader2,
  Search,
  ChevronDown,
} from 'lucide-react';

export type LogLevel = 'info' | 'success' | 'warning' | 'error' | 'loading';

export interface LogOptions {
  category?: string;
  taskKey?: string;
  showToast?: boolean;
  progress?: number; // 0..100
  duration?: number; // ms
  details?: string;
  saveToHistory?: boolean;
}

export interface ActivityLogItem {
  id: string;
  time: string;
  level: LogLevel;
  message: string;
  category: string;
  taskKey?: string;
  progress?: number;
  details?: string;
  timestamp: number;
}

export interface ToastItem {
  id: string;
  taskKey?: string;
  type: LogLevel;
  message: string;
  category: string;
  progress?: number;
  duration: number;
  count: number;
  createdAt: number;
  details?: string;
}

export interface ActiveTaskItem {
  taskKey: string;
  message: string;
  category: string;
  progress?: number;
  startTime: number;
}

type LoggerListener = (item: ActivityLogItem, showToast: boolean) => void;
type ToastUpdateListener = (toasts: ToastItem[]) => void;
type OpenListener = (isOpen: boolean) => void;
type CountListener = (count: number) => void;
type ActiveTasksListener = (tasks: ActiveTaskItem[]) => void;

class AppLoggerService {
  private listeners: Set<LoggerListener> = new Set();
  private toastListeners: Set<ToastUpdateListener> = new Set();
  private openListeners: Set<OpenListener> = new Set();
  private countListeners: Set<CountListener> = new Set();
  private activeTasksListeners: Set<ActiveTasksListener> = new Set();

  private logs: ActivityLogItem[] = [];
  private toasts: ToastItem[] = [];
  private activeTasks: Map<string, ActiveTaskItem> = new Map();
  private _isOpen: boolean = false;

  // ---------------------------------------------
  // Subscriptions
  // ---------------------------------------------
  subscribe(listener: LoggerListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeToasts(listener: ToastUpdateListener) {
    this.toastListeners.add(listener);
    listener([...this.toasts]);
    return () => {
      this.toastListeners.delete(listener);
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

  subscribeActiveTasks(listener: ActiveTasksListener) {
    this.activeTasksListeners.add(listener);
    listener(Array.from(this.activeTasks.values()));
    return () => {
      this.activeTasksListeners.delete(listener);
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

  // ---------------------------------------------
  // Internal Helpers
  // ---------------------------------------------
  private parseArgs(
    rawMessage: string,
    categoryOrOptions?: string | LogOptions,
    maybeOptionsOrShowToast?: LogOptions | boolean
  ): { message: string; category: string; options: LogOptions } {
    let message = String(rawMessage || '');
    let category = 'Hệ thống';
    let options: LogOptions = {};

    if (typeof categoryOrOptions === 'string') {
      // Tự động chuẩn hóa nếu người dùng truyền nhầm thứ tự tham số (category, message)
      if (
        categoryOrOptions.length > message.length &&
        !message.includes(' ') &&
        categoryOrOptions.includes(' ')
      ) {
        category = message.charAt(0).toUpperCase() + message.slice(1);
        message = categoryOrOptions;
      } else {
        category = categoryOrOptions;
      }
      if (typeof maybeOptionsOrShowToast === 'boolean') {
        options.showToast = maybeOptionsOrShowToast;
      } else if (maybeOptionsOrShowToast && typeof maybeOptionsOrShowToast === 'object') {
        options = { ...maybeOptionsOrShowToast };
        if (options.category) category = options.category;
      }
    } else if (categoryOrOptions && typeof categoryOrOptions === 'object') {
      options = { ...categoryOrOptions };
      if (options.category) category = options.category;
      if (typeof maybeOptionsOrShowToast === 'boolean') {
        options.showToast = maybeOptionsOrShowToast;
      }
    }

    return { message, category, options };
  }

  private notifyStateChange() {
    const logCount = this.logs.length;
    this.countListeners.forEach((fn) => {
      try {
        fn(logCount);
      } catch (e) {
        console.error('Lỗi listener count:', e);
      }
    });
  }

  private notifyToasts() {
    const currentToasts = [...this.toasts];
    this.toastListeners.forEach((fn) => {
      try {
        fn(currentToasts);
      } catch (e) {
        console.error('Lỗi listener toasts:', e);
      }
    });
  }

  private notifyActiveTasks() {
    const tasks = Array.from(this.activeTasks.values());
    this.activeTasksListeners.forEach((fn) => {
      try {
        fn(tasks);
      } catch (e) {
        console.error('Lỗi listener active tasks:', e);
      }
    });
  }

  // ---------------------------------------------
  // Core Log Method
  // ---------------------------------------------
  log(
    rawMessage: string,
    level: LogLevel = 'info',
    categoryOrOptions?: string | LogOptions,
    maybeOptionsOrShowToast?: LogOptions | boolean
  ) {
    const { message, category, options } = this.parseArgs(rawMessage, categoryOrOptions, maybeOptionsOrShowToast);
    const showToast = options.showToast !== undefined ? options.showToast : level !== 'info';
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];
    const timestamp = Date.now();

    const item: ActivityLogItem = {
      id: 'log_' + timestamp + '_' + Math.random().toString(36).slice(2, 7),
      time: timeStr,
      level,
      message,
      category,
      taskKey: options.taskKey,
      progress: options.progress,
      details: options.details,
      timestamp,
    };

    // Quản lý Active Tasks
    if (options.taskKey) {
      if (level === 'loading') {
        this.activeTasks.set(options.taskKey, {
          taskKey: options.taskKey,
          message,
          category,
          progress: options.progress,
          startTime: timestamp,
        });
        this.notifyActiveTasks();
      } else {
        if (this.activeTasks.has(options.taskKey)) {
          this.activeTasks.delete(options.taskKey);
          this.notifyActiveTasks();
        }
      }
    }

    // Chống spam: Không ghi tiến trình % hoặc các update định kỳ vào lịch sử nhật ký (nhật ký chỉ ghi mốc sự kiện)
    const isProgressTick =
      options.saveToHistory === false ||
      (Boolean(options.taskKey) && (options.progress !== undefined || /\b\d{1,3}%\b/.test(message)));

    const isDuplicate =
      this.logs.length > 0 &&
      this.logs[0].message === message &&
      this.logs[0].level === level &&
      timestamp - this.logs[0].timestamp < 3000;

    if (!isProgressTick && !isDuplicate) {
      this.logs.unshift(item);
      if (this.logs.length > 300) this.logs.pop();

      // Phát sự kiện cho listeners
      this.listeners.forEach((fn) => {
        try {
          fn(item, showToast);
        } catch (e) {
          console.error('Lỗi listener logger:', e);
        }
      });
      this.notifyStateChange();
    }

    // Xử lý Toast nổi
    if (showToast) {
      this.pushToast({
        taskKey: options.taskKey,
        type: level,
        message,
        category,
        progress: options.progress,
        duration: options.duration || (level === 'error' ? 5000 : level === 'loading' ? 0 : 3200),
        details: options.details,
      });
    }
  }

  private pushToast(toastData: {
    taskKey?: string;
    type: LogLevel;
    message: string;
    category: string;
    progress?: number;
    duration: number;
    details?: string;
  }) {
    const now = Date.now();

    // 1. Nếu có taskKey: Cập nhật trực tiếp thẻ Toast tương ứng (không sinh thẻ mới)
    if (toastData.taskKey) {
      const existingIdx = this.toasts.findIndex((t) => t.taskKey === toastData.taskKey);
      if (existingIdx !== -1) {
        const updated = [...this.toasts];
        updated[existingIdx] = {
          ...updated[existingIdx],
          type: toastData.type,
          message: toastData.message,
          category: toastData.category,
          progress: toastData.progress,
          duration: toastData.duration,
          details: toastData.details,
          createdAt: now,
        };
        this.toasts = updated;
        this.notifyToasts();
        return;
      }
    }

    // 2. Chống spam trùng lặp (Anti-spam Debounce trong vòng 2.5s)
    const existingSame = this.toasts.find(
      (t) => t.message === toastData.message && t.type === toastData.type && !t.taskKey
    );
    if (existingSame) {
      existingSame.count = (existingSame.count || 1) + 1;
      existingSame.createdAt = now;
      existingSame.duration = toastData.duration;
      this.notifyToasts();
      return;
    }

    // 3. Thêm toast mới (giới hạn tối đa 3 toast nổi đồng thời)
    const newToast: ToastItem = {
      id: 'toast_' + now + '_' + Math.random().toString(36).slice(2, 6),
      taskKey: toastData.taskKey,
      type: toastData.type,
      message: toastData.message,
      category: toastData.category,
      progress: toastData.progress,
      duration: toastData.duration,
      count: 1,
      createdAt: now,
      details: toastData.details,
    };

    this.toasts = [newToast, ...this.toasts.slice(0, 2)];
    this.notifyToasts();
  }

  // ---------------------------------------------
  // Convenience Methods
  // ---------------------------------------------
  loading(message: string, categoryOrOptions?: string | LogOptions, extraOptions?: LogOptions) {
    let opts: LogOptions = {};
    if (typeof categoryOrOptions === 'string') {
      opts = { category: categoryOrOptions, ...(extraOptions || {}) };
    } else if (categoryOrOptions) {
      opts = { ...categoryOrOptions, ...(extraOptions || {}) };
    }
    opts.showToast = true;
    this.log(message, 'loading', opts);
  }

  success(message: string, categoryOrOptions?: string | LogOptions, optionsOrShowToast?: LogOptions | boolean) {
    let opts: LogOptions = {};
    if (typeof categoryOrOptions === 'string') {
      opts = typeof optionsOrShowToast === 'object' ? { category: categoryOrOptions, ...optionsOrShowToast } : { category: categoryOrOptions };
      if (typeof optionsOrShowToast === 'boolean') opts.showToast = optionsOrShowToast;
    } else if (categoryOrOptions) {
      opts = { ...categoryOrOptions };
    }
    this.log(message, 'success', opts);
  }

  info(message: string, categoryOrOptions?: string | LogOptions, optionsOrShowToast?: LogOptions | boolean) {
    let opts: LogOptions = {};
    if (typeof categoryOrOptions === 'string') {
      opts = typeof optionsOrShowToast === 'object' ? { category: categoryOrOptions, ...optionsOrShowToast } : { category: categoryOrOptions };
      if (typeof optionsOrShowToast === 'boolean') opts.showToast = optionsOrShowToast;
    } else if (categoryOrOptions) {
      opts = { ...categoryOrOptions };
    }
    this.log(message, 'info', opts);
  }

  warn(message: string, categoryOrOptions?: string | LogOptions, optionsOrShowToast?: LogOptions | boolean) {
    let opts: LogOptions = {};
    if (typeof categoryOrOptions === 'string') {
      opts = typeof optionsOrShowToast === 'object' ? { category: categoryOrOptions, ...optionsOrShowToast } : { category: categoryOrOptions };
      if (typeof optionsOrShowToast === 'boolean') opts.showToast = optionsOrShowToast;
    } else if (categoryOrOptions) {
      opts = { ...categoryOrOptions };
    }
    this.log(message, 'warning', opts);
  }

  error(message: string, categoryOrOptions?: string | LogOptions, optionsOrShowToast?: LogOptions | boolean) {
    let opts: LogOptions = {};
    if (typeof categoryOrOptions === 'string') {
      opts = typeof optionsOrShowToast === 'object' ? { category: categoryOrOptions, ...optionsOrShowToast } : { category: categoryOrOptions };
      if (typeof optionsOrShowToast === 'boolean') opts.showToast = optionsOrShowToast;
    } else if (categoryOrOptions) {
      opts = { ...categoryOrOptions };
    }
    this.log(message, 'error', opts);
  }

  updateTask(
    taskKey: string,
    updates: { message?: string; progress?: number; category?: string; level?: LogLevel; details?: string }
  ) {
    const existing = this.activeTasks.get(taskKey);
    const category = updates.category || existing?.category || 'Tác vụ';
    const message = updates.message || existing?.message || 'Đang xử lý...';
    const level = updates.level || 'loading';

    // Cập nhật Tác Vụ Đang Xử Lý (Active Tasks) hiển thị thanh tiến trình & % ở ngoài nhật ký
    this.activeTasks.set(taskKey, {
      taskKey,
      message,
      category,
      progress: updates.progress,
      startTime: existing?.startTime || Date.now(),
    });
    this.notifyActiveTasks();

    // Cập nhật thẻ Toast nổi tương ứng nếu có
    this.pushToast({
      taskKey,
      type: level,
      message,
      category,
      progress: updates.progress,
      duration: 0,
      details: updates.details,
    });
  }

  finishTask(
    taskKey: string,
    message: string,
    level: 'success' | 'error' | 'warning' | 'warn' = 'success',
    category?: string
  ) {
    const existing = this.activeTasks.get(taskKey);
    const cat = category || existing?.category || 'Hoàn tất';
    const normLevel: LogLevel = level === 'warn' ? 'warning' : level;

    // Xóa khỏi danh sách Active Tasks
    if (this.activeTasks.has(taskKey)) {
      this.activeTasks.delete(taskKey);
      this.notifyActiveTasks();
    }
    this.dismiss(taskKey);

    // Ghi sự kiện mốc hoàn thành vào nhật ký
    this.log(message, normLevel, {
      taskKey,
      category: cat,
      showToast: true,
      duration: normLevel === 'error' ? 5000 : 3200,
      saveToHistory: true,
    });
  }

  dismiss(toastIdOrTaskKey: string) {
    if (this.activeTasks.has(toastIdOrTaskKey)) {
      this.activeTasks.delete(toastIdOrTaskKey);
      this.notifyActiveTasks();
    }
    this.toasts = this.toasts.filter(
      (t) => t.id !== toastIdOrTaskKey && t.taskKey !== toastIdOrTaskKey
    );
    this.notifyToasts();
  }

  dismissAll() {
    this.toasts = [];
    this.notifyToasts();
  }

  getRecentLogs(): ActivityLogItem[] {
    return [...this.logs];
  }

  getActiveTasks(): ActiveTaskItem[] {
    return Array.from(this.activeTasks.values());
  }

  clearLogs() {
    this.logs = [];
    this.notifyStateChange();
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

export interface AppLoggerState {
  count: number;
  activeTasks: ActiveTaskItem[];
  hasActiveTasks: boolean;
  latestLevel?: LogLevel;
  hasError: boolean;
  isOpen: boolean;
  toggle: () => void;
  open: () => void;
  close: () => void;
}

export function useAppLoggerState(): AppLoggerState {
  const [count, setCount] = useState<number>(0);
  const [activeTasks, setActiveTasks] = useState<ActiveTaskItem[]>([]);
  const [latestLevel, setLatestLevel] = useState<LogLevel | undefined>();
  const [isOpen, setIsOpen] = useState<boolean>(false);

  useEffect(() => {
    const unsubCount = appLogger.subscribeCount(setCount);
    const unsubTasks = appLogger.subscribeActiveTasks(setActiveTasks);
    const unsubOpen = appLogger.subscribeOpen(setIsOpen);
    const unsubLog = appLogger.subscribe((item) => {
      setLatestLevel(item.level);
    });
    return () => {
      unsubCount();
      unsubTasks();
      unsubOpen();
      unsubLog();
    };
  }, []);

  return {
    count,
    activeTasks,
    hasActiveTasks: activeTasks.length > 0,
    latestLevel,
    hasError: latestLevel === 'error',
    isOpen,
    toggle: () => appLogger.toggle(),
    open: () => appLogger.setOpen(true),
    close: () => appLogger.setOpen(false),
  };
}

export const ActivityLogButton: React.FC<{
  className?: string;
  showText?: boolean;
}> = ({ className = '', showText = true }) => {
  const { count, hasActiveTasks, activeTasks, hasError, toggle } = useAppLoggerState();

  if (hasActiveTasks) {
    const taskMsg = activeTasks[0]?.message || 'Đang xử lý...';
    return (
      <button
        onClick={toggle}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-950/80 hover:bg-cyan-900 border border-cyan-500/60 text-cyan-200 text-xs font-medium transition cursor-pointer shadow-sm shadow-cyan-950/40 active:scale-95 animate-pulse ${className}`}
        title={`Nhật ký: Đang chạy "${taskMsg}" (Bấm để xem chi tiết)`}
      >
        <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin shrink-0" />
        {showText && <span className="hidden sm:inline text-[11px] font-semibold">Nhật ký</span>}
        <span className="px-1.5 py-0.2 rounded-full bg-cyan-900/90 text-[10px] text-cyan-100 border border-cyan-400 font-mono font-bold">
          {activeTasks.length}
        </span>
      </button>
    );
  }

  if (hasError) {
    return (
      <button
        onClick={toggle}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-950/80 hover:bg-rose-900 border border-rose-500/60 text-rose-200 text-xs font-medium transition cursor-pointer shadow-sm shadow-rose-950/40 active:scale-95 ${className}`}
        title="Nhật ký: Có thông báo lỗi mới (Bấm để xem chi tiết)"
      >
        <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0 animate-bounce" />
        {showText && <span className="hidden sm:inline text-[11px] font-semibold">Nhật ký</span>}
        <span className="px-1.5 py-0.2 rounded-full bg-rose-900/90 text-[10px] text-rose-100 border border-rose-400 font-mono font-bold">
          !
        </span>
      </button>
    );
  }

  return (
    <button
      onClick={toggle}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white text-xs font-medium transition cursor-pointer shadow-sm active:scale-95 ${className}`}
      title="Mở nhật ký hoạt động hệ thống"
    >
      <Activity className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
      {showText && <span className="hidden sm:inline text-[11px]">Nhật ký</span>}
      {count > 0 && (
        <span className="px-1.5 py-0.2 rounded-full bg-slate-800 text-[10px] text-cyan-300 border border-slate-700 font-mono font-bold">
          {count}
        </span>
      )}
    </button>
  );
};

// =========================================================================
// Main Component: GlobalActivityLogger (Toasts + Slide-over Drawer)
// =========================================================================
export const GlobalActivityLogger: React.FC = () => {
  const [logs, setLogs] = useState<ActivityLogItem[]>([]);
  const [activeTasks, setActiveTasks] = useState<ActiveTaskItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [filterLevel, setFilterLevel] = useState<'all' | LogLevel>('all');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copied, setCopied] = useState(false);

  // Lắng nghe đăng ký từ service
  useEffect(() => {
    const unsubLog = appLogger.subscribe((newItem) => {
      setLogs((prev) => [newItem, ...prev.slice(0, 299)]);
    });

    const unsubOpen = appLogger.subscribeOpen((open) => {
      setIsOpen(open);
    });

    const unsubActiveTasks = appLogger.subscribeActiveTasks((tasks) => {
      setActiveTasks(tasks);
    });

    return () => {
      unsubLog();
      unsubOpen();
      unsubActiveTasks();
    };
  }, []);

  // Phím tắt Escape để đóng drawer
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

  const handleCopyLogs = () => {
    const text = logs
      .map(
        (l) =>
          `[${l.time}] [${l.level.toUpperCase()}] [${l.category}] ${l.message}${
            l.details ? `\n  Chi tiết: ${l.details}` : ''
          }`
      )
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

  // Danh mục phân loại tự động trích xuất từ logs
  const availableCategories = useMemo(() => {
    const cats = new Set<string>();
    logs.forEach((l) => {
      if (l.category) cats.add(l.category);
    });
    return Array.from(cats);
  }, [logs]);

  // Bộ lọc nhật ký đa chiều
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (filterLevel !== 'all' && log.level !== filterLevel) return false;
      if (filterCategory !== 'all' && log.category !== filterCategory) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchMsg = log.message.toLowerCase().includes(q);
        const matchCat = log.category?.toLowerCase().includes(q);
        const matchDetails = log.details?.toLowerCase().includes(q);
        if (!matchMsg && !matchCat && !matchDetails) return false;
      }
      return true;
    });
  }, [logs, filterLevel, filterCategory, searchQuery]);

  return (
    <>
      {/* ========================================================================= */}
      {/* 2. ACTIVITY LOG DRAWER (Slide-over Full-Featured Hub, Zero Screen Clutter)*/}
      {/* ========================================================================= */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] transition-opacity animate-in fade-in duration-150"
            onClick={() => {
              setIsOpen(false);
              appLogger.setOpen(false);
            }}
          />

          {/* Slide Drawer Panel */}
          <div className="fixed top-0 right-0 h-full w-[440px] max-w-[calc(100vw-1.5rem)] z-50 bg-[#121217]/98 border-l border-[#242430] shadow-2xl backdrop-blur-2xl flex flex-col overflow-hidden text-xs animate-in slide-in-from-right duration-200 select-none">
            {/* Header */}
            <div className="h-12 px-4 border-b border-[#242430] flex items-center justify-between bg-[#0e0e13]/80 shrink-0">
              <div className="flex items-center gap-2 font-semibold text-neutral-200">
                <Activity className="w-4 h-4 text-cyan-400" />
                <span className="text-sm">Nhật ký hoạt động</span>
                {logs.length > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-[#1e1e28] text-[10px] text-cyan-300 border border-[#2e2e3e] font-mono">
                    {logs.length}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleCopyLogs}
                  className="p-1.5 text-neutral-400 hover:text-cyan-300 rounded-lg hover:bg-[#1f1f2a] transition flex items-center gap-1 text-[11px]"
                  title="Sao chép toàn bộ nhật ký"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Đã chép' : 'Sao chép'}</span>
                </button>
                <button
                  onClick={handleClear}
                  className="p-1.5 text-neutral-400 hover:text-rose-400 rounded-lg hover:bg-[#1f1f2a] transition text-[11px]"
                  title="Xóa lịch sử"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => {
                    setIsOpen(false);
                    appLogger.setOpen(false);
                  }}
                  className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-[#1f1f2a] transition"
                  title="Đóng"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Active Tasks Section (Ghim trên cùng nếu có tác vụ đang chạy) */}
            {activeTasks.length > 0 && (
              <div className="p-3 border-b border-cyan-950/60 bg-cyan-950/20 shrink-0 space-y-2">
                <div className="flex items-center justify-between text-[11px] font-semibold text-cyan-300 uppercase tracking-wider">
                  <div className="flex items-center gap-1.5">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
                    </span>
                    <span>Tác vụ đang xử lý ({activeTasks.length})</span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  {activeTasks.map((t) => (
                    <div
                      key={t.taskKey}
                      className="p-2 rounded-lg bg-[#141d24] border border-cyan-700/40 text-neutral-200 flex flex-col gap-1 text-[11px]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 truncate">
                          <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin shrink-0" />
                          <span className="px-1 py-0.2 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 text-[9px] font-sans">
                            {t.category}
                          </span>
                          <span className="truncate font-medium">{t.message}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {t.progress !== undefined && (
                            <span className="px-1.5 py-0.5 rounded bg-cyan-950/80 text-[11px] text-cyan-400 font-mono font-bold border border-cyan-800/60 shadow-sm">
                              {t.progress}%
                            </span>
                          )}
                          <span className="text-[10px] text-neutral-400 font-mono">
                            {Math.round((Date.now() - t.startTime) / 1000)}s
                          </span>
                        </div>
                      </div>

                      {t.progress !== undefined && (
                        <div className="w-full bg-neutral-900 rounded-full h-1 overflow-hidden">
                          <div
                            className="h-full bg-cyan-400 transition-all duration-300"
                            style={{ width: `${Math.min(100, Math.max(0, t.progress))}%` }}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Search & Filter Toolbar */}
            <div className="p-3 border-b border-[#242430] bg-[#0e0e13]/60 space-y-2 shrink-0">
              {/* Search Bar */}
              <div className="relative flex items-center">
                <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-2.5 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Tìm kiếm nội dung nhật ký..."
                  className="w-full bg-[#181820] border border-[#2a2a38] focus:border-cyan-500/80 rounded-lg pl-8 pr-8 py-1.5 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none transition-colors"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 text-neutral-400 hover:text-white p-0.5 rounded"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Level & Category Filters */}
              <div className="flex items-center justify-between gap-2">
                {/* Level Tabs */}
                <div className="flex items-center gap-1 overflow-x-auto pb-0.5 text-[11px] scrollbar-none flex-1">
                  {(
                    [
                      { key: 'all', label: 'Tất cả' },
                      { key: 'loading', label: 'Đang tải' },
                      { key: 'success', label: 'Thành công' },
                      { key: 'warning', label: 'Cảnh báo' },
                      { key: 'error', label: 'Lỗi' },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.key}
                      onClick={() => setFilterLevel(tab.key)}
                      className={`px-2 py-1 rounded-md transition font-medium text-[10px] whitespace-nowrap ${
                        filterLevel === tab.key
                          ? 'bg-cyan-600 text-white shadow-sm font-semibold'
                          : 'text-neutral-400 hover:text-neutral-200 hover:bg-[#1a1a24]'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Category Dropdown Filter */}
                {availableCategories.length > 0 && (
                  <div className="relative flex items-center shrink-0">
                    <select
                      value={filterCategory}
                      onChange={(e) => setFilterCategory(e.target.value)}
                      className="appearance-none bg-[#181820] border border-[#2a2a38] text-[10px] text-neutral-300 rounded-lg px-2 py-1 pr-6 focus:outline-none focus:border-cyan-500 transition-colors cursor-pointer"
                    >
                      <option value="all">Tất cả mục</option>
                      {availableCategories.map((c) => (
                        <option key={c} value={c} className="bg-[#181820]">
                          {c}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="w-3 h-3 text-neutral-400 pointer-events-none absolute right-1.5" />
                  </div>
                )}
              </div>
            </div>

            {/* Log List View */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2 font-mono text-[11px] select-text">
              {filteredLogs.length === 0 ? (
                <div className="h-48 flex flex-col items-center justify-center text-neutral-500 text-center gap-2">
                  <Clock className="w-6 h-6 opacity-40" />
                  <span className="font-sans text-xs">
                    {searchQuery || filterLevel !== 'all' || filterCategory !== 'all'
                      ? 'Không tìm thấy nhật ký phù hợp bộ lọc'
                      : 'Chưa có hoạt động nào được ghi lại'}
                  </span>
                </div>
              ) : (
                filteredLogs.map((log) => {
                  const isSuccess = log.level === 'success';
                  const isError = log.level === 'error';
                  const isWarn = log.level === 'warning';
                  const isLoading = log.level === 'loading';

                  return (
                    <div
                      key={log.id}
                      className={`p-2.5 rounded-xl border flex flex-col gap-1 leading-relaxed transition-all ${
                        isSuccess
                          ? 'bg-emerald-950/20 border-emerald-900/40 text-emerald-200'
                          : isError
                          ? 'bg-rose-950/30 border-rose-900/50 text-rose-200'
                          : isWarn
                          ? 'bg-amber-950/20 border-amber-900/40 text-amber-200'
                          : isLoading
                          ? 'bg-cyan-950/20 border-cyan-900/40 text-cyan-200'
                          : 'bg-[#16161f]/80 border-[#242432] text-neutral-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-neutral-500 font-mono shrink-0">
                            {log.time}
                          </span>
                          {log.category && (
                            <span className="px-1.5 py-0.2 rounded bg-[#101016] text-neutral-400 border border-neutral-800 text-[9px] font-sans font-medium">
                              {log.category}
                            </span>
                          )}
                        </div>

                        <span
                          className={`text-[9px] uppercase tracking-wider font-semibold font-sans px-1.5 py-0.2 rounded ${
                            isSuccess
                              ? 'text-emerald-400 bg-emerald-950/60'
                              : isError
                              ? 'text-rose-400 bg-rose-950/60'
                              : isWarn
                              ? 'text-amber-400 bg-amber-950/60'
                              : isLoading
                              ? 'text-cyan-400 bg-cyan-950/60'
                              : 'text-neutral-400 bg-neutral-900'
                          }`}
                        >
                          {log.level}
                        </span>
                      </div>

                      <div className="font-sans text-xs font-normal break-words text-neutral-200">
                        {log.message}
                      </div>

                      {log.details && (
                        <div className="mt-1 p-1.5 rounded bg-black/40 border border-white/5 font-mono text-[10px] text-neutral-400 break-all">
                          {log.details}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
};

