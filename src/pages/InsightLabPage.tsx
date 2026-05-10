import React from 'react';
import { Link, useParams } from 'react-router-dom';

const InsightLabPage: React.FC = () => {
  const { doi } = useParams<{ doi: string }>();

  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div className="glass-card rounded-3xl p-12 max-w-3xl w-full text-center animate-fade-in">
        <h1 className="text-2xl font-bold text-white mb-4">见解实验室</h1>
        <p className="text-slate-400 mb-6">
          P03 — 精准问答中心
          {doi && <span className="text-brand-400 ml-2">({doi})</span>}
        </p>
        <div className="bg-white/5 rounded-2xl p-8 mb-6">
          <p className="text-slate-500 text-sm">
            精准问答引擎 (RAG + FAISS) 将在 Phase 2 实现
          </p>
        </div>
        <Link to="/home" className="text-brand-400 hover:text-brand-300 text-sm">
          ← 返回首页
        </Link>
      </div>
    </div>
  );
};

export default InsightLabPage;
