import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import MomentSheet, { SECTION_VIEW_KEY } from './MomentSheet';
import { Memory, Moment, EMBEDDING_MODEL_ID } from '../types';

vi.mock('../hooks/useBackButton', () => ({ useBackButton: () => {} }));

const mapsConfigured = vi.fn(() => false);
vi.mock('../services/googleMaps', () => ({
  isMapsConfigured: () => mapsConfigured(),
  loadGoogleMaps: () => Promise.reject(new Error('no SDK in tests')),
  resolvePlaceLocations: async () => new Map(),
}));

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

describe('MomentSheet hidden notes', () => {
  const renderWithHidden = (excludedNoteIds: string[], onUnhideNote = vi.fn(async () => {})) =>
    render(
      <MomentSheet
        moment={{ ...moment, excludedNoteIds }}
        memories={[note('n1', 'Beyond Bean Coffee'), note('n2', 'Third Wave Coffee')]}
        matches={[{ id: 'n1', score: 1 }]}
        isEmbedding={false}
        onClose={() => {}}
        onDelete={async () => {}}
        onHideNote={async () => {}}
        onUnhideNote={onUnhideNote}
        onRetryEmbedding={async () => {}}
      />,
    );

  it('lists hidden notes on request and unhides one', () => {
    const onUnhideNote = vi.fn(async () => {});
    renderWithHidden(['n2'], onUnhideNote);
    expect(screen.queryByText('Third Wave Coffee')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /1 note hidden/ }));
    expect(screen.getByText('Third Wave Coffee')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Show in this moment'));
    expect(onUnhideNote).toHaveBeenCalledWith('m1', 'n2');
  });

  it('does not count hidden notes that have since been deleted', () => {
    renderWithHidden(['n2', 'gone']);
    expect(screen.getByRole('button', { name: /1 note hidden/ })).toBeTruthy();
  });
});

describe('MomentSheet sharing', () => {
  it('shares the moment as formatted text', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    renderSheet([{ id: 'n1', score: 1 }]);
    fireEvent.click(screen.getByLabelText('Share moment'));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const { title, text } = share.mock.calls[0][0];
    expect(title).toBe('☕ Cafes in bangalore');
    expect(text).toContain('1. Beyond Bean Coffee');
    delete (navigator as { share?: unknown }).share;
  });
});

