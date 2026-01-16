
import React from 'react';
import { Search, Settings, RefreshCw } from 'lucide-react';
import { Logo } from './icons';
import { ViewMode } from '../types';

interface TopNavigationProps {
  setView: (view: ViewMode) => void;
  resetFilters: () => void;
  onSettingsClick: () => void;
  updateAvailable?: boolean;
  onUpdateApp?: () => void;
}

const TopNavigation: React.FC<TopNavigationProps> = ({ 
  setView, 
  resetFilters, 
  onSettingsClick, 
  updateAvailable, 
  onUpdateApp 
}) => {
  return (
    <nav className="px-4 py-3 sm:px-8 flex justify-center">
      <div className="w-full max-w-4xl flex items-center justify-between gap-4">
        <div 
          className="flex items-center gap-3 text-blue-500 font-black text-xl tracking-tighter shrink-0 cursor-pointer"
          onClick={() => { resetFilters(); setView(ViewMode.FEED); }}
        >
          <Logo className="w-8 h-8 rounded-lg shadow-sm" />
          <span className="hidden sm:inline">SaveItForL8r</span>
        </div>

        <div className="flex items-center gap-2">
          {updateAvailable && (
            <button
              onClick={onUpdateApp}
              className="flex items-center gap-2 bg-red-900/20 hover:bg-red-900/30 border border-red-900/50 hover:border-red-800 transition-all rounded-xl px-4 py-2.5 text-red-500 hover:text-red-400 group animate-pulse"
            >
              <RefreshCw size={18} className="text-red-500" />
              <span className="font-bold text-sm">Update</span>
            </button>
          )}

          <button
            onClick={() => setView(ViewMode.RECALL)}
            className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-600 transition-all rounded-xl px-4 py-2.5 text-gray-400 hover:text-white group"
          >
            <Search size={18} className="text-gray-500 group-hover:text-blue-400" />
            <span className="font-medium text-sm">Search</span>
          </button>

          <button
            onClick={onSettingsClick}
            className="flex items-center justify-center bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-600 transition-all rounded-xl p-2.5 text-gray-400 hover:text-white group shrink-0"
            title="Settings"
          >
            <Settings size={20} className="text-gray-500 group-hover:text-white" />
          </button>
        </div>
      </div>
    </nav>
  );
};

export default TopNavigation;
