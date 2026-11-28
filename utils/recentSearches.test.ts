import { describe, it, expect, beforeEach } from 'vitest';
import { addRecentSearch, clearRecentSearches, loadRecentSearches, removeRecentSearch, MAX_RECENT_SEARCHES } from './recentSearches';

describe('recentSearches', () => {
  beforeEach(() => localStorage.clear());

  it('keeps the most recent first and de-duplicates case-insensitively', () => {
    addRecentSearch('coffee');
    addRecentSearch('shoes');
    expect(addRecentSearch('  Coffee ')).toEqual(['Coffee', 'shoes']);
  });

  it('caps the list', () => {
    for (let i = 0; i < MAX_RECENT_SEARCHES + 3; i++) addRecentSearch(`q${i}`);
    expect(loadRecentSearches()).toHaveLength(MAX_RECENT_SEARCHES);
    expect(loadRecentSearches()[0]).toBe(`q${MAX_RECENT_SEARCHES + 2}`);
  });

  it('removes one entry or clears all', () => {
    addRecentSearch('a');
    addRecentSearch('b');
    expect(removeRecentSearch('a')).toEqual(['b']);
    clearRecentSearches();
    expect(loadRecentSearches()).toEqual([]);
  });

  it('ignores corrupt storage', () => {
    localStorage.setItem('recentSearches', '{not json');
    expect(loadRecentSearches()).toEqual([]);
  });
});
