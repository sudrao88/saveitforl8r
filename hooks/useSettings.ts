
import { useState, useEffect, useCallback } from 'react';

export const useSettings = () => {
  const [apiKeySet, setApiKeySet] = useState(false);
  const [inputApiKey, setInputApiKey] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  useEffect(() => {
    const checkKey = async () => {
        const storedKey = localStorage.getItem('gemini_api_key');
        if (storedKey) {
            setApiKeySet(true);
        }
    };
    checkKey();
  }, []);

  const saveKey = useCallback((key: string) => {
    if (key.trim()) {
        localStorage.setItem('gemini_api_key', key.trim());
        setApiKeySet(true);
    }
  }, []);

  const clearKey = useCallback(() => {
    localStorage.removeItem('gemini_api_key');
    localStorage.removeItem('saveitforl8r_access');
    setApiKeySet(false);
    setInputApiKey('');
    setIsSettingsOpen(false);
  }, []);

  return {
    apiKeySet,
    inputApiKey,
    setInputApiKey,
    isSettingsOpen,
    setIsSettingsOpen,
    saveKey,
    clearKey
  };
};
