import { useState } from 'react';

export const useSettings = () => {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  return {
    isSettingsOpen,
    setIsSettingsOpen,
  };
};
