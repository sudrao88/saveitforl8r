import React from 'react';
import { Bold, Italic, Underline, Heading1, Heading2 } from 'lucide-react';

interface FormattingToolbarProps {
  activeFormats: string[];
  onFormat: (command: string, value?: string) => void;
  compact?: boolean;
}

const ToolbarButton: React.FC<{
  onClick: () => void;
  title: string;
  isActive?: boolean;
  compact?: boolean;
  children: React.ReactNode;
}> = ({ onClick, title, isActive = false, compact = false, children }) => (
  <button
    onClick={onClick}
    className={`${compact ? 'p-2 rounded-lg' : 'p-2.5 rounded-xl'} transition-colors active:scale-95 shrink-0 ${isActive ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700/50'}`}
    title={title}
  >
    {children}
  </button>
);

const FormattingToolbar: React.FC<FormattingToolbarProps> = ({ activeFormats, onFormat, compact = false }) => {
  const iconSize = compact ? 18 : 20;
  const isActive = (format: string) => activeFormats.includes(format);

  return (
    <div className={`flex flex-nowrap items-center gap-2 ${compact ? 'bg-gray-800/80 p-1.5 rounded-xl border border-gray-700/50' : 'bg-gray-800/90 backdrop-blur-md p-2 rounded-2xl border border-gray-700/50 shadow-xl'} overflow-x-auto no-scrollbar`}>
      <ToolbarButton onClick={() => onFormat('bold')} title="Bold" isActive={isActive('bold')} compact={compact}>
        <Bold size={iconSize} />
      </ToolbarButton>
      <ToolbarButton onClick={() => onFormat('italic')} title="Italic" isActive={isActive('italic')} compact={compact}>
        <Italic size={iconSize} />
      </ToolbarButton>
      <ToolbarButton onClick={() => onFormat('underline')} title="Underline" isActive={isActive('underline')} compact={compact}>
        <Underline size={iconSize} />
      </ToolbarButton>
      <div className="w-px h-5 bg-gray-700/50 mx-0.5 shrink-0"></div>
      <ToolbarButton onClick={() => onFormat('formatBlock', 'H1')} title="Heading 1" isActive={isActive('H1')} compact={compact}>
        <Heading1 size={iconSize} />
      </ToolbarButton>
      <ToolbarButton onClick={() => onFormat('formatBlock', 'H2')} title="Heading 2" isActive={isActive('H2')} compact={compact}>
        <Heading2 size={iconSize} />
      </ToolbarButton>
    </div>
  );
};

export default FormattingToolbar;

// Re-export ToolbarButton for use in NewMemoryPage
export { ToolbarButton };
