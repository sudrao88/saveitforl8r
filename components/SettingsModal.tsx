import React, { useState, useEffect } from 'react';
import { X, Key, Download, Upload, Info, RefreshCw, Cloud, AlertTriangle, ShieldCheck, LogOut, Settings, Cpu, CheckCircle2, Loader2, Database, FileQuestion } from 'lucide-react';
import { useExportImport } from '../hooks/useExportImport';
import { useEncryptionSettings } from '../hooks/useEncryptionSettings';
import MultiSelect from './MultiSelect';
import { useSync } from '../hooks/useSync';
import { useAuth } from '../hooks/useAuth';
import { ModelStatus, EmbeddingStats } from '../hooks/useAdaptiveSearch';

interface SettingsModalProps {
  onClose: () => void;
  clearKey: () => void;
  availableTypes: string[];
  onImportSuccess?: () => void;
  appVersion: string | null;
  hasApiKey: boolean;
  onAddApiKey: () => void;
  syncError: boolean;
  onSyncComplete?: () => void;
  modelStatus: ModelStatus;
  downloadProgress?: any;
  retryDownload: () => void;
  embeddingStats?: EmbeddingStats;
  retryFailedEmbeddings?: () => void;
  totalMemories: number;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ 
    onClose, 
    clearKey, 
    availableTypes, 
    onImportSuccess, 
    appVersion,
    hasApiKey,
    onAddApiKey,
    syncError,
    onSyncComplete,
    modelStatus,
    downloadProgress,
    retryDownload,
    embeddingStats,
    retryFailedEmbeddings,
    totalMemories
}) => {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const { sync, isSyncing } = useSync();
  const { authStatus, login, unlink } = useAuth();

  const handleLinkDrive = () => {
      login();
  };

  const handleSyncNow = async () => {
      try {
          await sync(true); // Force full sync check
          if (onSyncComplete) onSyncComplete();
      } catch (e: any) {
          console.error("Sync failed:", e);
      }
  };

  const handleUnlink = () => {
      unlink();
  };

  const {
    exportSelectedTypes,
    setExportSelectedTypes,
    fileInputRef,
    handleExport,
    handleImportClick,
    handleImportFile
  } = useExportImport(onImportSuccess || (() => {}));

  const {
    handleDownloadKey,
    handleRestoreClick,
    handleRestoreFile,
    fileInputRef: keyInputRef
  } = useEncryptionSettings();

  // Calculate Waiting/Not Enriched count
  const statsReady = embeddingStats?.completed || 0;
  const statsPending = embeddingStats?.pending || 0;
  const statsFailed = embeddingStats?.failed || 0;
  // Ensure non-negative
  const waitingForEnrichment = Math.max(0, totalMemories - (statsReady + statsPending + statsFailed));

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-gray-800 border border-gray-700 rounded-3xl p-6 max-w-md w-full shadow-2xl relative max-h-[85vh] overflow-y-auto">
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors">
          <X size={20} />
        </button>

        <div className="flex flex-col text-left">
            {/* Header */}
            <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 bg-gray-700/50 rounded-2xl flex items-center justify-center text-gray-300">
                    <Settings size={24} />
                </div>
                <div>
                    <h3 className="text-xl font-bold text-white">Settings</h3>
                    <p className="text-gray-400 text-sm">Manage your data and preferences</p>
                    {appVersion && (
                        <span className="inline-block mt-1 px-2 py-0.5 rounded-md bg-gray-700 text-[10px] font-mono text-gray-400 border border-gray-600">
                            {appVersion}
                        </span>
                    )}
                </div>
            </div>

            <div className="space-y-6">

                {/* Local AI Model Status */}
                <div className="space-y-3">
                    <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Offline AI</h4>
                    <div className="bg-gray-700/30 p-4 rounded-2xl border border-gray-700 space-y-4">
                         <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Cpu size={20} className={modelStatus === 'ready' ? "text-green-400" : "text-gray-400"} />
                                <span className="text-sm font-medium text-gray-200">Local Search Model</span>
                            </div>
                            {modelStatus === 'ready' && (
                                <CheckCircle2 size={18} className="text-green-400" />
                            )}
                         </div>

                         {modelStatus === 'downloading' && (
                             <div className="space-y-2">
                                <div className="flex justify-between text-xs text-gray-400">
                                    <span>Downloading...</span>
                                    <span>{downloadProgress ? Math.round(downloadProgress.progress || 0) : 0}%</span>
                                </div>
                                <div className="h-1.5 w-full bg-gray-700 rounded-full overflow-hidden">
                                    <div 
                                        className="h-full bg-blue-500 rounded-full transition-all duration-300" 
                                        style={{ width: `${downloadProgress ? downloadProgress.progress : 0}%` }}
                                    ></div>
                                </div>
                             </div>
                         )}

                         {modelStatus === 'error' && (
                             <div className="flex items-center justify-between">
                                 <span className="text-xs text-red-400 flex items-center gap-1">
                                     <AlertTriangle size={12} /> Download Failed
                                 </span>
                                 <button 
                                    onClick={retryDownload}
                                    className="text-xs px-2 py-1 bg-red-900/20 text-red-400 hover:text-red-300 border border-red-900/50 rounded-lg"
                                 >
                                     Retry
                                 </button>
                             </div>
                         )}
                         
                         {modelStatus === 'idle' && (
                             <div className="text-xs text-gray-500">
                                 Initializing...
                             </div>
                         )}
                         
                         {/* Embedding Stats Section */}
                         {modelStatus === 'ready' && embeddingStats && (
                             <div className="pt-3 border-t border-gray-700/50 space-y-2">
                                 <div className="flex items-center justify-between mb-2">
                                     <div className="flex items-center gap-2">
                                        <Database size={14} className="text-gray-400" />
                                        <span className="text-xs font-bold text-gray-300 uppercase tracking-wide">Index Status</span>
                                     </div>
                                     <span className="text-[10px] text-gray-500">
                                         {totalMemories} Total Notes
                                     </span>
                                 </div>
                                 
                                 <div className="grid grid-cols-4 gap-2">
                                     <div className="bg-gray-800/50 p-2 rounded-lg border border-gray-700/50 flex flex-col items-center">
                                         <span className="text-lg font-bold text-green-400">{statsReady}</span>
                                         <span className="text-[9px] text-gray-500 uppercase">Ready</span>
                                     </div>
                                     <div className="bg-gray-800/50 p-2 rounded-lg border border-gray-700/50 flex flex-col items-center relative overflow-hidden">
                                         {statsPending > 0 && (
                                             <div className="absolute inset-0 bg-blue-500/10 animate-pulse"></div>
                                         )}
                                         <span className={`text-lg font-bold ${statsPending > 0 ? 'text-blue-400' : 'text-gray-400'}`}>
                                             {statsPending}
                                         </span>
                                         <span className="text-[9px] text-gray-500 uppercase flex items-center gap-1">
                                             {statsPending > 0 && <Loader2 size={8} className="animate-spin" />}
                                             Queue
                                         </span>
                                     </div>
                                     <div className="bg-gray-800/50 p-2 rounded-lg border border-gray-700/50 flex flex-col items-center">
                                         <span className={`text-lg font-bold ${statsFailed > 0 ? 'text-red-400' : 'text-gray-400'}`}>
                                             {statsFailed}
                                         </span>
                                         <span className="text-[9px] text-gray-500 uppercase">Failed</span>
                                     </div>
                                     <div className="bg-gray-800/50 p-2 rounded-lg border border-gray-700/50 flex flex-col items-center" title="Waiting for Enrichment">
                                         <span className="text-lg font-bold text-gray-500">{waitingForEnrichment}</span>
                                         <span className="text-[9px] text-gray-600 uppercase flex items-center gap-1">
                                             <FileQuestion size={8} /> Wait
                                         </span>
                                     </div>
                                 </div>

                                 {statsFailed > 0 && retryFailedEmbeddings && (
                                     <button 
                                        onClick={retryFailedEmbeddings}
                                        className="w-full mt-2 flex items-center justify-center gap-2 text-xs py-1.5 bg-red-900/20 hover:bg-red-900/30 text-red-400 border border-red-900/50 rounded-lg transition-colors"
                                     >
                                         <RefreshCw size={12} /> Retry Failed Items
                                     </button>
                                 )}

                                 {statsPending === 0 && statsFailed === 0 && waitingForEnrichment === 0 && statsReady > 0 && (
                                     <div className="flex items-center gap-1.5 text-[10px] text-green-500/80 justify-center bg-green-900/10 py-1 rounded-md">
                                         <CheckCircle2 size={10} />
                                         All memories indexed
                                     </div>
                                 )}
                             </div>
                         )}
                    </div>
                </div>
                
                {/* Cloud Sync Section */}
                <div className="space-y-3">
                    <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Cloud Sync</h4>
                    <div className="bg-gray-700/30 p-4 rounded-2xl border border-gray-700 space-y-4">
                        {authStatus === 'linked' ? (
                            <div className="flex flex-col gap-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        {syncError ? (
                                            <>
                                                <AlertTriangle size={20} className="text-yellow-500" />
                                                <span className="text-sm font-medium text-yellow-500">Sync Paused</span>
                                            </>
                                        ) : (
                                            <>
                                                <Cloud size={20} className="text-green-400" />
                                                <span className="text-sm font-medium text-green-400">Google Drive Linked</span>
                                            </>
                                        )}
                                    </div>
                                    <button onClick={handleUnlink} className="text-xs text-red-400 hover:text-red-300 underline">Unlink</button>
                                </div>
                                
                                <button 
                                    onClick={handleSyncNow}
                                    disabled={isSyncing}
                                    className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-medium transition-colors border group ${
                                        syncError 
                                            ? 'bg-yellow-900/20 border-yellow-700 text-yellow-200 hover:bg-yellow-900/40' 
                                            : 'bg-gray-800 border-gray-600 text-white hover:bg-gray-750 hover:border-blue-500/50'
                                    }`}
                                >
                                    <RefreshCw size={16} className={`group-hover:text-blue-300 ${isSyncing ? 'animate-spin' : ''}`} />
                                    <span>{isSyncing ? 'Syncing...' : (syncError ? 'Resume Sync' : 'Sync Now')}</span>
                                </button>
                            </div>
                        ) : (
                            <div className="flex items-center justify-between">
                                <span className="text-sm text-gray-300">Sync with Google Drive</span>
                                <button 
                                    onClick={handleLinkDrive}
                                    disabled={authStatus === 'authenticating'}
                                    className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-750 text-white rounded-xl font-medium transition-colors border border-gray-600 hover:border-blue-500/50 group text-sm disabled:opacity-50"
                                >
                                    <Cloud size={16} className="text-blue-400 group-hover:text-blue-300" />
                                    <span>{authStatus === 'authenticating' ? 'Connecting...' : 'Connect'}</span>
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Encryption Section */}
                <div className="space-y-3">
                    <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Security</h4>
                    <div className="bg-green-900/10 border border-green-900/30 p-4 rounded-2xl">
                        <div className="flex gap-3 items-center mb-1">
                             <ShieldCheck size={20} className="text-green-400 shrink-0" />
                             <p className="text-sm text-green-200 font-medium">Encrypted Storage Active</p>
                        </div>
                        <p className="text-[10px] text-green-400/70 leading-relaxed ml-8">
                            Your memories are safely encrypted on this device.
                        </p>

                        <button 
                            onClick={() => setShowAdvanced(!showAdvanced)}
                            className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-white mt-3 ml-8 transition-colors uppercase font-bold tracking-wider"
                        >
                            {showAdvanced ? <Upload size={12} /> : <Download size={12} />}
                            Advanced Options
                        </button>

                        {showAdvanced && (
                            <div className="mt-3 ml-2 pl-4 border-l-2 border-gray-700/50 space-y-3 animate-in fade-in slide-in-from-top-1 duration-200">
                                <div className="bg-gray-900/30 p-3 rounded-lg border border-gray-700/30">
                                    <div className="flex items-start gap-2 mb-2">
                                        <Info size={14} className="text-yellow-500 mt-0.5 shrink-0" />
                                        <p className="text-xs text-gray-300 leading-relaxed">
                                            Your encryption key is stored in this browser. If you clear your cache, you will lose access to your data unless you have a backup.
                                        </p>
                                    </div>
                                    <div className="flex gap-2 mt-3">
                                        <button 
                                            onClick={handleDownloadKey}
                                            className="text-xs bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded-lg border border-gray-600 transition-colors flex items-center gap-1.5 font-medium"
                                        >
                                            <Download size={12} /> Backup Key
                                        </button>
                                        <button 
                                            onClick={handleRestoreClick}
                                            className="text-xs bg-transparent hover:bg-gray-800 text-gray-400 hover:text-gray-200 px-3 py-1.5 rounded-lg border border-gray-700 transition-colors flex items-center gap-1.5"
                                        >
                                            <Upload size={12} /> Restore Key
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Data Management Section */}
                <div className="space-y-3">
                    <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Data Management</h4>
                    <div className="bg-gray-700/30 p-4 rounded-2xl border border-gray-700 space-y-4">
                        {/* Export */}
                        <div>
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-sm font-semibold text-gray-300">Export Memories</span>
                            </div>
                            <div className="grid grid-cols-1 gap-2 mb-3">
                                <MultiSelect 
                                    label="Type" 
                                    options={availableTypes} 
                                    selected={exportSelectedTypes} 
                                    onChange={setExportSelectedTypes} 
                                    placeholder="All Types"
                                />
                            </div>
                            <button 
                                onClick={handleExport}
                                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-800 hover:bg-gray-750 text-white rounded-xl font-medium transition-colors border border-gray-600 hover:border-blue-500/50 group"
                            >
                                <Download size={16} className="text-blue-400 group-hover:text-blue-300" />
                                <span>Download CSV</span>
                            </button>
                        </div>

                        <div className="h-px bg-gray-700/50"></div>

                        {/* Import */}
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-gray-300">Import Memories</span>
                                <div className="group relative">
                                    <Info size={14} className="text-gray-500 cursor-help" />
                                    <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-48 p-2 bg-black/90 text-xs text-gray-300 rounded-lg pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity text-center">
                                        Import memories from a CSV file exported from SaveItForL8R. Useful for sharing with friends & family.
                                    </div>
                                </div>
                            </div>
                            <button 
                                onClick={handleImportClick}
                                className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-750 text-white rounded-xl font-medium transition-colors border border-gray-600 hover:border-green-500/50 group text-sm"
                            >
                                <Upload size={16} className="text-green-400 group-hover:text-green-300" />
                                <span>Import CSV</span>
                            </button>
                        </div>
                    </div>
                </div>

                {/* Account / API Key Section */}
                <div className="space-y-3">
                    <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Account</h4>
                    
                    {hasApiKey ? (
                        <button 
                            onClick={clearKey}
                            className="w-full flex items-center justify-between px-4 py-3 bg-red-900/10 hover:bg-red-900/20 text-red-400 rounded-xl font-medium transition-colors border border-red-900/20 hover:border-red-900/40 group"
                        >
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-red-900/20 rounded-lg group-hover:bg-red-900/30 transition-colors">
                                    <LogOut size={18} />
                                </div>
                                <div className="text-left">
                                    <span className="block text-sm font-bold text-gray-200 group-hover:text-white">Disconnect API Key</span>
                                    <span className="block text-xs text-red-400/70">Removes access from this device</span>
                                </div>
                            </div>
                        </button>
                    ) : (
                        <button 
                            onClick={onAddApiKey}
                            className="w-full flex items-center justify-between px-4 py-3 bg-blue-900/10 hover:bg-blue-900/20 text-blue-400 rounded-xl font-medium transition-colors border border-blue-900/20 hover:border-blue-900/40 group"
                        >
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-blue-900/20 rounded-lg group-hover:bg-blue-900/30 transition-colors">
                                    <Key size={18} />
                                </div>
                                <div className="text-left">
                                    <span className="block text-sm font-bold text-gray-200 group-hover:text-white">Add API Key</span>
                                    <span className="block text-xs text-blue-400/70">Enable AI analysis</span>
                                </div>
                            </div>
                        </button>
                    )}
                </div>
            </div>
        </div>

        {/* Hidden Inputs */}
        <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleImportFile} 
            className="hidden" 
            accept=".csv" 
        />
        <input 
            type="file" 
            ref={keyInputRef} 
            onChange={handleRestoreFile} 
            className="hidden" 
            accept=".json" 
        />
      </div>
    </div>
  );
};

export default SettingsModal;
