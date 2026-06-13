import { describe, it, expect } from 'vitest';
import { shiftEnd } from './EventEditDialog';

describe('shiftEnd', () => {
  it('shifts a timed end by the same offset as the start, preserving duration', () => {
    // Start moved Sat 8/1 → Mon 8/3 (same time); 1h class ends at 16:30
    expect(
      shiftEnd('2026-08-01T15:30:00', '2026-08-03T15:30:00', '2026-08-01T16:30:00', false),
    ).toBe('2026-08-03T16:30:00');
  });

  it('shifts the time of day along with the start', () => {
    expect(
      shiftEnd('2026-08-01T15:30:00', '2026-08-01T18:00:00', '2026-08-01T16:30:00', false),
    ).toBe('2026-08-01T19:00:00');
  });

  it('shifts a multi-day end across the same number of days', () => {
    expect(shiftEnd('2026-06-29', '2026-07-01', '2026-07-02', true)).toBe('2026-07-04');
  });

  it('returns a date-only end when the event becomes all-day', () => {
    expect(
      shiftEnd('2026-08-01T15:30:00', '2026-08-03', '2026-08-01T16:30:00', true),
    ).toBe('2026-08-03');
  });

  it('returns a timed end when an all-day event becomes timed', () => {
    // All-day 6/15–6/16 becomes timed at 09:00 — end must be timed too,
    // keeping the start/end formats consistent.
    expect(shiftEnd('2026-06-15', '2026-06-15T09:00:00', '2026-06-16', false)).toBe(
      '2026-06-16T09:00:00',
    );
  });

  it('returns the old end unchanged when inputs are unparseable', () => {
    expect(shiftEnd('not-a-date', '2026-06-15T09:00:00', '2026-06-16', false)).toBe('2026-06-16');
  });
});
