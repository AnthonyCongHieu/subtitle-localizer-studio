import React, { useMemo, useState } from 'react';
import {
  Check,
  Clock,
  DownloadCloud,
  FileVideo,
  HardDrive,
  Search,
  X,
} from 'lucide-react';
import { LanDownload } from '../../types/api';
import { EmptyState, focusRing, formatBytes, formatTime, StatusBadge } from './LanUi';

interface AdminDownloadsTabProps {
  downloads: LanDownload[];
  isPending: (key: string) => boolean;
  onDecision: (download: LanDownload, approved: boolean) => void;
}

export const AdminDownloadsTab: React.FC<AdminDownloadsTabProps> = ({
  downloads,
  isPending,
  onDecision,
}) => {
  const [search, setSearch] = useState<string>('');

  const filtered = useMemo(() => {
    return downloads.filter((item) => {
      const q = search.trim().toLowerCase();
      return (
        !q ||
        [item.title, item.source, item.worker_id, item.request_id].some((f) =>
          String(f || '').toLowerCase().includes(q)
        )
      );
    });
  }, [downloads, search]);

  return (
    <section
      aria-labelledby="downloads-tab-heading"
      className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-sm"
    >
      {/* Header & Filter */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <h2 id="downloads-tab-heading" className="text-base font-bold text-white flex items-center gap-2">
            Phê Duyệt Video Tải Về ({downloads.length})
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Kiểm tra thông tin preview, thời lượng và kích thước trước khi cho phép worker tải về máy.
          </p>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
          <input
            type="text"
            placeholder="Tìm theo tiêu đề, nguồn link…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`h-9 w-60 rounded-xl border border-slate-700 bg-slate-950 pl-9 pr-3 text-xs text-slate-200 placeholder-slate-500 ${focusRing}`}
          />
        </div>
      </div>

      {/* Danh sách yêu cầu tải */}
      {!filtered.length ? (
        <EmptyState
          title={downloads.length ? 'Không tìm thấy yêu cầu phù hợp' : 'Chưa có yêu cầu tải nào chờ duyệt'}
          icon={DownloadCloud}
        >
          {downloads.length
            ? 'Hãy thử thay đổi từ khóa tìm kiếm.'
            : 'Khi worker bóc tách được link preview từ các trang video online, yêu cầu sẽ hiển thị tại đây để bạn duyệt.'}
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => {
            const busy = isPending(`download:${item.request_id}`);
            const isPendingDecision = ['preview_ready', 'requested'].includes(item.status || '');

            return (
              <div
                key={item.request_id}
                className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-950/60 p-4 transition-all duration-200 hover:border-slate-700"
              >
                {/* Thông tin Video */}
                <div className="flex items-start gap-3.5 min-w-0 max-w-xl">
                  <div className="rounded-xl border border-indigo-900/40 bg-indigo-950/40 p-2.5 text-indigo-400 shrink-0">
                    <FileVideo className="h-6 w-6" />
                  </div>
                  <div className="min-w-0 space-y-1">
                    <h3 className="font-semibold text-xs text-white truncate" title={item.title}>
                      {item.title || 'Video chưa có tiêu đề'}
                    </h3>
                    <p className="text-[11px] text-slate-500 truncate font-mono" title={item.source}>
                      {item.source || 'Không rõ nguồn URL'}
                    </p>
                    <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-400 pt-0.5">
                      <span className="flex items-center gap-1">
                        <HardDrive className="h-3 w-3 text-slate-500" />
                        {formatBytes(item.size_bytes)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3 text-slate-500" />
                        {item.duration_seconds != null
                          ? `${Math.round(item.duration_seconds)} giây`
                          : 'Chưa rõ thời lượng'}
                      </span>
                      <span>Worker: {item.worker_id || 'Chưa gán'}</span>
                      <span>Gửi lúc: {formatTime(item.created_at)}</span>
                    </div>
                  </div>
                </div>

                {/* Trạng thái & Thao tác */}
                <div className="flex items-center gap-3">
                  <StatusBadge status={item.status} />

                  {isPendingDecision ? (
                    <div className="flex items-center gap-2">
                      <button
                        disabled={busy}
                        onClick={() => onDecision(item, true)}
                        className={`flex items-center gap-1 rounded-xl bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white shadow-md shadow-emerald-700/20 hover:bg-emerald-600 transition-colors ${focusRing}`}
                      >
                        <Check className="h-3.5 w-3.5" />
                        {busy ? 'Đang xử lý…' : 'Duyệt tải'}
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => onDecision(item, false)}
                        className={`flex items-center gap-1 rounded-xl border border-rose-900/60 bg-rose-950/60 px-3 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-900 transition-colors ${focusRing}`}
                      >
                        <X className="h-3.5 w-3.5" />
                        Từ chối
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-500 font-medium">Đã giải quyết</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
