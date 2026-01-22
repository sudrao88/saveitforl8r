import React, { useState } from 'react';
import { X, Key, ShieldCheck, AlertTriangle, Loader2 } from 'lucide-react';

interface ApiKeyModalProps {
  onClose: () => void;
  onSave: (key: string) => void;
}

const ApiKeyModal: React.FC<ApiKeyModalProps> = ({ onClose, onSave }) => {
  const [apiKey, setApiKey] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!apiKey.trim()) {
      setError('Please enter a valid API key');
      return;
    }

    setIsValidating(true);
    setError('');

    try {
        // Basic validation logic (can be expanded)
        onSave(apiKey);
        onClose();
    } catch (err) {
        setError('Failed to save API key');
    } finally {
        setIsValidating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-gray-800 border border-gray-700 rounded-3xl p-6 max-w-md w-full shadow-2xl relative">
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
        >
          <X size={20} />
        </button>

        <div className="flex flex-col items-center text-center mb-6">
            <div className="w-16 h-16 bg-blue-600/20 rounded-2xl flex items-center justify-center mb-4 text-blue-400">
                <Key size={32} />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Enter Gemini API Key</h2>
            <p className="text-gray-400 text-sm max-w-[80%] mb-3">
                To unlock AI features like auto-tagging and summarization, you need to provide a Google Gemini API Key.
            </p>
            <a 
              href="https://aistudio.google.com/app/api-keys" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 text-sm font-medium hover:underline transition-colors"
            >
              Get an API Key
            </a>
        </div>

        <div className="space-y-4">
            <div className="space-y-2">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">API Key</label>
                <input 
                    type="password" 
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="AIzaSy..."
                    className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-colors font-mono text-sm"
                />
                 {error && <p className="text-red-400 text-xs ml-1">{error}</p>}
            </div>

            <div className="bg-amber-900/10 border border-amber-900/30 p-3 rounded-xl flex items-start gap-3">
                 <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
                 <p className="text-xs text-amber-200/80 leading-relaxed text-left">
                    Ensure your API key is from a project with billing enabled to avoid usage limits. Your key is stored locally on your device.
                 </p>
            </div>

            <button 
                onClick={handleSave}
                disabled={isValidating}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3.5 rounded-xl transition-all shadow-lg shadow-blue-900/20 hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
                {isValidating ? <Loader2 className="animate-spin" size={20} /> : 'Save API Key'}
            </button>
            
             <div className="flex items-center justify-center gap-2 text-xs text-gray-500 pt-2">
                <ShieldCheck size={14} />
                <span>Encrypted & stored locally</span>
            </div>
        </div>
      </div>
    </div>
  );
};

export default ApiKeyModal;
