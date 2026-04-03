
import React, { useState, useRef } from 'react';

import { X, Download, Upload, Info, RefreshCw, Cloud, AlertTriangle, AlertCircle, ShieldCheck, LogOut, Settings, Cpu, CheckCircle2, Loader2, Database, ChevronDown, Trash2, Bell, BellOff } from 'lucide-react';

import { useExportImport } from '../hooks/useExportImport';
import { useEncryptionSettings } from '../hooks/useEncryptionSettings';
import { useSync } from '../hooks/useSync';
import { useAuth } from '../hooks/useAuth';
import { ModelStatus, EmbeddingStats } from '../hooks/useAdaptiveSearch';
import { factoryReset, forceReindexAll, ReconcileReport } from '../services/storageService';
import { btn, overlay } from '../styles/design-system';

// Props interface remains the same as all functionality is preserved
interface SettingsModalProps {
  onClose: () => void;
  availableTypes: string[];
  onImportSuccess?: () => void;
  appVersion: string | null;
  syncError: string | null;
  onSyncComplete?: () => void;
  modelStatus: ModelStatus;
  downloadProgress?: any;
  retryDownload: () => void;
  embeddingStats?: EmbeddingStats;
  retryFailedEmbeddings?: () => void;
  totalMemories: number;
  lastError?: string | null;
  closeWorkerDB?: () => void;
  rebuildIndex?: () => void;
  reconcileReport?: ReconcileReport | null;
  onUpdateReport?: (report: ReconcileReport) => void;
  notificationsSupported?: boolean;
  notificationsEnabled?: boolean;
  notificationPermission?: 'granted' | 'denied' | 'prompt';
  notificationTime?: string;
  onNotificationsEnabledChange?: (enabled: boolean) => Promise<void>;
  onNotificationTimeChange?: (time: string) => Promise<void>;
  onRequestNotificationPermission?: () => Promise<void>;
  onOpenNotificationSettings?: () => void;
}

// Helper components for the new UI structure
const SettingsCard: React.FC<{ title: string; icon: React.ElementType; children: React.ReactNode }> = ({ title, icon: Icon, children }) => (
  <div className="bg-(--color-surface-raised)/50 border border-(--color-border-default) rounded-(--radius-xl) overflow-hidden">
    <div className="p-4 border-b border-(--color-border-default) flex items-center gap-3 bg-(--color-surface-raised)/30">
      <Icon size={18} className="text-(--color-text-secondary)" />
      <h4 className="text-sm font-bold text-(--color-text-primary) uppercase tracking-wider">{title}</h4>
    </div>
    <div className="p-4 space-y-4">{children}</div>
  </div>
);

const SettingsRow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-2">{children}</div>
);

const SettingsInfo: React.FC<{ label: string; description: string }> = ({ label, description }) => (
  <div className="flex-1">
    <p className="text-sm font-medium text-(--color-text-primary)">{label}</p>
    <p className="text-xs text-(--color-text-secondary)">{description}</p>
  </div>
);

