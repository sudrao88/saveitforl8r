import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import SuggestedMomentSheet from './SuggestedMomentSheet';
import { Memory, EMBEDDING_MODEL_ID } from '../types';
import { MomentSuggestion } from '../utils/momentSuggestions';

vi.mock('../hooks/useBackButton', () => ({ useBackButton: () => {} }));

const note = (id: string, title: string): Memory => ({
  id, content: '', timestamp: Date.UTC(2026, 3, 20), tags: [],
  enrichment: { summary: `${title} summary`, suggestedTags: [], entityContext: { type: 'Place', title } } as Memory['enrichment'],
});

const suggestion: MomentSuggestion = {
  key: 'coffee',
  label: 'Coffee',
  draft: {
    id: 'suggestion:coffee', title: 'Coffee', terms: ['Coffee'], concepts: [['coffee']],
    intentVector: [1, 0], termVectors: [[1, 0]], embeddingModel: EMBEDDING_MODEL_ID, createdAt: 0, updatedAt: 0,
  },
  matches: [{ id: 'n2', score: 2 }, { id: 'n1', score: 1 }, { id: 'n3', score: 0.5 }],
  clusterIds: ['n1', 'n2', 'n3'],
};

const memories = [note('n1', 'Blue Tokai'), note('n2', 'Third Wave Coffee'), note('n3', 'Subko')];

describe('SuggestedMomentSheet', () => {
  it('lists the matched notes in rank order', () => {
    render(
      <SuggestedMomentSheet
        suggestion={suggestion} memories={memories} isCreating={false}
        onClose={() => {}} onAdd={() => {}} onDismiss={() => {}}
      />,
    );
    const titles = screen.getAllByText(/^(Blue Tokai|Third Wave Coffee|Subko)$/).map(e => e.textContent);
    expect(titles).toEqual(['Third Wave Coffee', 'Blue Tokai', 'Subko']);
    expect(screen.getByText(/Suggested from 3 similar notes/)).toBeTruthy();
  });

  it('calls onAdd and onDismiss with the suggestion', () => {
    const onAdd = vi.fn();
    const onDismiss = vi.fn();
    render(
      <SuggestedMomentSheet
        suggestion={suggestion} memories={memories} isCreating={false}
        onClose={() => {}} onAdd={onAdd} onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByText('Add moment'));
    fireEvent.click(screen.getByText('Dismiss'));
    expect(onAdd).toHaveBeenCalledWith(suggestion);
    expect(onDismiss).toHaveBeenCalledWith(suggestion);
  });
});
