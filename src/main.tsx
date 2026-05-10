import React from 'react'
import ReactDOM from 'react-dom/client'
import ErrorBoundary from './components/ErrorBoundary.tsx'
import AppRouter from './router/index.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AppRouter />
    </ErrorBoundary>
  </React.StrictMode>,
)
