import React from 'react';
import { ProjectManifestV1 } from '../../types/api';

interface ProjectListProps {
  projects: ProjectManifestV1[];
  onSelectProject: (project: ProjectManifestV1) => void;
  onNewProject: () => void;
  onDeleteProject: (projectId: string) => void;
}

export const ProjectList: React.FC<ProjectListProps> = ({
  projects,
  onSelectProject,
  onNewProject,
  onDeleteProject,
}) => {
  return (
    <div className="max-w-5xl w-full mx-auto p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100 tracking-tight">Dự Án Phụ Đề</h1>
          <p className="text-zinc-400 text-sm mt-1">
            Quản lý và biên tập các dự án OCR nhận dạng & bản địa hóa phụ đề video
          </p>
        </div>
        <button
          onClick={onNewProject}
          className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium shadow-lg shadow-indigo-600/20 transition-all flex items-center gap-2"
        >
          <span>+</span> Tạo Dự Án Mới
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="border border-dashed border-zinc-800 rounded-2xl p-12 text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto text-zinc-400 text-xl">
            🎬
          </div>
          <div>
            <h3 className="text-zinc-200 font-medium">Chưa có dự án nào</h3>
            <p className="text-zinc-500 text-xs mt-1">Hãy import một video để bắt đầu nhận diện phụ đề</p>
          </div>
          <button
            onClick={onNewProject}
            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-xs font-medium border border-zinc-700 transition-colors"
          >
            Import Video Ngay
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((proj) => (
            <div
              key={proj.project_id}
              className="bg-zinc-900/60 border border-zinc-800/80 hover:border-zinc-700 rounded-xl p-5 space-y-4 transition-all hover:shadow-xl hover:shadow-black/40 group flex flex-col justify-between"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-indigo-950/60 border border-indigo-800 text-indigo-300">
                    {proj.source_language} &rarr; {proj.target_language}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Bạn có chắc muốn xóa dự án "${proj.title}"?`)) {
                        onDeleteProject(proj.project_id);
                      }
                    }}
                    className="text-zinc-600 hover:text-rose-400 text-xs transition-colors p-1"
                    title="Xóa dự án"
                  >
                    🗑️
                  </button>
                </div>
                <h3
                  onClick={() => onSelectProject(proj)}
                  className="font-semibold text-zinc-100 group-hover:text-indigo-400 transition-colors cursor-pointer truncate"
                >
                  {proj.title}
                </h3>
                <p className="text-zinc-500 text-xs font-mono truncate" title={proj.source_video_path}>
                  {proj.source_video_path}
                </p>
              </div>

              <div className="pt-3 border-t border-zinc-800/60 flex items-center justify-between text-xs text-zinc-400">
                <span>Rev #{proj.active_revision}</span>
                <button
                  onClick={() => onSelectProject(proj)}
                  className="text-indigo-400 hover:text-indigo-300 font-medium"
                >
                  Mở Studio &rarr;
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
