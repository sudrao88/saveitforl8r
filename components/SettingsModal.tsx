
import React from 'react';
import { X, Settings, Download, Upload, HelpCircle } from 'lucide-react';
import MultiSelect from './MultiSelect';
import { KeyOff } from './icons';
import { useExportImport } from '../hooks/useExportImport';

interface SettingsModalProps {
  onClose: () => void;
  clearKey: () => void;
  availableTypes: string[];
  availableTags: string[];
  onImportSuccess: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ 
    onClose, 
    clearKey, 
    availableTypes, 
    availableTags,
    onImportSuccess
}) => {
  const {
    exportSelectedTypes,
    setExportSelectedTypes,
    exportSelectedTags,
    setExportSelectedTags,
    fileInputRef,
    handleExport,
    handleImportClick,
    handleImportFile
  } = useExportImport(onImportSuccess);

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
              </div>
          </div>
          
          <div className="space-y-6">
               {/* Data Management Section */}
               <div className="space-y-3">
                  <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Data Management</h4>
                  
                  <div className="bg-gray-700/30 p-4 rounded-2xl border border-gray-700 space-y-4">
                      {/* Export */}
                      <div>
                          <div className="flex justify-between items-center mb-2">
                            <span className="text-sm font-semibold text-gray-300">Export Memories</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 mb-3">
                            <MultiSelect 
                              label="Type"
                              options={availableTypes}
                              selected={exportSelectedTypes}
                              onChange={setExportSelectedTypes}
                              placeholder="All Types"
                            />
                            <MultiSelect 
                              label="Tags"
                              options={availableTags}
                              selected={exportSelectedTags}
                              onChange={setExportSelectedTags}
                              placeholder="All Tags"
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
               </div>
          </div>
        </div>
      </div>
      
      {/* Hidden File Input for Import */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleImportFile}
        className="hidden"
        accept=".csv"
      />
    </div>
  );
};

export default SettingsModal;