const ExpandableSection: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="bg-(--color-surface-overlay)/50 p-3 rounded-(--radius-lg) border border-(--color-border-subtle)">
      <button onClick={() => setIsOpen(!isOpen)} className="w-full flex items-center justify-between text-left">
        <span className="text-xs font-bold text-(--color-text-secondary)">Detailed Index Stats</span>
        <ChevronDown size={16} className={`text-(--color-text-secondary) transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen && (
        <div className="mt-3 pt-3 border-t border-(--color-border-subtle) animate-in fade-in duration-(--duration-normal)">
          {children}
        </div>
      )}
    </div>
  );
};

const FactoryResetModal: React.FC<{ isOpen: boolean; onClose: () => void; onConfirm: () => void; }> = ({ isOpen, onClose, onConfirm }) => {
    const [confirmationText, setConfirmationText] = useState('');
    if (!isOpen) return null;

    const isConfirmed = confirmationText === 'DELETE';

    return (
        <div className="absolute inset-0 z-(--z-dropdown) flex items-center justify-center bg-black/80 backdrop-blur-md animate-in fade-in duration-(--duration-normal) p-4">
            <div className="bg-(--color-danger)/20 border border-(--color-danger) rounded-(--radius-xl) max-w-sm w-full p-6 shadow-2xl text-center">
                <div className="w-14 h-14 bg-(--color-danger)/50 border-4 border-(--color-danger) rounded-full mx-auto flex items-center justify-center">
                    <AlertTriangle size={32} className="text-(--color-danger)" />
                </div>
                <h3 className="text-lg font-bold text-(--color-text-primary) mt-4">Confirm Factory Reset</h3>
                <p className="text-sm text-(--color-danger)/80 mt-2">
                    This action is irreversible. It will permanently delete all memories, settings, and the encryption key from this device.
                </p>
                <div className="my-4 text-left">
                    <label htmlFor="delete-confirm" className="text-xs font-bold text-(--color-danger)">
                        To confirm, please type <strong className="font-mono">DELETE</strong> below:
                    </label>
                    <input
                        id="delete-confirm"
                        type="text"
                        value={confirmationText}
                        onChange={(e) => setConfirmationText(e.target.value)}
                        className="w-full bg-(--color-danger)/50 border-2 border-(--color-danger) rounded-(--radius-lg) p-2 text-center font-mono tracking-widest text-(--color-text-primary) mt-1 focus:outline-none focus:border-(--color-danger) transition-colors"
                    />
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <button onClick={onClose} className={`${btn.base} ${btn.secondary}`}>
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={!isConfirmed}
                        className={`${btn.base} ${btn.danger} disabled:cursor-not-allowed`}
                    >
                        Delete All Data
                    </button>
                </div>
            </div>
        </div>
    );
};

const SettingsModal: React.FC<SettingsModalProps> = (props) => {
  const {
    onClose, onImportSuccess, appVersion,
    syncError, onSyncComplete, modelStatus, downloadProgress, retryDownload,
    embeddingStats, retryFailedEmbeddings, totalMemories, lastError, closeWorkerDB,
    rebuildIndex, onUpdateReport,
    notificationsSupported, notificationsEnabled, notificationPermission,
    notificationTime, onNotificationsEnabledChange, onNotificationTimeChange,
    onRequestNotificationPermission,
    onOpenNotificationSettings,
  } = props;
  
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [isReindexing, setIsReindexing] = useState(false);

  // All hooks and their logic are preserved from the original component
  const { sync, isSyncing } = useSync();
  const { authStatus, login, unlink } = useAuth();
  const { fileInputRef, handleExport, handleImportClick, handleImportFile } = useExportImport(onImportSuccess || (() => {}));
  const { handleDownloadKey, handleRestoreClick, handleRestoreFile, fileInputRef: keyInputRef } = useEncryptionSettings();

  const handleLinkDrive = () => { login(); };
  const handleSyncNow = async () => {
      try {
          await sync(true);
          if (onSyncComplete) onSyncComplete();
      } catch (e: any) { console.error("Sync failed:", e); }
  };
  const handleUnlink = () => { unlink(); };
  const handleForceReindex = async () => {
      if (isReindexing) return;
      setIsReindexing(true);
      try {
          const report = await forceReindexAll();
          // Rebuild the worker's in-memory Orama index so it reflects
          // the cleared vectors and picks up newly queued items.
          rebuildIndex?.();
          if (onUpdateReport) onUpdateReport(report);
      } catch (e) {
          console.error("Manual reindex failed", e);
      } finally {
          setIsReindexing(false);
      }
  };

  const handleFactoryResetConfirm = () => {
      closeWorkerDB?.();
      setTimeout(() => {
          factoryReset();
          setIsResetModalOpen(false);
      }, 100);
  };
  
  const statsReady = embeddingStats?.completed || 0;
  const statsPending = embeddingStats?.pending || 0;
  const statsFailed = embeddingStats?.failed || 0;

  return (
    <div className="fixed inset-0 z-(--z-sheet) flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in duration-(--duration-fast)">
      {/* Modal container: Use calc with safe-area for Safari incognito compatibility */}
      <div className="bg-black border border-(--color-border-default) rounded-t-(--radius-xl) sm:rounded-(--radius-xl) max-w-2xl w-full shadow-2xl relative flex flex-col overflow-hidden animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-(--duration-fast)"
           style={{ maxHeight: 'calc(100dvh - var(--sat) - var(--sab) - 16px)' }}>
        <div className="p-4 sm:p-6 border-b border-(--color-border-default) flex items-center justify-between shrink-0 bg-black z-(--z-sticky) pt-[max(16px,var(--sat))] sm:pt-6">
          <div className="flex items-center gap-3">
             <div className="w-10 h-10 bg-(--color-surface-raised) rounded-(--radius-xl) flex items-center justify-center text-(--color-text-secondary) shrink-0"><Settings size={20} /></div>
             <div>
               <h3 className="text-lg font-bold text-(--color-text-primary) leading-tight">Settings</h3>
               <p className="text-(--color-text-secondary) text-xs hidden sm:block">Manage your data, AI, and security preferences</p>
             </div>
          </div>
          <button onClick={onClose} className={overlay.closeBtnRight}>
             <X size={24} />
          </button>
        </div>

        <div className="overflow-y-auto p-4 sm:p-6 flex-1 space-y-6 overscroll-contain" style={{ paddingBottom: 'max(24px, var(--sab))' }}>


          {(syncError || modelStatus === 'error') && (
            <div className="space-y-3">
              {syncError && (
                <div className="flex items-start gap-3 p-3 bg-(--color-danger)/30 border border-(--color-danger)/60 rounded-(--radius-xl)">
                  <AlertCircle size={18} className="text-(--color-danger) shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-(--color-danger)">Google Drive Sync Error</p>
                    <p className="text-xs text-(--color-danger)/80 mt-0.5 break-words">{syncError}</p>
                  </div>
                  <button onClick={handleSyncNow} disabled={isSyncing} className={`${btn.base} ${btn.dangerSm} shrink-0 gap-1.5`}>
                    {isSyncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Retry Sync
                  </button>
                </div>
              )}
              {modelStatus === 'error' && (
                <div className="flex items-start gap-3 p-3 bg-(--color-warning)/30 border border-(--color-warning)/60 rounded-(--radius-xl)">
                  <AlertTriangle size={18} className="text-(--color-warning) shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-(--color-warning)">AI Model Download Error</p>
                    <p className="text-xs text-(--color-warning)/80 mt-0.5 break-words">{lastError || 'The local AI model failed to load. Offline search is unavailable.'}</p>
                  </div>
                  <button onClick={retryDownload} className={`${btn.base} ${btn.warningSm} shrink-0 gap-1.5`}>
                    <RefreshCw size={14} /> Retry
                  </button>
                </div>
              )}
            </div>
          )}


          <SettingsCard title="AI & Index" icon={Cpu}>
            <SettingsRow>
               <SettingsInfo label="Local AI Index" description="On-device model for offline search capabilities." />
               <div className="flex items-center gap-2">


                 <span className={`text-xs px-2 py-1 rounded-(--radius-md) font-medium ${modelStatus === 'ready' ? 'bg-(--color-success)/30 text-(--color-success)' : modelStatus === 'error' ? 'bg-(--color-danger)/30 text-(--color-danger)' : 'bg-(--color-warning)/30 text-(--color-warning)'}`}>{modelStatus}</span>

                 <button onClick={handleForceReindex} disabled={isReindexing} className={`${btn.base} ${btn.secondarySm} gap-1.5`}>
                    {isReindexing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Re-index
                 </button>
               </div>
            </SettingsRow>
            <ExpandableSection>
                {lastError && <p className="text-xs text-(--color-danger) bg-(--color-danger)/20 p-2 rounded-(--radius-md) mb-2">{lastError}</p>}
                {modelStatus === 'downloading' && (
                    <div className="space-y-1 mb-2">
                        <div className="flex justify-between text-xs text-(--color-text-secondary)"><span>Downloading...</span><span>{downloadProgress ? Math.round(downloadProgress.progress || 0) : 0}%</span></div>
                        <div className="h-1 w-full bg-(--color-surface-raised) rounded-full"><div className="h-full bg-(--color-accent) rounded-full" style={{ width: `${downloadProgress?.progress || 0}%` }}></div></div>
                    </div>
                )}
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="bg-(--color-surface-raised)/50 p-2 rounded-(--radius-lg)"><span className="block font-bold text-lg text-(--color-success)">{statsReady}</span><span className="text-(--color-text-secondary)">Ready</span></div>
                    <div className="bg-(--color-surface-raised)/50 p-2 rounded-(--radius-lg)"><span className="block font-bold text-lg text-(--color-accent)">{statsPending}</span><span className="text-(--color-text-secondary)">Pending</span></div>
                    <div className="bg-(--color-surface-raised)/50 p-2 rounded-(--radius-lg)"><span className="block font-bold text-lg text-(--color-danger)">{statsFailed}</span><span className="text-(--color-text-secondary)">Failed</span></div>
                </div>
                 {statsFailed > 0 && retryFailedEmbeddings && (
                    <button onClick={retryFailedEmbeddings} className={`${btn.base} ${btn.dangerSm} w-full mt-2 bg-(--color-danger)/30 hover:bg-(--color-danger)/40 text-(--color-danger)`}>Retry {statsFailed} Failed Items</button>
                )}
            </ExpandableSection>
          </SettingsCard>

          {notificationsSupported && (
            <SettingsCard title="Notifications" icon={Bell}>
              <SettingsRow>
                <SettingsInfo label="Morning Briefing" description="Get a daily summary of your events and tasks." />
                <button
                  onClick={() => onNotificationsEnabledChange?.(!notificationsEnabled)}
                  className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${notificationsEnabled ? 'bg-(--color-accent)' : 'bg-(--color-surface-raised)'}`}
                >
                  <span className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${notificationsEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </SettingsRow>
              {notificationsEnabled && notificationPermission === 'granted' && (
                <SettingsRow>
                  <SettingsInfo label="Notification Time" description="When to receive your daily briefing." />
                  <input
                    type="time"
                    value={notificationTime || '07:00'}
                    onChange={(e) => onNotificationTimeChange?.(e.target.value)}
                    className="bg-(--color-surface-raised) border border-(--color-border-default) rounded-(--radius-lg) px-3 py-1.5 text-sm text-(--color-text-primary) focus:outline-none focus:border-(--color-accent) transition-colors"
                  />
                </SettingsRow>
              )}
              {notificationPermission === 'denied' && (
                <div className="flex items-start gap-2 p-3 bg-(--color-warning)/30 border border-(--color-warning)/60 rounded-(--radius-xl)">
                  <BellOff size={16} className="text-(--color-warning) shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-xs text-(--color-warning)">Notifications are blocked. Enable them in your device settings to receive morning briefings.</p>
                    {onOpenNotificationSettings && (
                      <button
                        onClick={onOpenNotificationSettings}
                        className="mt-1.5 text-xs font-medium text-(--color-accent) hover:text-(--color-accent-hover) transition-colors duration-(--duration-fast)"
                      >
                        Open Notification Settings
                      </button>
                    )}
                  </div>
                </div>
              )}
            </SettingsCard>
          )}

          <SettingsCard title="Data & Sync" icon={Database}>
            <SettingsRow>
              <SettingsInfo label="Google Drive Sync" description="Securely syncs encrypted data across devices." />
              {authStatus === 'linked' ? (
                <div className="flex items-center gap-2">
                  <button onClick={handleSyncNow} disabled={isSyncing} className={`${btn.base} ${btn.primarySm} gap-1.5`}>{isSyncing ? <Loader2 size={14} className="animate-spin"/> : <RefreshCw size={14} />} Sync Now</button>
                  <button onClick={handleUnlink} className={`${btn.base} ${btn.secondarySm}`}>Unlink</button>
                </div>
              ) : (
                <button onClick={handleLinkDrive} disabled={authStatus === 'authenticating'} className={`${btn.base} ${btn.primarySm}`}>Connect</button>
              )}
            </SettingsRow>
            <SettingsRow>
                <SettingsInfo label="Manual Backup & Restore" description="Export or import all memories from a file." />
                <div className="flex items-center gap-2 shrink-0">
                    <button onClick={handleExport} className={`${btn.base} ${btn.secondarySm} gap-1.5`}><Download size={14} /> Export</button>
                    <button onClick={handleImportClick} className={`${btn.base} ${btn.secondarySm} gap-1.5`}><Upload size={14} /> Import</button>
                </div>
            </SettingsRow>
          </SettingsCard>

          <SettingsCard title="Security" icon={ShieldCheck}>
             <SettingsRow>
                <SettingsInfo label="Device Storage Encryption" description="Data is encrypted with a key stored only on this device." />
                 <span className="flex items-center gap-1.5 text-xs text-(--color-success) bg-(--color-success)/30 px-2 py-1 rounded-(--radius-md)"><CheckCircle2 size={14} /> Active</span>
            </SettingsRow>
             <SettingsRow>
                <SettingsInfo label="Encryption Key" description="Back up your key to prevent permanent data loss." />
                 <div className="flex items-center gap-2 shrink-0">
                    <button onClick={handleDownloadKey} className={`${btn.base} ${btn.secondarySm} gap-1.5`}><Download size={14} /> Backup Key</button>
                    <button onClick={handleRestoreClick} className={`${btn.base} ${btn.secondarySm} gap-1.5`}><Upload size={14} /> Restore Key</button>
                </div>
            </SettingsRow>
          </SettingsCard>

          <div className="border-t border-(--color-danger)/50 pt-6 pb-6">
            <SettingsCard title="Danger Zone" icon={AlertTriangle}>
                <SettingsRow>
                    <SettingsInfo label="Factory Reset" description="Permanently erases all data and resets the application." />
                    <button onClick={() => setIsResetModalOpen(true)} className={`${btn.base} ${btn.danger} gap-2 text-sm`}>
                        <Trash2 size={16} /> Wipe All Data
                    </button>
                </SettingsRow>
            </SettingsCard>
          </div>
        </div>
        
        {appVersion && <div className="text-center py-2 border-t border-(--color-border-default) text-xs font-mono text-(--color-text-tertiary) shrink-0 bg-black">Version: {appVersion}</div>}
        
        <FactoryResetModal 
            isOpen={isResetModalOpen}
            onClose={() => setIsResetModalOpen(false)}
            onConfirm={handleFactoryResetConfirm}
        />

        <input type="file" ref={fileInputRef} onChange={handleImportFile} className="hidden" accept=".csv,application/json" />
        <input type="file" ref={keyInputRef} onChange={handleRestoreFile} className="hidden" accept=".json" />
      </div>
    </div>
  );
};

export default SettingsModal;
