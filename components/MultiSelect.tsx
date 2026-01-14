
import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

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
      <label className="block text-xs font-bold text-gray-500 mb-1 uppercase">{label}</label>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full bg-gray-800 text-left text-white text-sm rounded-lg px-3 py-2 border border-gray-600 focus:border-blue-500 outline-none flex justify-between items-center hover:bg-gray-750 transition-colors"
      >
        <span className="truncate block pr-2">
          {selected.length === 0 
            ? <span className="text-gray-400">{placeholder}</span> 
            : selected.length === options.length 
                ? "All Selected"
                : `${selected.length} selected`}
        </span>
        <ChevronDown size={14} className={`text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-xl max-h-60 overflow-y-auto overflow-x-hidden">
          {options.length > 0 && (
             <div 
                onClick={handleSelectAll}
                className="px-3 py-2 hover:bg-gray-700 cursor-pointer flex items-center gap-2 border-b border-gray-700 sticky top-0 bg-gray-800 text-xs font-bold text-blue-400"
             >
                <div className={`w-4 h-4 rounded border flex items-center justify-center ${selected.length === options.length ? 'bg-blue-600 border-blue-600' : 'border-gray-500'}`}>
                    {selected.length === options.length && <Check size={10} className="text-white" />}
                </div>
                Select All
             </div>
          )}
          
          {options.map(option => (
            <div 
              key={option} 
              onClick={() => toggleOption(option)}
              className="px-3 py-2 hover:bg-gray-700 cursor-pointer flex items-center gap-2"
            >
              <div className={`w-4 h-4 rounded border flex items-center justify-center ${selected.includes(option) ? 'bg-blue-600 border-blue-600' : 'border-gray-500'}`}>
                {selected.includes(option) && <Check size={10} className="text-white" />}
              </div>
              <span className="text-sm text-gray-200 truncate">{option}</span>
            </div>
          ))}
          {options.length === 0 && (
             <div className="px-3 py-2 text-gray-500 text-sm italic">No options available</div>
          )}
        </div>
      )}
    </div>
  );
};

export default MultiSelect;
