
import React, { useState, useRef } from 'react';

import { X, Download, Upload, Info, RefreshCw, Cloud, AlertTriangle, AlertCircle, ShieldCheck, LogOut, Settings, Cpu, CheckCircle2, Loader2, Database, ChevronDown, Trash2 } from 'lucide-react';

import { useExportImport } from '../hooks/useExportImport';
import { useEncryptionSettings } from '../hooks/useEncryptionSettings';
import { useSync } from '../hooks/useSync';
import { useAuth } from '../hooks/useAuth';
import { ModelStatus, EmbeddingStats } from '../hooks/useAdaptiveSearch';
import { factoryReset, forceReindexAll, ReconcileReport } from '../services/storageService';

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
  reconcileReport?: ReconcileReport | null;
  onUpdateReport?: (report: ReconcileReport) => void;
}

// Helper components for the new UI structure
const SettingsCard: React.FC<{ title: string; icon: React.ElementType; children: React.ReactNode }> = ({ title, icon: Icon, children }) => (
  <div className="bg-gray-800/50 border border-gray-700 rounded-2xl overflow-hidden">
    <div className="p-4 border-b border-gray-700 flex items-center gap-3 bg-gray-800/30">
      <Icon size={18} className="text-gray-400" />
      <h4 className="text-sm font-bold text-gray-200 uppercase tracking-wider">{title}</h4>
    </div>
    <div className="p-4 space-y-4">{children}</div>
  </div>
);

const SettingsRow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-2">{children}</div>
);

const SettingsInfo: React.FC<{ label: string; description: string }> = ({ label, description }) => (
  <div className="flex-1">
    <p className="text-sm font-medium text-gray-100">{label}</p>
    <p className="text-xs text-gray-400">{description}</p>
  </div>
);

