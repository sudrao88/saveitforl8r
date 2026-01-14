
import React from 'react';
import { Search, Settings } from 'lucide-react';
import { Logo } from './icons';
import { ViewMode } from '../types';

interface TopNavigationProps {
  setView: (view: ViewMode) => void;
  resetFilters: () => void;
  onSettingsClick: () => void;
}

const TopNavigation: React.FC<TopNavigationProps> = ({ setView, resetFilters, onSettingsClick }) => {
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
          <button
            onClick={() => setView(ViewMode.RECALL)}
            className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-600 transition-all rounded-xl px-4 py-2.5 text-gray-400 hover:text-white group"
          >
            <Search size={18} className="text-gray-500 group-hover:text-blue-400" />
            <span className="font-medium text-sm">Search</span>
          </button>

          <button
            onClick={onSettingsClick}
            className="p-2.5 text-gray-500 hover:text-white hover:bg-gray-800 rounded-xl transition-colors shrink-0"
            title="Settings"
          >
            <Settings size={20} />
          </button>
        </div>
      </div>
    </nav>
  );
};

export default TopNavigation;
