
import React from 'react';
import { Zap, Shield, AlertTriangle } from 'lucide-react';
import { Logo } from './icons';

interface LandingPageProps {
  inputApiKey: string;
  setInputApiKey: (key: string) => void;
  saveKey: (key: string) => void;
}

const LandingPage: React.FC<LandingPageProps> = ({ inputApiKey, setInputApiKey, saveKey }) => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 p-4 sm:p-8">
      <div className="max-w-6xl w-full grid lg:grid-cols-2 gap-12 items-center">
        
        {/* Left Column: Marketing Content */}
        <div className="text-left order-1">
           <div className="mb-8">
              <div className="flex items-center gap-4 mb-4">
                   <div className="w-16 h-16 shadow-2xl rounded-2xl overflow-hidden animate-in fade-in zoom-in duration-500 hidden lg:block">
                      <Logo className="w-full h-full" />
                  </div>
                  <div>
                      <h1 className="text-4xl sm:text-5xl font-black text-white tracking-tight leading-tight">SaveItForL8r</h1>
                      <p className="text-xl text-blue-400 font-medium">Your AI-Powered Second Brain</p>
                  </div>
              </div>
           </div>

           <div className="grid gap-6">
              <div className="bg-gray-800/50 p-6 rounded-2xl border border-gray-700 hover:border-blue-500/50 transition-colors group flex gap-4 items-start">
                <div className="w-12 h-12 bg-blue-500/10 rounded-xl flex items-center justify-center shrink-0 group-hover:bg-blue-500/20 transition-colors">
                  <Zap className="text-blue-400" size={24} />
                </div>
                <div>
                  <h3 className="text-white font-bold text-lg mb-1">Smart Organization</h3>
                  <p className="text-gray-400 text-sm leading-relaxed">
                      Gemini automatically tags and categorizes your saved links, images, and notes so you can easily find them later.
                  </p>
                </div>
              </div>

              <div className="bg-gray-800/50 p-6 rounded-2xl border border-gray-700 hover:border-green-500/50 transition-colors group flex gap-4 items-start">
                <div className="w-12 h-12 bg-green-500/10 rounded-xl flex items-center justify-center shrink-0 group-hover:bg-green-500/20 transition-colors">
                  <Shield className="text-green-400" size={24} />
                </div>
                <div>
                  <h3 className="text-white font-bold text-lg mb-1">Private & Local</h3>
                  <p className="text-gray-400 text-sm leading-relaxed">
                      Your data is stored locally on your device. We don't track your memories or store them on external servers.
                  </p>
                </div>
              </div>
           </div>
        </div>

        {/* Right Column: Input Form */}
        <div className="bg-gray-800 p-8 rounded-3xl shadow-xl border border-gray-700 w-full max-w-md mx-auto lg:mx-0 lg:ml-auto order-2">
          
          <h2 className="text-xl font-bold text-white mb-2">Get Started</h2>
          <p className="text-gray-400 mb-6 text-sm leading-relaxed">Please enter your Gemini API Key to enable multimodal knowledge capture.</p>
          
          <div className="space-y-4">
             {/* Billing Alert */}
             <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4">
                <div className="flex gap-3">
                   <AlertTriangle className="text-yellow-500 shrink-0" size={20} />
                   <div className="space-y-1">
                      <p className="text-sm text-yellow-200 font-bold">Billing Required</p>
                      <p className="text-xs text-yellow-500/80 leading-relaxed">
                         Your API key must be from a Google Cloud project with billing enabled to use search features.
                      </p>
                      <a 
                        href="https://ai.google.dev/gemini-api/docs/api-key" 
                        target="_blank" 
                        rel="noreferrer" 
                        className="text-xs text-yellow-400 hover:text-yellow-300 underline block mt-2 font-medium"
                      >
                         View setup guide →
                      </a>
                   </div>
                </div>
             </div>

             <input 
                type="password"
                value={inputApiKey}
                onChange={(e) => setInputApiKey(e.target.value)}
                placeholder="Enter Gemini API Key"
                className="w-full bg-gray-700 text-white px-4 py-3 rounded-xl border border-gray-600 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
             />
             <button 
               onClick={() => saveKey(inputApiKey)}
               className="w-full bg-blue-600 text-white px-6 py-4 rounded-2xl hover:bg-blue-700 transition-all font-bold shadow-lg shadow-blue-900/50 disabled:opacity-50 disabled:cursor-not-allowed transform active:scale-95"
               disabled={!inputApiKey.trim()}
             >
               Connect API Key
             </button>
             <p className="text-xs text-gray-500 mt-4">
                Don't have a key? <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">Get one here</a>
             </p>
          </div>
        </div>

      </div>
    </div>
  );
};

export default LandingPage;
