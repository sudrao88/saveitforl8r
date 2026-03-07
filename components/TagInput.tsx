import React, { useState } from 'react';
import { X, Tag as TagIcon } from 'lucide-react';

export const SUGGESTED_TAGS = ["Book", "Restaurant", "Place to Visit", "Movie", "Podcast", "Stuff"];

interface TagInputProps {
  tags: string[];
  onTagsChange: (tags: string[]) => void;
  compact?: boolean;
}

const TagInput: React.FC<TagInputProps> = ({ tags, onTagsChange, compact = false }) => {
  const [tagInput, setTagInput] = useState('');

  const handleAddTag = () => {
    if (tagInput.trim() && !tags.includes(tagInput.trim())) {
      onTagsChange([...tags, tagInput.trim()]);
      setTagInput('');
    }
  };

  const toggleTag = (tag: string) => {
    if (tags.includes(tag)) {
      onTagsChange(tags.filter(t => t !== tag));
    } else {
      onTagsChange([...tags, tag]);
    }
  };

  const removeTag = (tag: string) => {
    onTagsChange(tags.filter(t => t !== tag));
  };

  if (compact) {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {tags.map(tag => (
            <span key={tag} className="bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 animate-in fade-in zoom-in-50 duration-200">
              #{tag}
              <button onClick={() => removeTag(tag)} className="hover:text-blue-200 p-0.5 -m-0.5"><X size={12} /></button>
            </span>
          ))}
          <div className="flex items-center gap-1.5 bg-gray-800/50 px-2.5 py-1 rounded-lg border border-gray-700/50 focus-within:border-blue-500/50 focus-within:bg-gray-800 transition-all">
            <TagIcon size={14} className="text-gray-500" />
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddTag();
                }
              }}
              onBlur={handleAddTag}
              placeholder="Add tag..."
              className="bg-transparent text-xs text-white placeholder-gray-500 focus:outline-none min-w-[80px] py-0.5"
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTED_TAGS.map(tag => {
            if (tags.includes(tag)) return null;
            return (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-gray-800 text-gray-400 border border-gray-700 hover:border-gray-500 hover:text-gray-200 transition-all active:scale-95"
              >
                + {tag}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Tags</h3>
      <div className="flex flex-wrap items-center gap-2">
        {tags.map(tag => (
          <span key={tag} className="bg-blue-500/10 text-blue-400 border border-blue-500/20 px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 animate-in fade-in zoom-in-50 duration-200">
            #{tag}
            <button onClick={() => removeTag(tag)} className="hover:text-blue-200 p-1 -m-1"><X size={16} /></button>
          </span>
        ))}
        <div className="flex items-center gap-2 bg-gray-800/50 px-4 py-2 rounded-2xl border border-gray-700/50 focus-within:border-blue-500/50 focus-within:bg-gray-800 transition-all">
          <TagIcon size={18} className="text-gray-500" />
          <input
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddTag();
              }
            }}
            onBlur={handleAddTag}
            placeholder="Add custom tag..."
            className="bg-transparent text-sm text-white placeholder-gray-500 focus:outline-none min-w-[120px] py-1"
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {SUGGESTED_TAGS.map(tag => {
          if (tags.includes(tag)) return null;
          return (
            <button
              key={tag}
              onClick={() => toggleTag(tag)}
              className="px-4 py-2 rounded-full text-xs font-bold bg-gray-800 text-gray-400 border border-gray-700 hover:border-gray-500 hover:text-gray-200 transition-all active:scale-95"
            >
              + {tag}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default TagInput;
