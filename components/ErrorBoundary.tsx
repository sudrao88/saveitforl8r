import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { btn, overlay, text, zIndex } from '../styles/design-system';

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
    if (this.isChunkLoadError(this.state.error)) {
      try {
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((key) => caches.delete(key)));
        }
      } catch {
        // Best-effort — proceed with reload even if cache clearing fails
      }
    }
    window.location.reload();
  };

  private isChunkLoadError(error: Error | null): boolean {
    if (!error) return false;
    const msg = error.message.toLowerCase();
    return (
      msg.includes('failed to fetch dynamically imported module') ||
      msg.includes('importing a module script failed') ||
      msg.includes('loading chunk') ||
      msg.includes('loading css chunk')
    );
  }

  handleDismiss = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      const title = this.props.fallbackTitle || 'Something went wrong';
      const message = this.props.fallbackMessage || 'An unexpected error occurred. Your data is safe — try reloading the app.';

      return (
        <div className={`fixed inset-0 bg-gray-900 flex items-center justify-center ${zIndex.tooltip} p-6`}>
          <div className={`${overlay.modal} max-w-md w-full p-8 text-center`}>
            <div className="w-14 h-14 mx-auto mb-5 bg-red-900/30 rounded-2xl flex items-center justify-center">
              <AlertTriangle size={28} className="text-red-400" />
            </div>
            <h2 className={`${text.heading} text-xl mb-2`}>{title}</h2>
            <p className={`${text.body} mb-6 leading-relaxed`}>{message}</p>
            {this.state.error && (
              <pre className={`${text.caption} bg-gray-900 rounded-lg p-3 mb-6 text-left overflow-auto max-h-32 border border-gray-700`}>
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