const ExpandableSection: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="bg-gray-900/50 p-3 rounded-lg border border-gray-700/50">
      <button onClick={() => setIsOpen(!isOpen)} className="w-full flex items-center justify-between text-left">
        <span className="text-xs font-bold text-gray-300">Detailed Index Stats</span>
        <ChevronDown size={16} className={`text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen && (
        <div className="mt-3 pt-3 border-t border-gray-700/50 animate-in fade-in duration-300">
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
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-gray-900/80 backdrop-blur-md animate-in fade-in duration-300 p-4">
            <div className="bg-red-900/20 border border-red-800 rounded-2xl max-w-sm w-full p-6 shadow-2xl text-center">
                <div className="w-14 h-14 bg-red-900/50 border-4 border-red-800 rounded-full mx-auto flex items-center justify-center">
                    <AlertTriangle size={32} className="text-red-300" />
                </div>
                <h3 className="text-lg font-bold text-white mt-4">Confirm Factory Reset</h3>
                <p className="text-sm text-red-200/80 mt-2">
                    This action is irreversible. It will permanently delete all memories, settings, and the encryption key from this device.
                </p>
                <div className="my-4 text-left">
                    <label htmlFor="delete-confirm" className="text-xs font-bold text-red-200">
                        To confirm, please type <strong className="font-mono">DELETE</strong> below:
                    </label>
                    <input
                        id="delete-confirm"
                        type="text"
                        value={confirmationText}
                        onChange={(e) => setConfirmationText(e.target.value)}
                        className="w-full bg-red-950/50 border-2 border-red-800 rounded-lg p-2 text-center font-mono tracking-widest text-white mt-1 focus:outline-none focus:border-red-600 transition-colors"
                    />
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <button onClick={onClose} className="px-4 py-2.5 bg-gray-700 hover:bg-gray-600 text-white font-bold rounded-lg transition-colors">
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={!isConfirmed}
                        className="px-4 py-2.5 bg-red-600 hover:bg-red-500 text-white font-bold rounded-lg transition-colors disabled:bg-red-800 disabled:text-red-500 disabled:cursor-not-allowed"
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
    onUpdateReport
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
          await sync();
          if (onSyncComplete) onSyncComplete();
      } catch (e: any) { console.error("Sync failed:", e); }
  };
  const handleUnlink = () => { unlink(); };
  const handleForceReindex = async () => {
      if (isReindexing) return;
      setIsReindexing(true);
      try {
          const report = await forceReindexAll();
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
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in duration-200">
      {/* Modal container: Use calc with safe-area for Safari incognito compatibility */}
      <div className="bg-gray-900 border border-gray-700 rounded-t-3xl sm:rounded-3xl max-w-2xl w-full shadow-2xl relative flex flex-col overflow-hidden animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-200"
           style={{ maxHeight: 'calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 16px)' }}>
        <div className="p-4 sm:p-6 border-b border-gray-700 flex items-center justify-between shrink-0 bg-gray-900 z-10 pt-[max(16px,env(safe-area-inset-top))] sm:pt-6">
          <div className="flex items-center gap-3">
             <div className="w-10 h-10 bg-gray-800 rounded-xl flex items-center justify-center text-gray-300 shrink-0"><Settings size={20} /></div>
             <div>
               <h3 className="text-lg font-bold text-white leading-tight">Settings</h3>
               <p className="text-gray-400 text-xs hidden sm:block">Manage your data, AI, and security preferences</p>
             </div>
          </div>
          <button onClick={onClose} className="p-2 -mr-2 text-gray-400 hover:text-white transition-colors hover:bg-gray-800 rounded-full active:scale-95">
             <X size={24} />
          </button>
        </div>

        <div className="overflow-y-auto p-4 sm:p-6 flex-1 space-y-6 overscroll-contain" style={{ paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}>


          {(syncError || modelStatus === 'error') && (
            <div className="space-y-3">
              {syncError && (
                <div className="flex items-start gap-3 p-3 bg-red-900/30 border border-red-800/60 rounded-xl">
                  <AlertCircle size={18} className="text-red-400 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-red-300">Google Drive Sync Error</p>
                    <p className="text-xs text-red-400/80 mt-0.5 break-words">{syncError}</p>
                  </div>
                  <button onClick={handleSyncNow} disabled={isSyncing} className="px-3 py-1.5 text-xs bg-red-800 hover:bg-red-700 text-white font-bold rounded-lg transition-colors shrink-0 flex items-center gap-1.5 disabled:opacity-50 active:scale-95">
                    {isSyncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Retry Sync
                  </button>
                </div>
              )}
              {modelStatus === 'error' && (
                <div className="flex items-start gap-3 p-3 bg-amber-900/30 border border-amber-800/60 rounded-xl">
                  <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-amber-300">AI Model Download Error</p>
                    <p className="text-xs text-amber-400/80 mt-0.5 break-words">{lastError || 'The local AI model failed to load. Offline search is unavailable.'}</p>
                  </div>
                  <button onClick={retryDownload} className="px-3 py-1.5 text-xs bg-amber-800 hover:bg-amber-700 text-white font-bold rounded-lg transition-colors shrink-0 flex items-center gap-1.5 active:scale-95">
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


                 <span className={`text-xs px-2 py-1 rounded-md font-medium ${modelStatus === 'ready' ? 'bg-green-900/30 text-green-400' : modelStatus === 'error' ? 'bg-red-900/30 text-red-400' : 'bg-yellow-900/30 text-yellow-400'}`}>{modelStatus}</span>

                 <button onClick={handleForceReindex} disabled={isReindexing} className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1.5 active:scale-95">
                    {isReindexing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Re-index
                 </button>
               </div>
            </SettingsRow>
            <ExpandableSection>
                {lastError && <p className="text-xs text-red-400 bg-red-900/20 p-2 rounded-md mb-2">{lastError}</p>}
                {modelStatus === 'downloading' && (
                    <div className="space-y-1 mb-2">
                        <div className="flex justify-between text-xs text-gray-400"><span>Downloading...</span><span>{downloadProgress ? Math.round(downloadProgress.progress || 0) : 0}%</span></div>
                        <div className="h-1 w-full bg-gray-700 rounded-full"><div className="h-full bg-blue-500 rounded-full" style={{ width: `${downloadProgress?.progress || 0}%` }}></div></div>
                    </div>
                )}
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="bg-gray-800/50 p-2 rounded-lg"><span className="block font-bold text-lg text-green-400">{statsReady}</span><span className="text-gray-400">Ready</span></div>
                    <div className="bg-gray-800/50 p-2 rounded-lg"><span className="block font-bold text-lg text-blue-400">{statsPending}</span><span className="text-gray-400">Pending</span></div>
                    <div className="bg-gray-800/50 p-2 rounded-lg"><span className="block font-bold text-lg text-red-400">{statsFailed}</span><span className="text-gray-400">Failed</span></div>
                </div>
                 {statsFailed > 0 && retryFailedEmbeddings && (
                    <button onClick={retryFailedEmbeddings} className="w-full mt-2 text-xs py-1.5 bg-red-900/30 hover:bg-red-900/40 text-red-300 rounded-lg transition-colors active:scale-95">Retry {statsFailed} Failed Items</button>
                )}
            </ExpandableSection>
          </SettingsCard>

          <SettingsCard title="Data & Sync" icon={Database}>
            <SettingsRow>
              <SettingsInfo label="Google Drive Sync" description="Securely syncs encrypted data across devices." />
              {authStatus === 'linked' ? (
                <div className="flex items-center gap-2">
                  <button onClick={handleSyncNow} disabled={isSyncing} className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50 active:scale-95">{isSyncing ? <Loader2 size={14} className="animate-spin"/> : <RefreshCw size={14} />} Sync Now</button>
                  <button onClick={handleUnlink} className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-lg transition-colors active:scale-95">Unlink</button>
                </div>
              ) : (
                <button onClick={handleLinkDrive} disabled={authStatus === 'authenticating'} className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg transition-colors disabled:opacity-50 active:scale-95">Connect</button>
              )}
            </SettingsRow>
            <SettingsRow>
                <SettingsInfo label="Manual Backup & Restore" description="Export or import all memories from a file." />
                <div className="flex items-center gap-2 shrink-0">
                    <button onClick={handleExport} className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-lg transition-colors flex items-center gap-1.5 active:scale-95"><Download size={14} /> Export</button>
                    <button onClick={handleImportClick} className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-lg transition-colors flex items-center gap-1.5 active:scale-95"><Upload size={14} /> Import</button>
                </div>
            </SettingsRow>
          </SettingsCard>

          <SettingsCard title="Security" icon={ShieldCheck}>
             <SettingsRow>
                <SettingsInfo label="Device Storage Encryption" description="Data is encrypted with a key stored only on this device." />
                 <span className="flex items-center gap-1.5 text-xs text-green-400 bg-green-900/30 px-2 py-1 rounded-md"><CheckCircle2 size={14} /> Active</span>
            </SettingsRow>
             <SettingsRow>
                <SettingsInfo label="Encryption Key" description="Back up your key to prevent permanent data loss." />
                 <div className="flex items-center gap-2 shrink-0">
                    <button onClick={handleDownloadKey} className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-lg transition-colors flex items-center gap-1.5 active:scale-95"><Download size={14} /> Backup Key</button>
                    <button onClick={handleRestoreClick} className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-lg transition-colors flex items-center gap-1.5 active:scale-95"><Upload size={14} /> Restore Key</button>
                </div>
            </SettingsRow>
          </SettingsCard>

          <div className="border-t border-red-900/50 pt-6 pb-6">
            <SettingsCard title="Danger Zone" icon={AlertTriangle}>
                <SettingsRow>
                    <SettingsInfo label="Factory Reset" description="Permanently erases all data and resets the application." />
                    <button onClick={() => setIsResetModalOpen(true)} className="px-4 py-2 text-sm bg-red-800 hover:bg-red-700 text-white font-bold rounded-lg transition-colors flex items-center gap-2 active:scale-95">
                        <Trash2 size={16} /> Wipe All Data
                    </button>
                </SettingsRow>
            </SettingsCard>
          </div>
        </div>
        
        {appVersion && <div className="text-center py-2 border-t border-gray-700 text-[10px] font-mono text-gray-500 shrink-0 bg-gray-900">Version: {appVersion}</div>}
        
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
