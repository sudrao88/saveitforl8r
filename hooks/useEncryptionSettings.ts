
import { useState, useRef } from 'react';
import { exportEncryptionKey, restoreEncryptionKey } from '../services/encryptionService';
import { downloadBlob } from '../services/downloadService';

export const useEncryptionSettings = () => {
  const [showKeyWarning, setShowKeyWarning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDownloadKey = async () => {
    const key = await exportEncryptionKey();
    if (!key) {
        alert("No encryption key found to export.");
        return;
    }
    
    const blob = new Blob([key], { type: 'application/json' });
    const filename = `saveitforl8r-key-${new Date().toISOString().slice(0, 10)}.json`;
    await downloadBlob(blob, filename);
  };

  const handleRestoreClick = () => {
      // Trigger the hidden file input
      fileInputRef.current?.click();
  };

  const handleRestoreFile = (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (e) => {
          const content = e.target?.result as string;
          if (content) {
              const success = await restoreEncryptionKey(content);
              if (success) {
                  alert("Encryption key restored successfully! Please refresh the app.");
                  window.location.reload();
              } else {
                  alert("Invalid key file. Restoration failed.");
              }
          }
      };
      reader.readAsText(file);
      
      // Reset input
      event.target.value = '';
  };

  return {
    handleDownloadKey,
    handleRestoreClick,
    handleRestoreFile,
    fileInputRef,
    showKeyWarning,
    setShowKeyWarning
  };
};
