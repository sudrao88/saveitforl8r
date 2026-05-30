import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { btn, overlay, text, zIndex } from '../styles/design-system';
import { isChunkLoadError, clearServiceWorkerCaches } from '../utils/chunkErrorUtils';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallbackTitle?: string;
  fallbackMessage?: string;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  handleReload = async () => {
    // If the error looks like a stale chunk / module import failure,
    // clear all SW caches first so the reload fetches fresh assets.
    if (isChunkLoadError(this.state.error)) {
      await clearServiceWorkerCaches();
    }
    window.location.reload();
  };

  handleDismiss = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      const title = this.props.fallbackTitle || 'Something went wrong';
      const message = this.props.fallbackMessage || 'An unexpected error occurred. Your data is safe — try reloading the app.';

      return (
        <div className={`fixed inset-0 bg-(--color-surface-overlay) flex items-center justify-center ${zIndex.tooltip} p-6`}>
          <div className={`${overlay.modal} max-w-md w-full p-8 text-center`}>
            <div className="w-14 h-14 mx-auto mb-5 bg-(--color-danger)/30 rounded-(--radius-xl) flex items-center justify-center">
              <AlertTriangle size={28} className="text-(--color-danger)" />
            </div>
            <h2 className={`${text.heading} text-xl mb-2`}>{title}</h2>
            <p className={`${text.body} mb-6 leading-relaxed`}>{message}</p>
            {this.state.error && (
              <pre className={`${text.caption} bg-(--color-surface-overlay) rounded-(--radius-lg) p-3 mb-6 text-left overflow-auto max-h-32 border border-(--color-border-default)`}>
                {this.state.error.message}
              </pre>
            )}
            <div className="flex gap-3">
              <button
                onClick={this.handleDismiss}
                className={`${btn.base} ${btn.secondary} flex-1 py-3`}
              >
                Try Again
              </button>
              <button
                onClick={this.handleReload}
                className={`${btn.base} ${btn.primary} flex-1 py-3 flex items-center justify-center gap-2`}
              >
                <RefreshCw size={16} />
                Reload App
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
