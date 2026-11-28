/**
 * Recent search queries, kept on this device only (never synced). Most
 * recent first, case-insensitively de-duplicated.
 */

const STORAGE_KEY = 'recentSearches';
export const MAX_RECENT_SEARCHES = 8;
const MAX_QUERY_CHARS = 200;

const read = (): string[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((q): q is string => typeof q === 'string' && q.trim() !== '') : [];
  } catch {
    return [];
  }
};

const write = (list: string[]): string[] => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Storage unavailable (private mode, quota) — keep the in-memory list.
  }
  return list;
};

export const loadRecentSearches = (): string[] => read().slice(0, MAX_RECENT_SEARCHES);

export const addRecentSearch = (query: string): string[] => {
  const q = query.trim().replace(/\s+/g, ' ').slice(0, MAX_QUERY_CHARS);
  if (!q) return loadRecentSearches();
  const rest = read().filter(r => r.toLowerCase() !== q.toLowerCase());
  return write([q, ...rest].slice(0, MAX_RECENT_SEARCHES));
};

export const removeRecentSearch = (query: string): string[] =>
  write(read().filter(r => r !== query));

export const clearRecentSearches = (): void => {
  write([]);
};
