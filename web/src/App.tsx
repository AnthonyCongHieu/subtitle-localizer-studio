import React, { useEffect, useState } from 'react';
import { apiClient } from './api/client';
import { wsClient } from './api/websocket';
import { AppLayout } from './components/layout/AppLayout';
import { NewProjectModal } from './components/project/NewProjectModal';
import { ProjectList } from './components/project/ProjectList';
import { ProjectManifestV1 } from './types/api';

export const App: React.FC = () => {
  const [projects, setProjects] = useState<ProjectManifestV1[]>([]);
  const [activeProject, setActiveProject] = useState<ProjectManifestV1 | null>(null);
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);

  const loadProjects = async () => {
    try {
      const list = await apiClient.listProjects();
      setProjects(list);
    } catch (err) {
      console.error('Không thể nạp danh sách dự án:', err);
    }
  };

  useEffect(() => {
    loadProjects();
    wsClient.connect();
    const unsub = wsClient.onEvent((evt) => {
      if (evt.event_type === 'project_updated') {
        loadProjects();
      }
    });
    return () => unsub();
  }, []);

  const handleDeleteProject = async (projectId: string) => {
    const ok = await apiClient.deleteProject(projectId);
    if (ok) {
      if (activeProject?.project_id === projectId) {
        setActiveProject(null);
      }
      loadProjects();
    }
  };

  return (
    <AppLayout
      activeProjectTitle={activeProject?.title}
      onBackToProjects={() => setActiveProject(null)}
    >
      {!activeProject ? (
        <ProjectList
          projects={projects}
          onSelectProject={(p) => setActiveProject(p)}
          onNewProject={() => setIsNewModalOpen(true)}
          onDeleteProject={handleDeleteProject}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center text-zinc-400 text-sm">
          <div className="text-center space-y-3">
            <h2 className="text-lg font-medium text-zinc-200">Đang mở: {activeProject.title}</h2>
            <p className="text-xs text-zinc-500 font-mono">ID: {activeProject.project_id}</p>
            <button
              onClick={async () => {
                await apiClient.runPipeline(activeProject.project_id);
                alert('Đã khởi chạy tiến trình OCR & Dịch thành công!');
              }}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium"
            >
              Chạy OCR Pipeline
            </button>
          </div>
        </div>
      )}

      <NewProjectModal
        isOpen={isNewModalOpen}
        onClose={() => setIsNewModalOpen(false)}
        onCreated={(proj) => {
          setProjects((prev) => [proj, ...prev]);
          setActiveProject(proj);
        }}
      />
    </AppLayout>
  );
};
