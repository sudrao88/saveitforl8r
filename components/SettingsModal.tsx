import React, { useState, useEffect } from 'react';
import { X, Key, Download, Upload, Info, RefreshCw, Cloud, AlertTriangle, ShieldCheck, LogOut, Settings, Cpu, CheckCircle2, Loader2, Database, FileQuestion, Bug } from 'lucide-react';
import { useExportImport } from '../hooks/useExportImport';
import { useEncryptionSettings } from '../hooks/useEncryptionSettings';
import MultiSelect from './MultiSelect';
import { useSync } from '../hooks/useSync';
import { useAuth } from '../hooks/useAuth';
import { ModelStatus, EmbeddingStats } from '../hooks/useAdaptiveSearch';
import { factoryReset, forceReindexAll, ReconcileReport } from '../services/storageService';

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
  lastError?: string | null;
  closeWorkerDB?: () => void;
  reconcileReport?: ReconcileReport | null;
  onUpdateReport?: (report: ReconcileReport) => void;
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
    totalMemories,
    lastError,
    closeWorkerDB,
    reconcileReport,
    onUpdateReport
}) => {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isReindexing, setIsReindexing] = useState(false);
  const { sync, isSyncing } = useSync();
  const { authStatus, login, unlink } = useAuth();

  const handleLinkDrive = () => { login(); };

  const handleSyncNow = async () => {
      try {
          await sync(true);
          if (onSyncComplete) onSyncComplete();
      } catch (e: any) { console.error("Sync failed:", e); }
  };

  const handleUnlink = () => { unlink(); };

  const { exportSelectedTypes, setExportSelectedTypes, fileInputRef, handleExport, handleImportClick, handleImportFile } = useExportImport(onImportSuccess || (() => {}));
  const { handleDownloadKey, handleRestoreClick, handleRestoreFile, fileInputRef: keyInputRef } = useEncryptionSettings();

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

  const statsReady = embeddingStats?.completed || 0;
  const statsPending = embeddingStats?.pending || 0;
  const statsFailed = embeddingStats?.failed || 0;
  const waitingForEnrichment = Math.max(0, totalMemories - (statsReady + statsPending + statsFailed));

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background-color: rgba(255, 255, 255, 0.1); border-radius: 20px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background-color: rgba(255, 255, 255, 0.2); }
      `}</style>

      <div className="bg-gray-800 border border-gray-700 rounded-3xl max-w-md w-full shadow-2xl relative max-h-[85vh] flex flex-col overflow-hidden">
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors z-20">
          <X size={20} />
        </button>

        <div className="overflow-y-auto p-6 flex-1 custom-scrollbar">
            <div className="flex flex-col text-left">
                <div className="flex items-center gap-4 mb-6">
                    <div className="w-12 h-12 bg-gray-700/50 rounded-2xl flex items-center justify-center text-gray-300"><Settings size={24} /></div>
                    <div>
                        <h3 className="text-xl font-bold text-white">Settings</h3>
                        <p className="text-gray-400 text-sm">Manage your data and preferences</p>
                        {appVersion && <span className="inline-block mt-1 px-2 py-0.5 rounded-md bg-gray-700 text-[10px] font-mono text-gray-400 border border-gray-600">{appVersion}</span>}
                    </div>
                </div>

                <div className="space-y-6">
                    <div className="space-y-3">
                        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Offline AI</h4>
                        <div className="bg-gray-700/30 p-4 rounded-2xl border border-gray-700 space-y-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Cpu size={20} className={modelStatus === 'ready' ? "text-green-400" : "text-gray-400"} />
                                    <span className="text-sm font-medium text-gray-200">Local Search Model</span>
                                </div>
                                {modelStatus === 'ready' && <CheckCircle2 size={18} className="text-green-400" />}
                            </div>

                            {lastError && (
                                <div className="bg-red-900/20 border border-red-900/50 p-3 rounded-lg flex items-start gap-2 text-red-200">
                                    <AlertTriangle size={16} className="text-red-400 mt-0.5 shrink-0" />
                                    <div className="flex-1 overflow-hidden">
                                        <p className="text-xs font-bold">System Error</p>
                                        <p className="text-[9px] break-words font-mono mt-1 opacity-80">{lastError}</p>
                                    </div>
                                </div>
                            )}

                            {modelStatus === 'downloading' && (
                                <div className="space-y-2">
                                    <div className="flex justify-between text-xs text-gray-400"><span>Downloading...</span><span>{downloadProgress ? Math.round(downloadProgress.progress || 0) : 0}%</span></div>
                                    <div className="h-1.5 w-full bg-gray-700 rounded-full overflow-hidden">
                                        <div className="h-full bg-blue-500 rounded-full transition-all duration-300" style={{ width: `${downloadProgress ? downloadProgress.progress : 0}%` }}></div>
                                    </div>
                                </div>
                            )}

                            {modelStatus === 'ready' && embeddingStats && (
                                <div className="pt-3 border-t border-gray-700/50 space-y-2">
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2"><Database size={14} className="text-gray-400" /><span className="text-xs font-bold text-gray-300 uppercase tracking-wide">Index Status</span></div>
                                        <span className="text-[10px] text-gray-500">{totalMemories} Total Notes</span>
                                    </div>
                                    <div className="grid grid-cols-4 gap-2">
                                        <div className="bg-gray-800/50 p-2 rounded-lg border border-gray-700/50 flex flex-col items-center"><span className="text-lg font-bold text-green-400">{statsReady}</span><span className="text-[9px] text-gray-500 uppercase">Ready</span></div>
                                        <div className="bg-gray-800/50 p-2 rounded-lg border border-gray-700/50 flex flex-col items-center relative overflow-hidden">{statsPending > 0 && <div className="absolute inset-0 bg-blue-500/10 animate-pulse"></div>}<span className={`text-lg font-bold ${statsPending > 0 ? 'text-blue-400' : 'text-gray-400'}`}>{statsPending}</span><span className="text-[9px] text-gray-500 uppercase flex items-center gap-1">{statsPending > 0 && <Loader2 size={8} className="animate-spin" />} Queue</span></div>
                                        <div className="bg-gray-800/50 p-2 rounded-lg border border-gray-700/50 flex flex-col items-center"><span className={`text-lg font-bold ${statsFailed > 0 ? 'text-red-400' : 'text-gray-400'}`}>{statsFailed}</span><span className="text-[9px] text-gray-500 uppercase">Failed</span></div>
                                        <div className="bg-gray-800/50 p-2 rounded-lg border border-gray-700/50 flex flex-col items-center"><span className="text-lg font-bold text-gray-500">{waitingForEnrichment}</span><span className="text-[9px] text-gray-600 uppercase flex items-center gap-1"><FileQuestion size={8} /> Wait</span></div>
                                    </div>
                                    {statsFailed > 0 && retryFailedEmbeddings && (
                                        <button onClick={retryFailedEmbeddings} className="w-full mt-2 flex items-center justify-center gap-2 text-xs py-1.5 bg-red-900/20 hover:bg-red-900/30 text-red-400 border border-red-900/50 rounded-lg transition-colors"><RefreshCw size={12} /> Retry Failed Items</button>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                    
                    <div className="space-y-3">
                        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Cloud Sync</h4>
                        <div className="bg-gray-700/30 p-4 rounded-2xl border border-gray-700 space-y-4">
                            {authStatus === 'linked' ? (
                                <div className="flex flex-col gap-3">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">{syncError ? (<><AlertTriangle size={20} className="text-yellow-500" /><span className="text-sm font-medium text-yellow-500">Sync Paused</span></>) : (<><Cloud size={20} className="text-green-400" /><span className="text-sm font-medium text-green-400">Linked</span></>)}</div>
                                        <button onClick={handleUnlink} className="text-xs text-red-400 hover:text-red-300 underline">Unlink</button>
                                    </div>
                                    <button onClick={handleSyncNow} disabled={isSyncing} className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-medium transition-colors border group ${syncError ? 'bg-yellow-900/20 border-yellow-700 text-yellow-200 hover:bg-yellow-900/40' : 'bg-gray-800 border-gray-600 text-white hover:bg-gray-750 hover:border-blue-500/50'}`}><RefreshCw size={16} className={`group-hover:text-blue-300 ${isSyncing ? 'animate-spin' : ''}`} /><span>{isSyncing ? 'Syncing...' : (syncError ? 'Resume Sync' : 'Sync Now')}</span></button>
                                </div>
                            ) : (
                                <div className="flex items-center justify-between"><span className="text-sm text-gray-300">Sync with Google Drive</span><button onClick={handleLinkDrive} disabled={authStatus === 'authenticating'} className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-750 text-white rounded-xl font-medium transition-colors border border-gray-600 hover:border-blue-500/50 group text-sm disabled:opacity-50"><Cloud size={16} className="text-blue-400 group-hover:text-blue-300" /><span>{authStatus === 'authenticating' ? 'Connecting...' : 'Connect'}</span></button></div>
                            )}
                        </div>
                    </div>

                    <div className="space-y-3">
                        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Security</h4>
                        <div className="bg-green-900/10 border border-green-900/30 p-4 rounded-2xl">
                            <div className="flex gap-3 items-center mb-1"><ShieldCheck size={20} className="text-green-400 shrink-0" /><p className="text-sm text-green-200 font-medium">Encrypted Storage Active</p></div>
                            <button onClick={() => setShowAdvanced(!showAdvanced)} className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-white mt-3 ml-8 transition-colors uppercase font-bold tracking-wider">{showAdvanced ? <Upload size={12} /> : <Download size={12} />} Advanced Options</button>
                            {showAdvanced && (
                                <div className="mt-3 ml-2 pl-4 border-l-2 border-gray-700/50 space-y-3 animate-in fade-in slide-in-from-top-1 duration-200">
                                    <div className="bg-blue-900/10 p-3 rounded-lg border border-blue-900/30 space-y-2 overflow-hidden">
                                        <div className="flex items-center gap-2 text-blue-300"><Bug size={14} /><span className="text-xs font-bold uppercase">RAG Diagnostics</span></div>
                                        {reconcileReport ? (
                                            <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[9px] font-mono text-blue-400/80">
                                                <span>Total: {reconcileReport.total}</span><span>Enriched: {reconcileReport.enriched}</span>
                                                <span>Indexed: {reconcileReport.alreadyIndexed}</span><span>Queue: {reconcileReport.pendingInQueue}</span>
                                                <span className="col-span-2 text-blue-300 font-bold border-t border-blue-900/30 pt-1 mt-1">Status: {reconcileReport.toQueue > 0 ? `Queuing ${reconcileReport.toQueue}...` : 'Synced'}</span>
                                                {reconcileReport.error && <span className="col-span-2 text-red-400 mt-1 bg-red-900/20 p-1 rounded">Error: {reconcileReport.error}</span>}
                                            </div>
                                        ) : <p className="text-[9px] text-blue-400/50 italic">No report available yet.</p>}
                                        <button 
                                            onClick={(e) => { e.preventDefault(); handleForceReindex(); }} 
                                            disabled={isReindexing}
                                            className="w-full text-left text-[9px] text-blue-400 underline hover:text-blue-300 transition-colors uppercase font-bold disabled:opacity-50 flex items-center gap-2 pt-2"
                                        >
                                            {isReindexing ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
                                            Force Reindex All Notes
                                        </button>
                                    </div>
                                    <div className="bg-gray-900/30 p-3 rounded-lg border border-gray-700/30"><div className="flex gap-2 mt-1"><button onClick={handleDownloadKey} className="text-xs bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded-lg border border-gray-600 transition-colors flex items-center gap-1.5 font-medium"><Download size={12} /> Backup Key</button><button onClick={handleRestoreClick} className="text-xs bg-transparent hover:bg-gray-800 text-gray-400 hover:text-gray-200 px-3 py-1.5 rounded-lg border border-gray-700 transition-colors flex items-center gap-1.5"><Upload size={12} /> Restore Key</button></div></div>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="space-y-3">
                        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Account</h4>
                        {hasApiKey ? (
                            <button onClick={clearKey} className="w-full flex items-center justify-between px-4 py-3 bg-red-900/10 hover:bg-red-900/20 text-red-400 rounded-xl font-medium transition-colors border border-red-900/20 hover:border-red-900/40 group"><div className="flex items-center gap-3"><div className="p-2 bg-red-900/20 rounded-lg group-hover:bg-red-900/30 transition-colors"><LogOut size={18} /></div><div className="text-left"><span className="block text-sm font-bold text-gray-200 group-hover:text-white">Disconnect API Key</span><span className="block text-xs text-red-400/70">Removes access from this device</span></div></div></button>
                        ) : (
                            <button onClick={onAddApiKey} className="w-full flex items-center justify-between px-4 py-3 bg-blue-900/10 hover:bg-blue-900/20 text-blue-400 rounded-xl font-medium transition-colors border border-blue-900/20 hover:border-blue-900/40 group"><div className="flex items-center gap-3"><div className="p-2 bg-blue-900/20 rounded-lg group-hover:bg-blue-900/30 transition-colors"><Key size={18} /></div><div className="text-left"><span className="block text-sm font-bold text-gray-200 group-hover:text-white">Add API Key</span><span className="block text-xs text-blue-400/70">Enable AI analysis</span></div></div></button>
                        )}
                    </div>

                    <div className="space-y-3 pt-4 border-t border-red-900/30">
                        <h4 className="text-xs font-bold text-red-500 uppercase tracking-wider ml-1">Danger Zone</h4>
                        <button onClick={() => { if (window.confirm("Are you sure you want to factory reset? This will delete ALL local data.")) { closeWorkerDB?.(); setTimeout(() => factoryReset(), 100); } }} className="w-full flex items-center justify-between px-4 py-3 bg-red-950/30 hover:bg-red-900/40 text-red-400 rounded-xl font-medium transition-colors border border-red-900/30 hover:border-red-800 group"><div className="flex items-center gap-3"><div className="p-2 bg-red-900/20 rounded-lg group-hover:bg-red-900/30 transition-colors"><AlertTriangle size={18} /></div><div className="text-left"><span className="block text-sm font-bold text-red-200 group-hover:text-white">Factory Reset App</span><span className="block text-xs text-red-400/70">Wipe all data and start fresh</span></div></div></button>
                    </div>
                </div>
            </div>
        </div>
        <input type="file" ref={fileInputRef} onChange={handleImportFile} className="hidden" accept=".csv" />
        <input type="file" ref={keyInputRef} onChange={handleRestoreFile} className="hidden" accept=".json" />
      </div>
    </div>
  );
};

export default SettingsModal;
