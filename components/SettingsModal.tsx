import React, { useState, useEffect } from 'react';
import { X, Settings, Download, Upload, HelpCircle, ShieldCheck, ChevronDown, ChevronRight, AlertTriangle, Key, Cloud, CloudOff, RefreshCw, AlertCircle } from 'lucide-react';
import MultiSelect from './MultiSelect';
import { KeyOff } from './icons';
import { useExportImport } from '../hooks/useExportImport';
import { useEncryptionSettings } from '../hooks/useEncryptionSettings';
import { useSync } from '../hooks/useSync';

interface SettingsModalProps {
  onClose: () => void;
  clearKey: () => void;
  availableTypes: string[];
  onImportSuccess: () => void;
  appVersion?: string;
  hasApiKey: boolean;
  onAddApiKey: () => void;
  syncError?: boolean;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ 
    onClose, 
    clearKey, 
    availableTypes, 
    onImportSuccess,
    appVersion,
    hasApiKey,
    onAddApiKey,
    syncError
}) => {
  const [showAdvancedSecurity, setShowAdvancedSecurity] = useState(false);
  
  // Use context hooks
  const { isLinked, initialize, sync, login, unlink, isSyncing } = useSync();
  const [isDriveLinked, setIsDriveLinked] = useState(isLinked());

  useEffect(() => {
    setIsDriveLinked(isLinked());
  }, []);

  const handleDriveLink = () => {
    initialize(() => {
        setIsDriveLinked(true);
        // Note: Context handles sync call, we just init here
        sync(); 
    });
    login();
  };

  const handleSync = async () => {
    // We don't need local syncing state anymore, context handles it
    try {
        await sync();
    } catch (e: any) {
        if (e.message === 'InsufficientScopes' || e.message.includes('insufficientScopes')) {
            login();
        } else {
             console.error("Sync failed:", e);
        }
    }
  };

  const handleDriveUnlink = () => {
    unlink();
    setIsDriveLinked(false);
  };

  const {
    exportSelectedTypes,
    setExportSelectedTypes,
    fileInputRef,
    handleExport,
    handleImportClick,
    handleImportFile
  } = useExportImport(onImportSuccess);

  const {
      handleDownloadKey,
      handleRestoreClick,
      handleRestoreFile,
      fileInputRef: keyFileInputRef
  } = useEncryptionSettings();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-gray-800 border border-gray-700 rounded-3xl p-6 max-w-md w-full shadow-2xl relative max-h-[85vh] overflow-y-auto">
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
        >
          <X size={20} />
        </button>
        
        <div className="flex flex-col text-left">
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
               {/* Sync Section */}
               <div className="space-y-3">
                 <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Cloud Sync</h4>
                 <div className="bg-gray-700/30 p-4 rounded-2xl border border-gray-700 space-y-4">
                    {isDriveLinked ? (
                        <div className="flex flex-col gap-3">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    {syncError ? (
                                        <>
                                            <AlertCircle size={20} className="text-yellow-500" />
                                            <span className="text-sm font-medium text-yellow-500">Sync Paused</span>
                                        </>
                                    ) : (
                                        <>
                                            <Cloud size={20} className="text-green-400" />
                                            <span className="text-sm font-medium text-green-400">Google Drive Linked</span>
                                        </>
                                    )}
                                </div>
                                <button 
                                    onClick={handleDriveUnlink}
                                    className="text-xs text-red-400 hover:text-red-300 underline"
                                >
                                    Unlink
                                </button>
                            </div>
                            <button
                                onClick={handleSync}
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
                                onClick={handleDriveLink}
                                className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-750 text-white rounded-xl font-medium transition-colors border border-gray-600 hover:border-blue-500/50 group text-sm"
                            >
                                <Cloud size={16} className="text-blue-400 group-hover:text-blue-300" />
                                <span>Connect</span>
                            </button>
                        </div>
                    )}
                 </div>
               </div>

               {/* Security Section */}
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

                    {/* Advanced Toggle */}
                    <button 
                        onClick={() => setShowAdvancedSecurity(!showAdvancedSecurity)}
                        className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-white mt-3 ml-8 transition-colors uppercase font-bold tracking-wider"
                    >
                        {showAdvancedSecurity ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        Advanced Options
                    </button>

                    {/* Advanced Content */}
                    {showAdvancedSecurity && (
                        <div className="mt-3 ml-2 pl-4 border-l-2 border-gray-700/50 space-y-3 animate-in fade-in slide-in-from-top-1 duration-200">
                            <div className="bg-gray-900/30 p-3 rounded-lg border border-gray-700/30">
                                <div className="flex items-start gap-2 mb-2">
                                    <AlertTriangle size={14} className="text-yellow-500 mt-0.5 shrink-0" />
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

                      <div className="h-px bg-gray-700/50" />

                      {/* Import */}
                      <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-gray-300">Import Memories</span>
                            <div className="group relative">
                                <HelpCircle size={14} className="text-gray-500 cursor-help" />
                                <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-48 p-2 bg-black/90 text-xs text-gray-300 rounded-lg pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity text-center">
                                    Import memories from a CSV file exported from SaveItForL8r. Useful for sharing with friends & family.
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

               {/* Account Section */}
               <div className="space-y-3">
                  <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Account</h4>
                  
                  {hasApiKey ? (
                    <button
                        onClick={clearKey}
                        className="w-full flex items-center justify-between px-4 py-3 bg-red-900/10 hover:bg-red-900/20 text-red-400 rounded-xl font-medium transition-colors border border-red-900/20 hover:border-red-900/40 group"
                    >
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-red-900/20 rounded-lg group-hover:bg-red-900/30 transition-colors">
                                <KeyOff size={18} />
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
      </div>
      
      {/* Hidden File Input for CSV Import */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleImportFile}
        className="hidden"
        accept=".csv"
      />

       {/* Hidden File Input for Key Restore */}
       <input
        type="file"
        ref={keyFileInputRef}
        onChange={handleRestoreFile}
        className="hidden"
        accept=".json"
      />
    </div>
  );
};

export default SettingsModal;
