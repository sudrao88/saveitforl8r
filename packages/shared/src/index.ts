// @l8r/shared — barrel for the genuinely-shared plumbing extracted from
// saveitforl8r (M1). Subpath entrypoints (./auth, ./ai, ./crypto, ./platform,
// ./design-system) are the preferred imports; this root barrel re-exports the
// runtime service groups for convenience.
export * from './auth';
export * from './ai';
export * from './crypto';
export * from './platform';
