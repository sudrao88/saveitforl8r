import * as pdfjsLib from 'pdfjs-dist';
import Tesseract from 'tesseract.js';

// Bundle the PDF.js worker locally via Vite's ?url import instead of loading
// from a CDN at runtime. This is critical for an offline-first PWA — the CDN
// would be unavailable offline. Vite emits the worker into /assets/ which the
// service worker caches automatically.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

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
