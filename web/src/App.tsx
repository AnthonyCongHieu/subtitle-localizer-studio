import React, { useEffect, useState } from 'react';
import { apiClient } from './api/client';
import { wsClient } from './api/websocket';
import { EditorView } from './components/editor/EditorView';
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
        <EditorView
          project={activeProject}
          onBack={() => setActiveProject(null)}
        />
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
