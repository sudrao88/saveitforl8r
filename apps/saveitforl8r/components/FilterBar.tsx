
import React from 'react';
import { Filter, X, Tv, BookOpen, ShoppingBag, Music, Layers } from 'lucide-react';
import { chip, layout, text } from '@l8r/shared/design-system';

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
    <div className={`${layout.pageContainer} ${layout.section} py-2 flex items-center gap-2 overflow-x-auto no-scrollbar mask-gradient touch-pan-x`}>
       <div className="flex items-center gap-2 pr-3 shrink-0 border-r border-(--color-border-subtle) mr-1">
           <Filter size={14} className="text-(--color-text-tertiary)" />
           <span className={`${text.label} tracking-widest hidden sm:inline`}>Filter</span>
       </div>

       {filterType && (
           <button 
               onClick={clearFilters} 
               className={`${chip.base} bg-(--color-surface-raised) text-(--color-text-secondary) border-(--color-danger)/30 hover:bg-(--color-danger)/20 hover:text-(--color-danger)`}
           >
               <X size={12} /> Clear
           </button>
       )}

       {/* Types */}
       {availableTypes.map(t => (
           <button
               key={t}
               onClick={() => setFilterType(filterType === t ? null : t)}
               className={`${chip.base} ${
                   filterType === t
                   ? chip.active
                   : chip.inactive
               }`}
           >
               {getTypeIcon(t)} {t}
           </button>
       ))}
    </div>
  );
};

export default FilterBar;
