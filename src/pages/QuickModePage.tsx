import React from 'react';
import { Link } from 'react-router-dom';

const QuickModePage: React.FC = () => {
  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div className="glass-card rounded-3xl p-12 max-w-2xl w-full text-center animate-fade-in">
        <h1 className="text-2xl font-bold text-white mb-4">快捷模式</h1>
        <p className="text-slate-400 mb-6">P01b — 单篇文献快速处理（PDF/DOI）</p>
        <div className="bg-white/5 rounded-2xl p-8 mb-6">
          <p className="text-slate-500 text-sm">统一输入框将在 Phase 1 实现</p>
        </div>
        <Link to="/home" className="text-brand-400 hover:text-brand-300 text-sm">
          ← 返回首页
        </Link>
      </div>
    </div>
  );
};

export default QuickModePage;
