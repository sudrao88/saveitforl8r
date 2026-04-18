/**
 * Cross-platform file download utility.
 *
 * On native apps (Capacitor iOS / Android) the standard `<a download>`
 * technique does nothing — WebView silently ignores programmatic anchor
 * clicks with the `download` attribute, so the button appears unresponsive.
 * iOS Safari / WebKit also ignores the attribute on data- and blob-URIs.
 *
 * Strategy (in order):
 *   1. Capacitor native — write the blob to the public Documents directory
 *      via `@capacitor/filesystem` so it shows up in the user's file
 *      manager. Falls back to `@capacitor/share` (system "Save to ..."
 *      sheet) if writing to Documents fails.
 *   2. iOS web — `navigator.share` with a File lets users "Save to Files".
 *   3. Everywhere else — blob URL + programmatic anchor click.
 */
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { isNative } from './platform';

const isIOS = (): boolean =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.userAgent.includes('Mac') && 'ontouchend' in document);

/**
 * Reads a Blob as a base64 string with no `data:...;base64,` prefix,
 * which is the format Capacitor's Filesystem plugin expects.
 */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('FileReader returned non-string result'));
        return;
      }
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Saves the file on a Capacitor native platform. Tries the public Documents
 * directory first (visible in the user's file manager); on failure, falls
 * back to writing into the app cache and presenting a system share sheet
 * so the user can pick "Save to Downloads" / "Save to Files".
 */
async function saveOnNative(blob: Blob, filename: string): Promise<void> {
  const base64 = await blobToBase64(blob);

  try {
    await Filesystem.writeFile({
      path: filename,
      data: base64,
      directory: Directory.Documents,
      recursive: true,
    });
    const location = Capacitor.getPlatform() === 'android' ? 'Documents' : 'Files';
    // Lightweight feedback so the user knows the download succeeded.
    alert(`Saved "${filename}" to ${location}.`);
    return;
  } catch (primaryErr) {
    console.warn('[download] Documents write failed, falling back to Share:', primaryErr);
    const cached = await Filesystem.writeFile({
      path: filename,
      data: base64,
      directory: Directory.Cache,
      recursive: true,
    });
    try {
      await Share.share({
        title: filename,
        url: cached.uri,
        dialogTitle: `Save ${filename}`,
      });
    } catch (shareErr: unknown) {
      if (shareErr instanceof Error && /cancel/i.test(shareErr.message)) return;
      throw shareErr;
    }
  }
}

/**
 * Downloads a file given a Blob/File and a filename.
 */
export async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  const file = blob instanceof File ? blob : new File([blob], filename, { type: blob.type });

  // Capacitor native (Android / iOS app): WebView ignores <a download>,
  // so write the file with the Filesystem plugin.
  if (isNative()) {
    try {
      await saveOnNative(blob, filename);
      return;
    } catch (err) {
      console.error('[download] Native save failed, falling back to blob URL:', err);
      // Fall through to the web approach as a last resort.
    }
  }

  // iOS web / PWA: prefer Web Share API which lets the user "Save to Files"
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
