import React from 'react';
import { Bold, Italic, Underline, Strikethrough, Heading1, Heading2, List, ListOrdered, TextQuote, Code, Minus } from 'lucide-react';
import { btn } from '../styles/design-system';

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
    onMouseDown={(e) => e.preventDefault()}
    className={`${compact ? btn.icon : btn.iconLg} shrink-0 ${isActive ? 'bg-(--color-accent) text-white hover:bg-(--color-accent) hover:text-white' : ''}`}
    title={title}
  >
    {children}
  </button>
);

const Divider: React.FC = () => (
  <div className="w-px h-5 bg-(--color-border-default)/50 mx-0.5 shrink-0"></div>
);

const FormattingToolbar: React.FC<FormattingToolbarProps> = ({ activeFormats, onFormat, compact = false }) => {
  const iconSize = compact ? 18 : 20;
  const isActive = (format: string) => activeFormats.includes(format);

  return (
    <div className={`flex flex-nowrap items-center gap-2 ${compact ? 'bg-(--color-surface-raised)/80 p-1.5 rounded-(--radius-xl) border border-(--color-border-default)/50' : 'bg-(--color-surface-raised)/90 backdrop-blur-md p-2 rounded-(--radius-xl) border border-(--color-border-default)/50 shadow-xl'} overflow-x-auto no-scrollbar`}>
      {/* Inline formatting */}
      <ToolbarButton onClick={() => onFormat('bold')} title="Bold (⌘B)" isActive={isActive('bold')} compact={compact}>
        <Bold size={iconSize} />
      </ToolbarButton>
      <ToolbarButton onClick={() => onFormat('italic')} title="Italic (⌘I)" isActive={isActive('italic')} compact={compact}>
        <Italic size={iconSize} />
      </ToolbarButton>
      <ToolbarButton onClick={() => onFormat('underline')} title="Underline (⌘U)" isActive={isActive('underline')} compact={compact}>
        <Underline size={iconSize} />
      </ToolbarButton>
      <ToolbarButton onClick={() => onFormat('strikeThrough')} title="Strikethrough (⌘⇧S)" isActive={isActive('strikethrough')} compact={compact}>
        <Strikethrough size={iconSize} />
      </ToolbarButton>

      <Divider />

      {/* Headings */}
      <ToolbarButton onClick={() => onFormat('formatBlock', 'H1')} title="Heading 1" isActive={isActive('H1')} compact={compact}>
        <Heading1 size={iconSize} />
      </ToolbarButton>
      <ToolbarButton onClick={() => onFormat('formatBlock', 'H2')} title="Heading 2" isActive={isActive('H2')} compact={compact}>
        <Heading2 size={iconSize} />
      </ToolbarButton>

      <Divider />

      {/* Block formatting */}
      <ToolbarButton onClick={() => onFormat('insertUnorderedList')} title="Bullet List (⌘⇧8)" isActive={isActive('UL')} compact={compact}>
        <List size={iconSize} />
      </ToolbarButton>
      <ToolbarButton onClick={() => onFormat('insertOrderedList')} title="Numbered List (⌘⇧7)" isActive={isActive('OL')} compact={compact}>
        <ListOrdered size={iconSize} />
      </ToolbarButton>
      <ToolbarButton onClick={() => onFormat('formatBlock', 'BLOCKQUOTE')} title="Blockquote (⌘⇧9)" isActive={isActive('blockquote')} compact={compact}>
        <TextQuote size={iconSize} />
      </ToolbarButton>

      <Divider />

      {/* Code & HR */}
      <ToolbarButton onClick={() => onFormat('code')} title="Inline Code (⌘E)" isActive={isActive('code')} compact={compact}>
        <Code size={iconSize} />
      </ToolbarButton>
      <ToolbarButton onClick={() => onFormat('insertHorizontalRule')} title="Horizontal Rule" compact={compact}>
        <Minus size={iconSize} />
      </ToolbarButton>
    </div>
  );
};

export default FormattingToolbar;

// Re-export ToolbarButton for use in NewMemoryPage
export { ToolbarButton };
