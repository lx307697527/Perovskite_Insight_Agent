import React, { useEffect, useState } from 'react';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import App from '../App';
import OnboardingPage from '../pages/OnboardingPage';
import HomePage from '../pages/HomePage';
import QuickModePage from '../pages/QuickModePage';
import ProjectHubPage from '../pages/ProjectHubPage';
import InsightLabPage from '../pages/InsightLabPage';
import ResultsPage from '../pages/ResultsPage';
import DetailsPage from '../pages/DetailsPage';
import ComparisonPage from '../pages/ComparisonPage';
import { getConfigStatus } from '../services/configApi';

// 快速超时，避免启动时长时间白屏
const STARTUP_TIMEOUT = 2000; // 2秒超时

function OnboardingGuard() {
  const [checking, setChecking] = useState(true);
  const [needsOnboarding, setNeedsOnboarding] = useState(true);
  const [timeout, setTimedOut] = useState(false);

  useEffect(() => {
    // 设置超时，避免等待后端太久
    const timeoutId = setTimeout(() => {
      setChecking(false);
      setTimedOut(true);
      // 超时后默认跳转到主页，让用户可以看到界面
      setNeedsOnboarding(false);
    }, STARTUP_TIMEOUT);

    getConfigStatus()
      .then((data) => {
        clearTimeout(timeoutId);
        setNeedsOnboarding(data.needs_onboarding);
      })
      .catch(() => {
        // 错误时也清除超时，允许进入应用
        clearTimeout(timeoutId);
        setNeedsOnboarding(false);
      })
      .finally(() => setChecking(false));
  }, []);

  if (checking) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 to-indigo-950 flex flex-col items-center justify-center gap-4">
        <div className="w-10 h-10 border-4 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
        <div className="text-slate-400 text-sm">正在初始化...</div>
      </div>
    );
  }

  // 如果超时，显示提示并跳转
  if (timeout) {
    return <Navigate to="/home" replace />;
  }

  return needsOnboarding ? <OnboardingPage /> : <Navigate to="/home" replace />;
}

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Navigate to="/home" replace /> },
      { path: 'onboarding', element: <OnboardingGuard /> },
      { path: 'home', element: <HomePage /> },
      { path: 'quick', element: <QuickModePage /> },
      { path: 'projects', element: <ProjectHubPage /> },
      { path: 'projects/:projectId', element: <ProjectHubPage /> },
      { path: 'insight', element: <InsightLabPage /> },
      { path: 'insight/:doi', element: <InsightLabPage /> },
      // V1 backward-compat routes (fully functional)
      { path: 'results', element: <ResultsPage /> },
      { path: 'details/:doi', element: <DetailsPage /> },
      { path: 'compare', element: <ComparisonPage /> },
    ],
  },
]);

const AppRouter: React.FC = () => {
  return <RouterProvider router={router} />;
};

export default AppRouter;
