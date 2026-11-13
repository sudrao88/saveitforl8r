import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import MomentSheet from './MomentSheet';
import { Memory, Moment, EMBEDDING_MODEL_ID } from '../types';

vi.mock('../hooks/useBackButton', () => ({ useBackButton: () => {} }));

const moment: Moment = {
  id: 'm1', title: 'Cafes in bangalore', terms: ['Cafes in bangalore'],
  termVectors: [[1, 0]], intentVector: [1, 0], embeddingModel: EMBEDDING_MODEL_ID,
  concepts: [['cafe'], ['bangalore']], emoji: '☕', createdAt: 0, updatedAt: 0,
};

const note = (id: string, title: string): Memory => ({
  id, content: '', timestamp: Date.UTC(2026, 3, 20), tags: [],
  enrichment: { summary: `${title} summary`, suggestedTags: [], entityContext: { type: 'Place', title } } as Memory['enrichment'],
});

const renderSheet = (matches: { id: string; score: number; matched?: string[] }[]) =>
  render(
    <MomentSheet
      moment={moment}
      memories={[note('n1', 'Beyond Bean Coffee'), note('n2', 'Third Wave Coffee')]}
      matches={matches}
      isEmbedding={false}
      onClose={() => {}}
      onDelete={async () => {}}
      onHideNote={async () => {}}
      onRetryEmbedding={async () => {}}
    />,
  );

describe('MomentSheet', () => {
  it('shows the words each note matched on', () => {
    renderSheet([{ id: 'n1', score: 1, matched: ['cafe', 'bengaluru'] }, { id: 'n2', score: 0.5 }]);
    expect(screen.getByText('Beyond Bean Coffee')).toBeTruthy();
    expect(screen.getByText(/matched cafe, bengaluru/)).toBeTruthy();
    expect(screen.getAllByText(/matched/)).toHaveLength(1); // n2 has no matched words
  });

  it('shows the empty state, not the setup state, for a moment with concepts and no matches', () => {
    renderSheet([]);
    expect(screen.getByText('No matching notes yet')).toBeTruthy();
  });
});
