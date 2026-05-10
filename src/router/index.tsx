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

function OnboardingGuard() {
  const [checking, setChecking] = useState(true);
  const [needsOnboarding, setNeedsOnboarding] = useState(true);

  useEffect(() => {
    getConfigStatus()
      .then((data) => {
        setNeedsOnboarding(data.needs_onboarding);
      })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  if (checking) {
    return (
      <div className="min-h-screen bg-premium-bg flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      </div>
    );
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
