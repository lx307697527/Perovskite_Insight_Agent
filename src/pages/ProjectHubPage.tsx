import React from 'react';
import { Link, useParams } from 'react-router-dom';

const ProjectHubPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();

  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div className="glass-card rounded-3xl p-12 max-w-3xl w-full text-center animate-fade-in">
        <h1 className="text-2xl font-bold text-white mb-4">
          {projectId ? `项目详情` : '项目枢纽'}
        </h1>
        <p className="text-slate-400 mb-6">
          P02 — {projectId ? `项目 ${projectId}` : '管理所有项目'}
        </p>
        <div className="bg-white/5 rounded-2xl p-8 mb-6">
          <p className="text-slate-500 text-sm">
            项目管理、文献归档、多文档问答将在 Phase 1-3 实现
          </p>
        </div>
        <div className="flex justify-center gap-4">
          <Link to="/home" className="text-brand-400 hover:text-brand-300 text-sm">
            ← 返回首页
          </Link>
          <Link to="/projects" className="text-brand-400 hover:text-brand-300 text-sm">
            所有项目 →
          </Link>
        </div>
      </div>
    </div>
  );
};

export default ProjectHubPage;
