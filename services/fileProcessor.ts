import * as pdfjsLib from 'pdfjs-dist';
import Tesseract from 'tesseract.js';

// Set the worker source for pdfjs-dist. 
// In Vite, this often requires copying the worker file to public or importing it specifically.
// For now, we'll try using the CDN link or a local import if configured in vite.config.ts.
// A common pattern in Vite is `import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';`
// But to be safe with standard setups:
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.js`;

export const extractTextFromPDF = async (pdfBlob: Blob): Promise<string> => {
  try {
    const arrayBuffer = await pdfBlob.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    let fullText = '';

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str).join(' ');
      fullText += pageText + '\n';
    }

    return fullText.trim();
  } catch (error) {
    console.error('Error extracting text from PDF:', error);
    throw error;
  }
};

export const extractTextFromImage = async (imageBlob: Blob): Promise<string> => {
  try {
    // Tesseract.js recognizes Blobs directly
    const result = await Tesseract.recognize(
      imageBlob,
      'eng',
      {
        logger: m => console.log(m) // Optional: progress logging
      }
    );
    return result.data.text.trim();
  } catch (error) {
    console.error('Error performing OCR on image:', error);
    throw error;
  }
};
