import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('React Error Boundary caught an error:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-12 text-center">
          <div className="max-w-md">
            <span className="text-6xl mb-6 block">⚠️</span>
            <h2 className="text-2xl font-bold mb-4 text-white">出现错误</h2>
            <p className="text-slate-400 mb-6">
              应用遇到了一个意外错误。请尝试刷新页面或联系支持团队。
            </p>
            <div className="flex gap-4 justify-center">
              <button
                onClick={this.handleRetry}
                className="px-6 py-3 bg-brand-500 hover:bg-brand-600 text-white rounded-xl font-bold transition-colors"
              >
                重试
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-6 py-3 bg-white/5 hover:bg-white/10 text-white rounded-xl font-bold transition-colors border border-white/10"
              >
                刷新页面
              </button>
            </div>
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <div className="mt-8 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-left">
                <p className="text-red-400 text-xs font-mono whitespace-pre-wrap">
                  {this.state.error.toString()}
                </p>
              </div>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
