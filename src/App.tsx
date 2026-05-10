import React from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useAppStore } from './store';

const App: React.FC = () => {
  const location = useLocation();
  const { sidebarOpen, toggleSidebar, comparisonDois } = useAppStore();

  const navItems = [
    { path: '/home', label: '首页', icon: '🏠' },
    { path: '/quick', label: '快捷模式', icon: '⚡' },
    { path: '/projects', label: '项目枢纽', icon: '📁' },
    { path: '/insight', label: '见解实验室', icon: '🔬' },
    { path: '/compare', label: '对比工作台', icon: '📊' },
  ];

  return (
    <div className="min-h-screen bg-premium-bg overflow-x-hidden selection:bg-brand-500/30 flex">
      {/* Sidebar */}
      {location.pathname !== '/onboarding' && (
        <aside className={`fixed left-0 top-0 h-full bg-black/30 backdrop-blur-xl border-r border-white/5 transition-all duration-300 z-40 ${
          sidebarOpen ? 'w-56' : 'w-16'
        }`}>
          <div className="p-4">
            <button
              type="button"
              onClick={toggleSidebar}
              className="text-slate-400 hover:text-white transition-colors mb-6"
            >
              {sidebarOpen ? '◀' : '▶'}
            </button>

            <nav className="flex flex-col gap-1">
              {navItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 text-sm ${
                    location.pathname.startsWith(item.path)
                      ? 'bg-brand-600/20 text-brand-400'
                      : 'text-slate-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <span>{item.icon}</span>
                  {sidebarOpen && <span>{item.label}</span>}
                </Link>
              ))}
            </nav>

            {comparisonDois.length > 0 && sidebarOpen && (
              <div className="mt-6 px-3 py-2 bg-brand-600/10 rounded-xl">
                <span className="text-xs text-brand-400">
                  已选 {comparisonDois.length} 篇文献对比
                </span>
              </div>
            )}
          </div>
        </aside>
      )}

      {/* Main content */}
      <main className={`flex-1 transition-all duration-300 ${
        location.pathname !== '/onboarding' && sidebarOpen ? 'ml-56' : 'ml-0'
      }`}>
        <Outlet />
      </main>

      {/* Footer / Status Bar */}
      {location.pathname !== '/onboarding' && (
        <footer className="fixed bottom-0 w-full p-3 border-t border-white/5 bg-black/20 backdrop-blur-md flex justify-between items-center text-xs text-slate-500 px-8">
          <div>SIA v2.1 | Sci-Insight Agent</div>
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
              Sidecar Connected
            </span>
            <span>SQLite Local</span>
          </div>
        </footer>
      )}
    </div>
  );
};

export default App;
