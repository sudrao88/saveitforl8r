
import React from 'react';
import { Filter, X, Tv, BookOpen, ShoppingBag, Music, Layers } from 'lucide-react';

interface FilterBarProps {
  availableTypes: string[];
  filterType: string | null;
  setFilterType: (type: string | null) => void;
  clearFilters: () => void;
}

const getTypeIcon = (type: string) => {
    const t = type.toLowerCase();
    if (t.includes('movie') || t.includes('tv')) return <Tv size={12} />;
    if (t.includes('book')) return <BookOpen size={12} />;
    if (t.includes('product')) return <ShoppingBag size={12} />;
    if (t.includes('music')) return <Music size={12} />;
    return <Layers size={12} />;
};

const FilterBar: React.FC<FilterBarProps> = ({
  availableTypes,
  filterType,
  setFilterType,
  clearFilters
}) => {
  if (availableTypes.length === 0) {
      return null;
  }

  return (
    <div className="w-full max-w-4xl mx-auto px-4 sm:px-8 py-2 flex items-center gap-2 overflow-x-auto no-scrollbar mask-gradient">
       <div className="flex items-center gap-2 pr-3 shrink-0 border-r border-gray-700/50 mr-1">
           <Filter size={14} className="text-gray-500" />
           <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest hidden sm:inline">Filter</span>
       </div>

       {filterType && (
           <button 
               onClick={clearFilters} 
               className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full bg-gray-800 text-gray-400 text-xs font-bold border border-red-900/30 hover:bg-red-900/20 hover:text-red-400 transition-colors"
           >
               <X size={12} /> Clear
           </button>
       )}

       {/* Types */}
       {availableTypes.map(t => (
           <button 
               key={t} 
               onClick={() => setFilterType(filterType === t ? null : t)}
               className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${
                   filterType === t 
                   ? 'bg-blue-600 text-white border-blue-500 shadow-lg shadow-blue-900/20' 
                   : 'bg-gray-800 text-gray-300 border-gray-700 hover:border-gray-500'
               }`}
           >
               {getTypeIcon(t)} {t}
           </button>
       ))}
    </div>
  );
};

export default FilterBar;
