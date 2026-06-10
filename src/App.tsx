import React, { useEffect, useCallback } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useAppStore } from './store';
import { API_BASE } from './services/fetchUtils';

async function checkBackendHealth(): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);
  try {
    const resp = await fetch(`${API_BASE}/`, { signal: controller.signal });
    return resp.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

const App: React.FC = () => {
  const location = useLocation();
  const { sidebarOpen, toggleSidebar, comparisonDois, toast, clearToast, backendConnected, setBackendConnected } = useAppStore();

  const pingBackend = useCallback(async () => {
    const ok = await checkBackendHealth();
    setBackendConnected(ok);
  }, [setBackendConnected]);

  useEffect(() => {
    pingBackend();
    const id = setInterval(pingBackend, 15000);
    return () => clearInterval(id);
  }, [pingBackend]);

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

      {/* Backend Disconnected Banner */}
      {!backendConnected && location.pathname !== '/onboarding' && (
        <div className="fixed top-0 left-0 right-0 z-[200] bg-amber-500/90 text-black text-center py-2 text-sm font-medium backdrop-blur-sm">
          后端服务未连接 (localhost:8000) — 请启动 Python Sidecar
          <button
            type="button"
            onClick={pingBackend}
            className="ml-3 px-2 py-0.5 bg-black/20 rounded text-xs hover:bg-black/30 transition-colors"
          >
            重试
          </button>
        </div>
      )}

      {/* Main content */}
      <main className={`flex-1 transition-all duration-300 ${
        location.pathname !== '/onboarding' && sidebarOpen ? 'ml-56' : 'ml-0'
      }${!backendConnected ? ' mt-9' : ''}`}>
        <Outlet />
      </main>

      {/* Toast */}
      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[300] animate-in slide-in-from-top-4 duration-300" onClick={clearToast}>
          <div className={`px-6 py-3 rounded-2xl border shadow-2xl flex items-center gap-3 cursor-pointer ${
            toast.type === 'error' ? 'bg-red-500/10 border-red-500/30 text-red-400' :
            toast.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' :
            'bg-brand-500/10 border-brand-500/30 text-brand-400'
          }`}>
            <span className="text-xs font-bold">{toast.message}</span>
            <button type="button" className="text-current opacity-50 hover:opacity-100 ml-2" onClick={clearToast}>x</button>
          </div>
        </div>
      )}

      {/* Footer / Status Bar */}
      {location.pathname !== '/onboarding' && (
        <footer className="fixed bottom-0 w-full p-3 border-t border-white/5 bg-black/20 backdrop-blur-md flex justify-between items-center text-xs text-slate-500 px-8 z-30">
          <div>SIA v2.1 | Sci-Insight Agent</div>
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <span className={`w-2 h-2 rounded-full ${backendConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></span>
              {backendConnected ? 'Sidecar Connected' : 'Sidecar Offline'}
            </span>
            <span>SQLite Local</span>
          </div>
        </footer>
      )}
    </div>
  );
};

export default App;
