import React from 'react';
import { Settings, Search, RefreshCw, AlertCircle, Download, AlertTriangle, Loader2 } from 'lucide-react';
import { Logo } from './icons';
import { ViewMode } from '../types';
import { ModelStatus } from '../hooks/useAdaptiveSearch';
import { btn } from '../styles/design-system';

interface TopNavigationProps {
  setView: (view: ViewMode) => void;
  resetFilters: () => void;
  onSettingsClick: () => void;
  updateAvailable: boolean;
  onUpdateApp: () => void;
  syncError: boolean;
  isSyncingDownload: boolean;
  modelStatus: ModelStatus;
  isOtaDownloading?: boolean;
}

const TopNavigation = React.forwardRef<HTMLElement, TopNavigationProps>(({
    setView,
    resetFilters,
    onSettingsClick,
    updateAvailable,
    onUpdateApp,
    syncError,
    isSyncingDownload,
    modelStatus,
    isOtaDownloading
}, ref) => {
  return (
    <nav ref={ref} className="px-4 py-3 sm:px-8 flex justify-center">
      <div className="w-full max-w-4xl flex items-center justify-between gap-4">
        <div 
            className="flex items-center gap-3 text-(--color-accent) shrink-0 cursor-pointer group active:scale-95 transition-transform"
            onClick={() => {
                resetFilters();
                setView(ViewMode.FEED);
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
        >
          <Logo className="w-8 h-8 rounded-(--radius-lg) shadow-sm group-hover:scale-105 transition-transform" />
          <span className="hidden sm:inline font-brand text-xl font-bold tracking-tight text-(--color-text-primary)">
            SaveItFor<span className="text-(--color-accent)">L8R</span>
          </span>
        </div>

        <div className="flex items-center gap-2">
           {updateAvailable && (
               <button
                onClick={onUpdateApp}
                disabled={isOtaDownloading}
                className={`flex items-center gap-2 border transition-all rounded-(--radius-xl) px-4 py-2.5 group ${
                  isOtaDownloading
                    ? 'bg-(--color-surface-raised) border-(--color-border-default) text-(--color-text-tertiary) cursor-not-allowed'
                    : 'bg-(--color-danger)/20 hover:bg-(--color-danger)/30 border-(--color-danger)/50 hover:border-(--color-danger) text-(--color-danger) hover:text-(--color-danger) animate-pulse active:scale-95'
                }`}
               >
                   {isOtaDownloading ? (
                     <Loader2 size={18} className="animate-spin" />
                   ) : (
                     <RefreshCw size={18} className="text-(--color-danger)" />
                   )}
                   <span className="font-bold text-sm">{isOtaDownloading ? 'Updating...' : 'Update'}</span>
               </button>
           )}

          <button
            onClick={() => setView(ViewMode.RECALL)}
            className={`${btn.base} ${btn.secondary} group touch-manipulation`}
          >
            <Search size={18} className="text-(--color-text-tertiary) group-hover:text-(--color-accent)" />
            <span className="font-medium text-sm">Search</span>
          </button>

          <button
            onClick={onSettingsClick}
            className={`relative ${btn.base} ${btn.iconLg} bg-(--color-surface-raised) border border-(--color-border-default) hover:bg-white/5 hover:border-(--color-accent) group shrink-0 touch-manipulation`}
            title="Settings"
          >
            {isSyncingDownload ? (
                <RefreshCw size={20} className="text-(--color-accent) animate-spin" />
            ) : modelStatus === 'downloading' ? (
                <Loader2 size={20} className="text-(--color-accent) animate-spin" />
            ) : syncError ? (
                <AlertCircle size={20} className="text-(--color-danger)" />
            ) : modelStatus === 'error' ? (
                <AlertTriangle size={20} className="text-(--color-danger)" />
            ) : (
                <Settings size={20} className="text-(--color-text-tertiary) group-hover:text-(--color-text-primary) group-hover:rotate-90 transition-transform duration-(--duration-normal)" />
            )}
            
            {(syncError || modelStatus === 'error') && !isSyncingDownload && modelStatus !== 'downloading' && (
                <span className="absolute -top-1 -right-1 flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-(--color-danger) opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-(--color-danger)"></span>
                </span>
            )}
          </button>
        </div>
      </div>
    </nav>
  );
});

TopNavigation.displayName = 'TopNavigation';

export default TopNavigation;
