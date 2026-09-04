import React, { useState, useEffect } from 'react';
import { apiClient, DeviceStatusInfo } from '../../api/client';
import {
  Smartphone,
  Shield,
  Gauge,
  Wifi,
  RefreshCw,
  Copy,
  Check,
  Edit2,
  Save,
  X,
  Sparkles,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

interface DeviceSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DeviceSettingsModal: React.FC<DeviceSettingsModalProps> = ({ isOpen, onClose }) => {
  // Device state
  const [deviceInfo, setDeviceInfo] = useState<DeviceStatusInfo | null>(null);
  const [isLoadingDevice, setIsLoadingDevice] = useState(false);
  const [isRotatingDevice, setIsRotatingDevice] = useState(false);
  const [deviceRotateMessage, setDeviceRotateMessage] = useState<string | null>(null);
  const [copiedDeviceId, setCopiedDeviceId] = useState(false);
  const [copiedInstallId, setCopiedInstallId] = useState(false);

  // Custom device input state
  const [showCustomDeviceInput, setShowCustomDeviceInput] = useState(false);
  const [customDeviceId, setCustomDeviceId] = useState('');
  const [customInstallId, setCustomInstallId] = useState('');
  const [isSavingCustomDevice, setIsSavingCustomDevice] = useState(false);

  // Anti-block settings state
  const [isProxyEnabled, setIsProxyEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem('sls_proxy_enabled');
    return saved !== null ? saved === 'true' : Boolean(localStorage.getItem('sls_proxy_url'));
  });
  const [rotationInterval, setRotationInterval] = useState<number>(() => {
    const saved = localStorage.getItem('sls_rotation_interval');
    return saved !== null ? parseInt(saved) : 1;
  });
  const [rateLimitDelay, setRateLimitDelay] = useState<number>(() => {
    const saved = localStorage.getItem('sls_rate_limit_delay');
    return saved ? parseFloat(saved) : 2.0;
  });
  const [proxyUrl, setProxyUrl] = useState(() => localStorage.getItem('sls_proxy_url') || '');
  const [proxyTestResult, setProxyTestResult] = useState<{
    ok: boolean;
    ip?: string;
    direct_ip?: string;
    is_masked?: boolean;
    latency_ms?: number;
    error?: string;
  } | null>(null);
  const [isTestingProxy, setIsTestingProxy] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [proxyHistory, setProxyHistory] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('sls_proxy_history');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const saveToHistory = (url: string) => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setProxyHistory((prev) => {
      const next = [trimmed, ...prev.filter((p) => p !== trimmed)].slice(0, 4);
      localStorage.setItem('sls_proxy_history', JSON.stringify(next));
      return next;
    });
  };

  useEffect(() => {
    if (!isOpen) return;
    loadDeviceInfo();
  }, [isOpen]);

  const loadDeviceInfo = () => {
    setIsLoadingDevice(true);
    apiClient
      .getDeviceStatus()
      .then((info) => {
        setDeviceInfo(info);
        setCustomDeviceId(info.device_id || '');
        setCustomInstallId(info.install_id || '');
      })
      .catch((err) => console.warn('Could not load device info:', err))
      .finally(() => setIsLoadingDevice(false));
  };

  const handleRotateDeviceNow = async () => {
    setIsRotatingDevice(true);
    setDeviceRotateMessage(null);
    try {
      const res = await apiClient.rotateDevice(proxyUrl.trim() || undefined);
      setDeviceInfo(res);
      setCustomDeviceId(res.device_id);
      setCustomInstallId(res.install_id);
      setDeviceRotateMessage(`Đã cấp thiết bị mới thành công: Device ID ${res.device_id}`);
      setTimeout(() => setDeviceRotateMessage(null), 5000);
    } catch (err: any) {
      alert(`Không thể cấp thiết bị mới: ${err?.message}`);
    } finally {
      setIsRotatingDevice(false);
    }
  };

  const handleSaveCustomDevice = async () => {
    if (!customDeviceId.trim() || !customInstallId.trim()) {
      alert('Vui lòng điền đủ Device ID và Install ID.');
      return;
    }
    setIsSavingCustomDevice(true);
    try {
      const res = await apiClient.saveCustomDevice(customDeviceId.trim(), customInstallId.trim());
      setDeviceInfo(res);
      setShowCustomDeviceInput(false);
      setDeviceRotateMessage('Đã cập nhật thông tin thiết bị tùy chỉnh!');
      setTimeout(() => setDeviceRotateMessage(null), 4000);
    } catch (err: any) {
      alert(`Lỗi lưu thiết bị: ${err?.message}`);
    } finally {
      setIsSavingCustomDevice(false);
    }
  };

  const copyToClipboard = (text: string, type: 'device' | 'install') => {
    navigator.clipboard.writeText(text);
    if (type === 'device') {
      setCopiedDeviceId(true);
      setTimeout(() => setCopiedDeviceId(false), 2000);
    } else {
      setCopiedInstallId(true);
      setTimeout(() => setCopiedInstallId(false), 2000);
    }
  };

  const handleTestProxy = async () => {
    const url = proxyUrl.trim();
    if (!url) {
      setProxyTestResult({ ok: false, error: 'Vui lòng nhập địa chỉ proxy.' });
      return;
    }
    setIsTestingProxy(true);
    setProxyTestResult(null);
    try {
      const result = await apiClient.testProxy(url);
      setProxyTestResult(result);
      if (result.ok) {
        localStorage.setItem('sls_proxy_url', url);
        saveToHistory(url);
      }
    } catch (err: any) {
      setProxyTestResult({ ok: false, error: err?.message || 'Không thể kiểm tra proxy.' });
    } finally {
      setIsTestingProxy(false);
    }
  };

  const handleSaveAll = () => {
    const trimmed = proxyUrl.trim();
    localStorage.setItem('sls_proxy_url', trimmed);
    localStorage.setItem('sls_proxy_enabled', String(isProxyEnabled));
    localStorage.setItem('sls_rate_limit_delay', String(rateLimitDelay));
    localStorage.setItem('sls_rotation_interval', String(rotationInterval));
    localStorage.setItem('sls_rotate_device', String(rotationInterval > 0));
    if (trimmed) {
      saveToHistory(trimmed);
    }
    setSaveSuccess(true);
    setTimeout(() => {
      setSaveSuccess(false);
      onClose();
    }, 1200);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-950/80 border border-emerald-800/80 rounded-xl text-emerald-400">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white">Cấu Hình Thiết Bị & Chống Giới Hạn IP</h3>
                <span className="px-2 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-600/40 text-emerald-300 text-[10px] font-semibold flex items-center gap-1">
                  <Shield className="w-3 h-3" />
                  <span>Hồng Quả / ByteDance</span>
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Quản lý định danh thiết bị ảo, chu kỳ xoay vòng chống block và cài đặt proxy
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1 text-slate-200">
          {/* Card 1: Định danh thiết bị Android hiện tại */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-bold text-white">Định Danh Thiết Bị Đang Dùng</span>
              </div>
              <span className="px-2 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-700/60 text-emerald-300 text-[10px] font-semibold flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {deviceInfo?.status === 'ready' ? 'Sẵn sàng gửi request' : 'Chưa cấu hình'}
              </span>
            </div>

            {/* Thông tin chi tiết */}
            <div className="p-3 rounded-lg bg-slate-900/90 border border-slate-800/80 space-y-2 text-[11px]">
              <div className="flex items-center justify-between text-slate-400 pb-1.5 border-b border-slate-800">
                <span>Thiết bị giả lập:</span>
                <span className="text-slate-100 font-semibold">
                  {deviceInfo?.device_brand || 'Xiaomi'} {deviceInfo?.device_model || 'MI 12'} (Kernel v32.9.0)
                </span>
              </div>

              <div className="flex items-center justify-between text-slate-400 pb-1.5 border-b border-slate-800">
                <span>Máy chủ cấp phát:</span>
                <span className="text-emerald-300 font-mono text-[10px]">
                  {deviceInfo?.server_source || 'https://log.snssdk.com (ByteDance SNSSDK)'}
                </span>
              </div>

              <div className="flex items-center justify-between text-slate-400 pb-1.5 border-b border-slate-800">
                <span>Lần cập nhật cuối:</span>
                <span className="text-cyan-300 font-semibold text-[11px]">
                  {deviceInfo?.last_updated || 'Vừa xong'}
                </span>
              </div>

              {deviceInfo?.config_file && (
                <div className="flex items-center justify-between text-slate-400 pb-1.5 border-b border-slate-800">
                  <span>Tệp lưu trên đĩa:</span>
                  <span className="text-slate-300 font-mono text-[10px] truncate max-w-[280px]" title={deviceInfo.config_file}>
                    {deviceInfo.config_file}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between">
                <span className="text-slate-400">Device ID:</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-cyan-300 font-bold select-all">
                    {isLoadingDevice ? 'Đang truy vấn...' : deviceInfo?.device_id || 'Chưa có'}
                  </span>
                  {deviceInfo?.device_id && (
                    <button
                      type="button"
                      onClick={() => copyToClipboard(deviceInfo.device_id, 'device')}
                      className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition"
                      title="Sao chép Device ID"
                    >
                      {copiedDeviceId ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-400">Install ID:</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-cyan-300 font-bold select-all">
                    {isLoadingDevice ? 'Đang truy vấn...' : deviceInfo?.install_id || 'Chưa có'}
                  </span>
                  {deviceInfo?.install_id && (
                    <button
                      type="button"
                      onClick={() => copyToClipboard(deviceInfo.install_id, 'install')}
                      className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition"
                      title="Sao chép Install ID"
                    >
                      {copiedInstallId ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Thông báo kết quả xoay */}
            {deviceRotateMessage && (
              <div className="p-2.5 rounded-lg bg-emerald-950/50 border border-emerald-800/60 text-emerald-300 text-xs flex items-center gap-2 animate-in fade-in">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                <span>{deviceRotateMessage}</span>
              </div>
            )}

            {/* Nút Cấp mới / Sửa thủ công */}
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleRotateDeviceNow}
                disabled={isRotatingDevice}
                className="flex-1 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-bold rounded-xl shadow-lg transition flex items-center justify-center gap-2 active:scale-95"
              >
                <RefreshCw className={`w-4 h-4 ${isRotatingDevice ? 'animate-spin' : ''}`} />
                <span>{isRotatingDevice ? 'Đang gửi đăng ký lên ByteDance...' : '🔄 Cấp Thiết Bị Mới Ngay'}</span>
              </button>

              <button
                type="button"
                onClick={() => setShowCustomDeviceInput(!showCustomDeviceInput)}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl border border-slate-700 transition flex items-center gap-1.5"
                title="Tự nhập Device ID / Install ID thủ công"
              >
                <Edit2 className="w-3.5 h-3.5" />
                <span>{showCustomDeviceInput ? 'Đóng form' : 'Nhập tay'}</span>
              </button>
            </div>

            {/* Form nhập thủ công */}
            {showCustomDeviceInput && (
              <div className="p-3 rounded-xl bg-slate-900 border border-slate-700/80 space-y-2.5 animate-in fade-in">
                <div className="text-xs font-semibold text-slate-200">Gán Device ID tùy chỉnh của bạn:</div>
                <div className="space-y-2">
                  <input
                    type="text"
                    value={customDeviceId}
                    onChange={(e) => setCustomDeviceId(e.target.value)}
                    placeholder="Device ID (ví dụ: 885560639840793)"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white font-mono placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                  />
                  <input
                    type="text"
                    value={customInstallId}
                    onChange={(e) => setCustomInstallId(e.target.value)}
                    placeholder="Install ID (ví dụ: 885560639844889)"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white font-mono placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleSaveCustomDevice}
                  disabled={isSavingCustomDevice}
                  className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 transition"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{isSavingCustomDevice ? 'Đang lưu...' : 'Lưu Định Danh Mới'}</span>
                </button>
              </div>
            )}
          </div>

          {/* Card 2: Chu kỳ xoay vòng thiết bị tự động */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
            <label className="text-xs font-bold text-white flex items-center gap-1.5">
              <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
              Tần suất tự động cấp thiết bị mới khi tải tập:
            </label>
            <div className="grid grid-cols-4 gap-2">
              {[
                { value: 1, label: 'Mỗi 1 tập', desc: 'Khuyên dùng', color: 'text-emerald-400' },
                { value: 3, label: 'Mỗi 3 tập', desc: 'Tiết kiệm', color: 'text-cyan-400' },
                { value: 5, label: 'Mỗi 5 tập', desc: 'Tập dài', color: 'text-amber-400' },
                { value: 0, label: 'Khi lỗi', desc: 'Chỉ khi chặn', color: 'text-slate-400' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    setRotationInterval(opt.value);
                    localStorage.setItem('sls_rotation_interval', String(opt.value));
                  }}
                  className={`p-2.5 rounded-xl border text-center transition text-xs ${
                    rotationInterval === opt.value
                      ? 'bg-emerald-950/70 border-emerald-500 ring-1 ring-emerald-500/40'
                      : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className={`font-bold text-sm ${opt.color}`}>{opt.label}</div>
                  <div className="text-slate-400 text-[10px] mt-0.5">{opt.desc}</div>
                </button>
              ))}
            </div>
            <p className="text-[10px] text-slate-500">
              * Hệ thống chủ động cấp danh tính thiết bị Android mới từ ByteDance theo chu kỳ để triệt tiêu việc tích lũy lịch sử request.
            </p>
          </div>

          {/* Card 3: Tốc độ & Giãn cách giữa các tập */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
            <label className="text-xs font-bold text-white flex items-center gap-1.5">
              <Gauge className="w-3.5 h-3.5 text-cyan-400" />
              Tốc độ & Giãn cách nghỉ (Jitter Delay) giữa các tập:
            </label>
            <div className="grid grid-cols-4 gap-2">
              {[
                { value: 0.8, label: 'Tốc độ cao', desc: 'Ít tập', color: 'text-rose-400' },
                { value: 2.0, label: 'Bình thường', desc: 'Khuyên dùng', color: 'text-emerald-400' },
                { value: 3.5, label: 'Cẩn trọng', desc: '>50 tập', color: 'text-amber-400' },
                { value: 6.0, label: 'Siêu an toàn', desc: 'Chống block', color: 'text-blue-400' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    setRateLimitDelay(opt.value);
                    localStorage.setItem('sls_rate_limit_delay', String(opt.value));
                  }}
                  className={`p-2.5 rounded-xl border text-center transition text-xs ${
                    rateLimitDelay === opt.value
                      ? 'bg-indigo-950/70 border-indigo-500 ring-1 ring-indigo-500/40'
                      : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className={`font-bold text-sm ${opt.color}`}>{opt.value}s</div>
                  <div className="text-slate-300 text-[11px] font-medium">{opt.label}</div>
                  <div className="text-slate-500 text-[10px]">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Card 4: Cấu hình Proxy */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-white flex items-center gap-1.5">
                <Wifi className="w-3.5 h-3.5 text-violet-400" />
                Máy Chủ Proxy (Ẩn Danh IP):
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-xs">
                <input
                  type="checkbox"
                  checked={isProxyEnabled}
                  onChange={(e) => {
                    setIsProxyEnabled(e.target.checked);
                    localStorage.setItem('sls_proxy_enabled', String(e.target.checked));
                  }}
                  className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-0"
                />
                <span className={`font-bold text-xs ${isProxyEnabled ? 'text-emerald-400' : 'text-slate-500'}`}>
                  {isProxyEnabled ? '🟢 Đang BẬT' : '⚪ Đang TẮT (Trực tiếp)'}
                </span>
              </label>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={proxyUrl}
                onChange={(e) => {
                  setProxyUrl(e.target.value);
                  setProxyTestResult(null);
                }}
                disabled={!isProxyEnabled}
                placeholder="http://host:port hoặc socks5://user:pass@host:port"
                className="flex-1 px-3 py-2 bg-slate-900 border border-slate-800 focus:border-violet-500 rounded-lg text-xs text-slate-100 placeholder-slate-600 focus:outline-none transition font-mono disabled:opacity-40"
              />
              <button
                type="button"
                onClick={handleTestProxy}
                disabled={isTestingProxy || !proxyUrl.trim() || !isProxyEnabled}
                className="px-3.5 py-2 bg-violet-900/60 hover:bg-violet-800/60 disabled:opacity-40 text-violet-200 text-xs font-bold rounded-lg transition flex items-center gap-1.5 flex-shrink-0 border border-violet-700/40"
              >
                {isTestingProxy ? (
                  <Sparkles className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Wifi className="w-3.5 h-3.5" />
                )}
                <span>Kiểm tra</span>
              </button>
            </div>

            {/* Gợi ý điền nhanh 1 chạm & Lịch sử gần đây */}
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <span className="text-[10px] text-slate-500 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-amber-400" />
                Điền nhanh:
              </span>
              {[
                { label: '⚡ Clash (7890)', val: 'http://127.0.0.1:7890' },
                { label: '⚡ v2rayN HTTP (10809)', val: 'http://127.0.0.1:10809' },
                { label: '⚡ v2rayN SOCKS (10808)', val: 'socks5://127.0.0.1:10808' },
              ].map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => {
                    setProxyUrl(preset.val);
                    setIsProxyEnabled(true);
                    setProxyTestResult(null);
                  }}
                  className="px-2 py-0.5 rounded-md bg-slate-900 hover:bg-slate-800 text-[10px] text-slate-400 hover:text-cyan-300 border border-slate-800 transition font-mono"
                  title={`Điền nhanh: ${preset.val}`}
                >
                  {preset.label}
                </button>
              ))}
              {proxyHistory.length > 0 && (
                <>
                  <span className="text-[10px] text-slate-600 pl-1">• Gần đây:</span>
                  {proxyHistory.map((hist) => (
                    <button
                      key={hist}
                      type="button"
                      onClick={() => {
                        setProxyUrl(hist);
                        setIsProxyEnabled(true);
                        setProxyTestResult(null);
                      }}
                      className="px-2 py-0.5 rounded-md bg-violet-950/40 hover:bg-violet-900/50 text-[10px] text-violet-300 border border-violet-800/40 transition font-mono truncate max-w-[140px]"
                      title={`Dùng lại: ${hist}`}
                    >
                      {hist}
                    </button>
                  ))}
                </>
              )}
            </div>

            {/* Kết quả kiểm tra proxy */}
            {proxyTestResult && (
              <div
                className={`p-3 rounded-xl border text-xs space-y-1.5 ${
                  proxyTestResult.ok
                    ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
                    : 'bg-rose-950/40 border-rose-800/60 text-rose-300'
                }`}
              >
                {proxyTestResult.ok ? (
                  <>
                    <div className="flex items-center justify-between font-medium">
                      <span className="text-slate-400">IP Thật của máy bạn (Gốc):</span>
                      <span className="font-mono text-slate-300 font-bold">{proxyTestResult.direct_ip || '115.76.50.129'}</span>
                    </div>
                    <div className="flex items-center justify-between font-medium">
                      <span className="text-emerald-300">IP Xuất ngoại khi qua Proxy:</span>
                      <span className="font-mono text-emerald-200 font-bold text-sm">{proxyTestResult.ip}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] pt-1.5 border-t border-emerald-800/40">
                      <span>Độ trễ Ping: <strong className="text-cyan-300">{proxyTestResult.latency_ms}ms</strong></span>
                      <span className="text-emerald-400 font-bold">
                        {proxyTestResult.is_masked ? '✓ Đã ẩn danh (Khác IP gốc máy)' : '⚠ Trùng IP gốc máy'}
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                      <span>{proxyTestResult.error}</span>
                    </div>
                    {proxyTestResult.direct_ip && (
                      <div className="text-[11px] text-slate-400 pt-1">
                        IP mạng hiện tại của máy bạn: <strong className="text-white font-mono">{proxyTestResult.direct_ip}</strong>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
            <p className="text-[10px] text-slate-500">
              * Proxy được áp dụng đồng bộ xuyên suốt 4 lớp mạng: requests, urllib, ffmpeg và yt-dlp.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div>
            {saveSuccess && (
              <span className="text-xs text-emerald-400 font-bold flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" />
                Đã lưu cấu hình thành công!
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition"
            >
              Đóng
            </button>
            <button
              onClick={handleSaveAll}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl shadow-lg transition active:scale-95"
            >
              Lưu & Áp Dụng
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