describe('MomentSheet subsections', () => {
  // Unit vector at a given angle, so notes near the same angle cluster.
  const at = (deg: number): number[] => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
  const DAY = 24 * 60 * 60 * 1000;
  const topicNote = (id: string, deg: number, tag: string, day: number): Memory => ({
    id, content: '', timestamp: new Date(2025, 2, 10, 12).getTime() + day * DAY, tags: [tag],
    enrichment: {
      summary: '', suggestedTags: [], embedding: at(deg), embeddingModel: EMBEDDING_MODEL_ID,
      entityContext: { type: 'Place', title: `Title ${id}` },
    } as Memory['enrichment'],
  });
  // Two topics; saved in two bursts that cut across them (a, d, b | c, e, f).
  const memories = [
    topicNote('a', 0, 'espresso', 0), topicNote('b', 5, 'espresso', 2), topicNote('c', 10, 'espresso', 90),
    topicNote('d', 90, 'brunch', 1), topicNote('e', 95, 'brunch', 91), topicNote('f', 100, 'brunch', 92),
  ];
  const matches = memories.map((m, i) => ({ id: m.id, score: 1 - i / 10 }));

  const renderSectioned = (onHideNote = vi.fn(async () => {})) =>
    render(
      <MomentSheet
        moment={moment}
        memories={memories}
        matches={matches}
        isEmbedding={false}
        onClose={() => {}}
        onDelete={async () => {}}
        onHideNote={onHideNote}
        onRetryEmbedding={async () => {}}
      />,
    );
  const headings = () => screen.queryAllByRole('heading', { level: 3 }).map(h => h.textContent);
  const titles = () => screen.getAllByText(/^Title /).map(el => el.textContent);

  beforeEach(() => localStorage.clear());

  it('groups notes under section headers, best grouping first', () => {
    renderSectioned();
    expect(headings()).toEqual(['Espresso', 'Brunch']);
    expect(titles()).toEqual(['Title a', 'Title b', 'Title c', 'Title d', 'Title e', 'Title f']);
    expect(screen.getByRole('button', { name: 'Types' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('switches grouping, goes back to relevance order, and remembers the choice', () => {
    const first = renderSectioned();
    fireEvent.click(screen.getByRole('button', { name: 'Timeline' }));
    expect(headings()).toEqual(['8–10 Jun 2025', '10–12 Mar 2025']);
    expect(titles()).toEqual(['Title c', 'Title e', 'Title f', 'Title a', 'Title b', 'Title d']);

    fireEvent.click(screen.getByRole('button', { name: 'Relevance' }));
    expect(headings()).toEqual([]);
    expect(titles()).toEqual(['Title a', 'Title b', 'Title c', 'Title d', 'Title e', 'Title f']);
    expect(JSON.parse(localStorage.getItem(SECTION_VIEW_KEY)!)).toEqual({ m1: 'relevance' });

    first.unmount();
    renderSectioned();
    expect(headings()).toEqual([]);
  });

  it('still hides a note from inside a section', () => {
    const onHideNote = vi.fn(async () => {});
    renderSectioned(onHideNote);
    fireEvent.click(screen.getAllByLabelText('Hide from this moment')[3]);
    expect(onHideNote).toHaveBeenCalledWith('m1', 'd');
  });

  it('shows no grouping chips for a small moment', () => {
    renderSheet([{ id: 'n1', score: 1 }, { id: 'n2', score: 0.5 }]);
    expect(screen.queryByRole('button', { name: 'Relevance' })).toBeNull();
  });

  it('shares the notes under their section labels', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    renderSectioned();
    fireEvent.click(screen.getByLabelText('Share moment'));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const { text } = share.mock.calls[0][0];
    expect(text).toContain('ESPRESSO\n\n1. Title a');
    expect(text).toContain('BRUNCH\n\n4. Title d');
    delete (navigator as { share?: unknown }).share;
  });
});

describe('MomentSheet map', () => {
  const withPlace = (m: Memory, name: string, placeId: string): Memory => ({
    ...m,
    enrichment: { ...m.enrichment!, places: [{ name, placeId, mapsUri: `https://maps.example/${placeId}` }] },
  });
  const renderWith = (memories: Memory[]) =>
    render(
      <MomentSheet
        moment={moment} memories={memories} matches={[{ id: 'n1', score: 1 }, { id: 'n2', score: 0.5 }]}
        isEmbedding={false} onClose={() => {}} onDelete={async () => {}} onHideNote={async () => {}} onRetryEmbedding={async () => {}}
      />,
    );

  it('offers a map only when notes have places and the Maps SDK is configured', async () => {
    const memories = [withPlace(note('n1', 'Beyond Bean Coffee'), 'Beyond Bean', 'ChIJbeyondbean1'), note('n2', 'Third Wave Coffee')];
    mapsConfigured.mockReturnValue(false);
    const first = renderWith(memories);
    expect(screen.queryByLabelText('Show places on a map')).toBeNull();
    first.unmount();

    mapsConfigured.mockReturnValue(true);
    const second = renderWith([note('n1', 'Beyond Bean Coffee'), note('n2', 'Third Wave Coffee')]);
    expect(screen.queryByLabelText('Show places on a map')).toBeNull();
    second.unmount();

    renderWith(memories);
    fireEvent.click(screen.getByLabelText('Show places on a map'));
    expect(await screen.findByRole('dialog', { name: 'Map: Cafes in bangalore' })).toBeTruthy();
  });
});
