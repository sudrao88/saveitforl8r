import { useState, useEffect, useCallback } from 'react';
import { storage } from '../services/platform';

export const useSettings = () => {
  const [apiKeySet, setApiKeySet] = useState(false);
  const [inputApiKey, setInputApiKey] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  useEffect(() => {
    const checkKey = async () => {
        const storedKey = await storage.get('gemini_api_key');
        if (storedKey) {
            setApiKeySet(true);
        }
    };
    checkKey();
  }, []);

  const saveKey = useCallback(async (key: string) => {
    if (key.trim()) {
        await storage.set('gemini_api_key', key.trim());
        setApiKeySet(true);
    }
  }, []);

  const clearKey = useCallback(async () => {
    await storage.remove('gemini_api_key');
    await storage.remove('saveitforl8r_access');
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
