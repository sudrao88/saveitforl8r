/**
 * Open Graph image fetching service — extracts og:image preview images
 * from URLs found in user notes during enrichment.
 */
import { isPublicUrl } from './gemini.js';

const MAX_URLS = 3;
const HTML_FETCH_TIMEOUT_MS = 5_000;
const IMAGE_FETCH_TIMEOUT_MS = 5_000;
const GLOBAL_TIMEOUT_MS = 10_000;
const MAX_HTML_BYTES = 50_000;
const MAX_IMAGE_BYTES = 500_000;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const USER_AGENT = 'Mozilla/5.0 (compatible; SaveItForL8R/1.0; +https://saveitforl8r.com)';
const MAX_REDIRECTS = 3;

/**
 * Fetch a URL with manual redirect following, validating each hop against SSRF.
 * Returns the final Response or null if any hop fails validation.
 */
const safeFetch = async (url, options, timeoutMs) => {
  let currentUrl = url;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    if (!isPublicUrl(currentUrl)) {
      console.warn(`[OG] SSRF blocked: ${currentUrl}`);
      return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(currentUrl, {
        ...options,
        signal: controller.signal,
        redirect: 'manual',
      });
      clearTimeout(timeout);

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) return null;
        try {
          currentUrl = new URL(location, currentUrl).href;
        } catch {
          return null;
        }
        continue;
      }

      return response;
    } catch (err) {
      clearTimeout(timeout);
      console.warn(`[OG] Fetch failed for ${currentUrl}: ${err.message}`);
      return null;
    }
  }
  console.warn(`[OG] Too many redirects for ${url}`);
  return null;
};

/**
 * Extract meta tag content from HTML using regex.
 * Searches for <meta property="..." content="..."> and <meta name="..." content="..."> patterns.
 */
const extractMetaContent = (html, propertyOrName) => {
  // Match both property="X" and name="X" attributes, with content in either order
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${propertyOrName}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${propertyOrName}["']`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
};

/**
 * Extract image URL from link rel="image_src" tag.
 */
const extractLinkImageSrc = (html) => {
  const pattern = /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i;
  const match = html.match(pattern);
  return match?.[1] || null;
};

/**
 * Find the best preview image URL from HTML meta tags.
 * Priority: og:image > twitter:image > twitter:image:src > link[rel=image_src]
 */
const findPreviewImageUrl = (html) => {
  return (
    extractMetaContent(html, 'og:image') ||
    extractMetaContent(html, 'twitter:image') ||
    extractMetaContent(html, 'twitter:image:src') ||
    extractLinkImageSrc(html) ||
    null
  );
};

/**
 * Resolve a potentially relative URL against a base URL.
 */
const resolveUrl = (imageUrl, pageUrl) => {
  try {
    return new URL(imageUrl, pageUrl).href;
  } catch {
    return null;
  }
};

/**
 * Fetch the HTML <head> of a page (limited to MAX_HTML_BYTES).
 * Uses safeFetch to validate each redirect hop against SSRF.
 */
const fetchHtmlHead = async (url) => {
  try {
    const response = await safeFetch(
      url,
      { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' } },
      HTML_FETCH_TIMEOUT_MS
    );
    if (!response || !response.ok) return null;

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) return null;

    // Read limited bytes using the response body reader
    const reader = response.body.getReader();
    const chunks = [];
    let totalBytes = 0;

    while (totalBytes < MAX_HTML_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalBytes += value.length;
    }
    reader.cancel();

    const decoder = new TextDecoder('utf-8', { fatal: false });
    return decoder.decode(Buffer.concat(chunks).slice(0, MAX_HTML_BYTES));
  } catch (err) {
    console.warn(`[OG] fetchHtmlHead failed for ${url}: ${err.message}`);
    return null;
  }
};

/**
 * Fetch an image and convert it to a base64 data URI.
 * Uses safeFetch to validate each redirect hop against SSRF.
 */
const fetchImageAsBase64 = async (imageUrl) => {
  try {
    const response = await safeFetch(
      imageUrl,
      { headers: { 'User-Agent': USER_AGENT } },
      IMAGE_FETCH_TIMEOUT_MS
    );
    if (!response || !response.ok) return null;

    const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.includes(contentType)) return null;

    const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
    if (contentLength > MAX_IMAGE_BYTES) return null;

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_IMAGE_BYTES) return null;

    const base64 = Buffer.from(arrayBuffer).toString('base64');
    return {
      dataUri: `data:${contentType};base64,${base64}`,
      mimeType: contentType,
    };
  } catch (err) {
    console.warn(`[OG] fetchImageAsBase64 failed for ${imageUrl}: ${err.message}`);
    return null;
  }
};

/**
 * Fetch a single URL's Open Graph preview image and metadata.
 * Returns a LinkPreview object or null on failure.
 */
const fetchSingleOgImage = async (url) => {
  try {
    const html = await fetchHtmlHead(url);
    if (!html) return null;

    const rawImageUrl = findPreviewImageUrl(html);
    if (!rawImageUrl) return null;

    const resolvedImageUrl = resolveUrl(rawImageUrl, url);
    if (!resolvedImageUrl || !isPublicUrl(resolvedImageUrl)) return null;

    const imageResult = await fetchImageAsBase64(resolvedImageUrl);
    if (!imageResult) return null;

    const title = extractMetaContent(html, 'og:title') || undefined;
    const description = extractMetaContent(html, 'og:description') || undefined;

    return {
      url,
      imageData: imageResult.dataUri,
      imageMimeType: imageResult.mimeType,
      title,
      description,
    };
  } catch (err) {
    console.warn(`[OG] fetchSingleOgImage failed for ${url}: ${err.message}`);
    return null;
  }
};

/**
 * Fetch Open Graph preview images for an array of URLs.
 * Processes up to MAX_URLS URLs concurrently with a global timeout.
 * Never throws — returns an empty array on failure.
 *
 * @param {string[]} urls - URLs already validated by extractUrls (public only)
 * @returns {Promise<Array<{url: string, imageData: string, imageMimeType: string, title?: string, description?: string}>>}
 */
export const fetchOgImages = async (urls) => {
  if (!urls || urls.length === 0) return [];

  const urlsToProcess = urls.slice(0, MAX_URLS);

  try {
    const results = await Promise.race([
      Promise.allSettled(urlsToProcess.map(fetchSingleOgImage)),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('OG image fetch global timeout')), GLOBAL_TIMEOUT_MS)
      ),
    ]);

    return results
      .filter((r) => r.status === 'fulfilled' && r.value !== null)
      .map((r) => r.value);
  } catch (err) {
    console.warn(`[OG] fetchOgImages failed: ${err.message}`);
    return [];
  }
};
