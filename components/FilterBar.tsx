
import React from 'react';
import { Filter, X, Image as ImageIcon, Paperclip } from 'lucide-react';
import { chip, layout, text } from '../styles/design-system';
import type { MemoryFilters, MemoryFilterKey } from '../hooks/useMemoryFilters';

interface FilterBarProps {
  filters: MemoryFilters;
  toggleFilter: (key: MemoryFilterKey) => void;
  hasActiveFilters: boolean;
  clearFilters: () => void;
}

const FILTER_OPTIONS: { key: MemoryFilterKey; label: string; icon: React.ReactNode }[] = [
  { key: 'hasImage', label: 'Has image', icon: <ImageIcon size={12} /> },
  { key: 'hasAttachment', label: 'Has attachment', icon: <Paperclip size={12} /> },
];

const FilterBar: React.FC<FilterBarProps> = ({
  filters,
  toggleFilter,
  hasActiveFilters,
  clearFilters
}) => {
  return (
    <div className={`${layout.pageContainer} ${layout.section} py-2 flex items-center gap-2 overflow-x-auto no-scrollbar mask-gradient touch-pan-x`}>
       <div className="flex items-center gap-2 pr-3 shrink-0 border-r border-(--color-border-subtle) mr-1">
           <Filter size={14} className="text-(--color-text-tertiary)" />
           <span className={`${text.label} tracking-widest hidden sm:inline`}>Filter</span>
       </div>

       {hasActiveFilters && (
           <button
               onClick={clearFilters}
               className={`${chip.base} bg-(--color-surface-raised) text-(--color-text-secondary) border-(--color-danger)/30 hover:bg-(--color-danger)/20 hover:text-(--color-danger)`}
           >
               <X size={12} /> Clear
           </button>
       )}

       {FILTER_OPTIONS.map(({ key, label, icon }) => (
           <button
               key={key}
               onClick={() => toggleFilter(key)}
               aria-pressed={filters[key]}
               className={`${chip.base} ${filters[key] ? chip.active : chip.inactive}`}
           >
               {icon} {label}
           </button>
       ))}
    </div>
  );
};

export default FilterBar;
