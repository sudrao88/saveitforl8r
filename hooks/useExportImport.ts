
import { useState, useRef } from 'react';
import { getMemories, saveMemory } from '../services/storageService';
import { memoriesToCSV, csvToMemories } from '../services/csvService';

export const useExportImport = (onImportSuccess: () => void) => {
  const [exportSelectedTypes, setExportSelectedTypes] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    let data = await getMemories();

    if (exportSelectedTypes.length > 0) {
        data = data.filter(m => {
            const type = m.enrichment?.entityContext?.type;
            return type && exportSelectedTypes.includes(type);
        });
    }

    if (data.length === 0) {
        alert("No memories match the selected filters.");
        return;
    }

    const csvString = memoriesToCSV(data);
    const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `saveitforl8r-backup-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleImportClick = () => {
      fileInputRef.current?.click();
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const content = e.target?.result as string;
        
        if (file.name.endsWith('.csv')) {
            const parsedMemories = csvToMemories(content);
            if (parsedMemories.length > 0) {
                 let count = 0;
                 for (const mem of parsedMemories) {
                     await saveMemory(mem);
                     count++;
                 }
                 alert(`Successfully imported ${count} memories from CSV.`);
                 onImportSuccess();
            } else {
                alert("No valid memories found in CSV.");
            }
        } else {
             alert("Please upload a valid .csv file.");
        }
      } catch (error) {
        console.error("Import failed:", error);
        alert("Failed to import file.");
      }
      if (fileInputRef.current) {
          fileInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  return {
    exportSelectedTypes,
    setExportSelectedTypes,
    fileInputRef,
    handleExport,
    handleImportClick,
    handleImportFile
  };
};
