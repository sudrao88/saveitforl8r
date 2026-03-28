/**
 * Cross-platform file download utility.
 *
 * iOS Safari / WebKit ignores the HTML `download` attribute on data-URI and
 * blob-URL anchor tags, so a plain `<a href download>` link silently does
 * nothing in iOS PWAs and Safari. This module provides a reliable alternative
 * that works across all platforms.
 *
 * Strategy (in order):
 *   1. Web Share API with file — works reliably on iOS ("Save to Files").
 *   2. Blob-URL + programmatic anchor click — works on Chrome, Firefox,
 *      desktop Safari, and most Android browsers.
 */

const isIOS = (): boolean =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.userAgent.includes('Mac') && 'ontouchend' in document);

/**
 * Downloads a file given a Blob/File and a filename.
 */
export async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  const file = blob instanceof File ? blob : new File([blob], filename, { type: blob.type });

  // iOS: prefer Web Share API which lets the user "Save to Files"
  if (isIOS() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      // Fall through to blob-URL approach
    }
  }

  // Standard: create a temporary blob URL and click a hidden anchor
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Delay revoke so the browser can start the download
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Downloads a file from a data URI. Converts to Blob first so the download
 * attribute works on all platforms.
 */
export async function downloadDataUri(dataUri: string, filename: string, mimeType?: string): Promise<void> {
  const response = await fetch(dataUri);
  let blob = await response.blob();

  // If the blob type is empty, re-wrap with the provided mimeType
  if (mimeType && !blob.type) {
    blob = new Blob([blob], { type: mimeType });
  }

  await downloadBlob(blob, filename);
}
