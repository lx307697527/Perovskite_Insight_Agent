import React from 'react';
import { Link } from 'react-router-dom';

const OnboardingPage: React.FC = () => {
  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div className="glass-card rounded-3xl p-12 max-w-2xl w-full text-center animate-fade-in">
        <h1 className="text-3xl font-bold text-white mb-4">欢迎使用 SIA</h1>
        <p className="text-slate-400 mb-8">Sci-Insight Agent — 科学文献智能分析助手</p>

        {/* Step indicators */}
        <div className="flex justify-center gap-4 mb-8">
          {['API 配置', '代理设置', '领域选择'].map((step, i) => (
            <div key={i} className="flex flex-col items-center gap-2">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold ${
                i === 0 ? 'bg-brand-600 text-white' : 'bg-white/10 text-slate-500'
              }`}>
                {i + 1}
              </div>
              <span className="text-xs text-slate-500">{step}</span>
            </div>
          ))}
        </div>

        {/* TODO: Phase 1 — 3-step wizard */}
        <div className="bg-white/5 rounded-2xl p-8 mb-8">
          <p className="text-slate-400 text-sm">引导流程将在 Phase 1 实现</p>
        </div>

        <Link
          to="/home"
          className="btn-primary inline-block"
        >
          进入主页
        </Link>
      </div>
    </div>
  );
};

export default OnboardingPage;
