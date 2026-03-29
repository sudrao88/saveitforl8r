
import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { text, zIndex } from '../styles/design-system';

interface MultiSelectProps {
  label: string;
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
}

const MultiSelect: React.FC<MultiSelectProps> = ({ label, options, selected, onChange, placeholder = "Select..." }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleOption = (option: string) => {
    if (selected.includes(option)) {
      onChange(selected.filter(item => item !== option));
    } else {
      onChange([...selected, option]);
    }
  };

  const handleSelectAll = () => {
    if (selected.length === options.length) {
      onChange([]);
    } else {
      onChange([...options]);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <label className={`block ${text.label} mb-1`}>{label}</label>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full bg-(--color-surface-raised) text-left text-(--color-text-primary) text-sm rounded-lg px-3 py-2 border border-(--color-border-default) focus:border-(--color-accent) outline-none flex justify-between items-center hover:bg-(--color-surface-raised) transition-colors"
      >
        <span className="truncate block pr-2">
          {selected.length === 0 
            ? <span className="text-(--color-text-secondary)">{placeholder}</span> 
            : selected.length === options.length 
                ? "All Selected"
                : `${selected.length} selected`}
        </span>
        <ChevronDown size={14} className={`text-(--color-text-secondary) transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className={`absolute ${zIndex.overlay} w-full mt-1 bg-(--color-surface-raised) border border-(--color-border-default) rounded-lg shadow-xl max-h-60 overflow-y-auto overflow-x-hidden`}>
          {options.length > 0 && (
             <div 
                onClick={handleSelectAll}
                className="px-3 py-2 hover:bg-(--color-surface-raised) cursor-pointer flex items-center gap-2 border-b border-(--color-border-default) sticky top-0 bg-(--color-surface-raised) text-xs font-bold text-(--color-accent)"
             >
                <div className={`w-4 h-4 rounded border flex items-center justify-center ${selected.length === options.length ? 'bg-(--color-accent) border-(--color-accent)' : 'border-(--color-border-default)'}`}>
                    {selected.length === options.length && <Check size={10} className="text-(--color-text-primary)" />}
                </div>
                Select All
             </div>
          )}
          
          {options.map(option => (
            <div 
              key={option} 
              onClick={() => toggleOption(option)}
              className="px-3 py-2 hover:bg-(--color-surface-raised) cursor-pointer flex items-center gap-2"
            >
              <div className={`w-4 h-4 rounded border flex items-center justify-center ${selected.includes(option) ? 'bg-(--color-accent) border-(--color-accent)' : 'border-(--color-border-default)'}`}>
                {selected.includes(option) && <Check size={10} className="text-(--color-text-primary)" />}
              </div>
              <span className="text-sm text-(--color-text-primary) truncate">{option}</span>
            </div>
          ))}
          {options.length === 0 && (
             <div className="px-3 py-2 text-(--color-text-tertiary) text-sm italic">No options available</div>
          )}
        </div>
      )}
    </div>
  );
};

export default MultiSelect;
