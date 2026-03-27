export const STORAGE_KEYS = {
  HAS_SEEN_SHARE_ONBOARDING: 'hasSeenShareOnboarding',
} as const;

export const ANALYTICS_EVENTS = {
  ONBOARDING: {
    CATEGORY: 'Onboarding',
    ACTION_DISMISSED: 'Share Modal Dismissed',
  },
  SHARE: {
    CATEGORY: 'Share',
    ACTION_RECEIVED: 'Received',
    LABEL_EXTERNAL: 'External Share',
  },
  MEMORY: {
    CATEGORY: 'Memory',
    ACTION_CAPTURE_CANCELLED: 'Capture Cancelled',
    ACTION_CREATED: 'Created',
    ACTION_DELETED: 'Deleted',
    ACTION_RETRIED: 'Retried',
  },
  CHAT: {
    CATEGORY: 'Chat',
    ACTION_CLOSED: 'Closed',
  },
  NAVIGATION: {
    CATEGORY: 'Navigation',
    ACTION_VIEW_CHANGED: 'View Changed',
    ACTION_SETTINGS_OPENED: 'Settings Opened',
    ACTION_CAPTURE_OPENED: 'Capture Opened',
  },
  FILTER: {
    CATEGORY: 'Filter',
    ACTION_CLEARED: 'Cleared',
    ACTION_CLEARED_EMPTY: 'Cleared from Empty State',
    ACTION_APPLIED: 'Applied',
  },
  APP: {
    CATEGORY: 'App',
    ACTION_UPDATED: 'Updated',
  },
  SETTINGS: {
    CATEGORY: 'Settings',
    ACTION_CLOSED: 'Closed',
  },
  DATA: {
    CATEGORY: 'Data',
    ACTION_IMPORT_SUCCESS: 'Import Success',
  },
  AUTH: {
    CATEGORY: 'Auth',
    ACTION_LOGIN_SUCCESS: 'Login successful',
    ACTION_CALLBACK_FAILED: 'Callback processing failed',
    ACTION_LOGOUT: 'Logout',
  },
  QUICK_NOTE: {
    CATEGORY: 'QuickNote',
    ACTION_SAVED: 'Saved',
    ACTION_EXPANDED: 'Expanded',
  },
  ENRICHMENT: {
    CATEGORY: 'Enrichment',
    ACTION_COMPLETED: 'Completed',
    ACTION_FAILED: 'Failed',
  },
  MOMENT: {
    CATEGORY: 'Moment',
    ACTION_CREATED: 'Created',
    ACTION_DELETED: 'Deleted',
  },
  CALENDAR_EVENT: {
    CATEGORY: 'CalendarEvent',
    ACTION_CREATED: 'Created',
  },
  TODO_ITEM: {
    CATEGORY: 'TodoItem',
    ACTION_CREATED: 'Created',
    ACTION_COMPLETED: 'Completed',
    ACTION_UNCOMPLETED: 'Uncompleted',
    ACTION_DISMISSED: 'Dismissed',
    ACTION_RESTORED: 'Restored',
  },
  NOTIFICATION: {
    CATEGORY: 'Notification',
    ACTION_SCHEDULED: 'Scheduled',
    ACTION_PERMISSION_GRANTED: 'Permission Granted',
    ACTION_SETTING_CHANGED: 'Setting Changed',
  },
  DELETION_CANDIDATES: {
    CATEGORY: 'DeletionCandidates',
    ACTION_OPENED: 'Opened',
    ACTION_DELETED: 'Deleted',
    ACTION_DISMISSED: 'Dismissed',
  },
} as const;

/**
 * Shared polling timing constants.
 * Used by enrichment, moment creation, and synthesis polling.
 */
export const POLLING = {
  /** Poll every 1s during the initial fast-polling tier. */
  FAST_INTERVAL_MS: 1_000,
  /** Poll every 2s after the fast tier expires. */
  SLOW_INTERVAL_MS: 2_000,
  /** Duration of the fast-polling tier (first 15 seconds). */
  FAST_TIER_MS: 15_000,
  /** Enrichment polling timeout. */
  ENRICHMENT_TIMEOUT_MS: 120_000,
  /** Moment creation polling timeout (3-step pipeline takes longer). */
  MOMENT_CREATION_TIMEOUT_MS: 180_000,
  /** Re-synthesis polling timeout. */
  SYNTHESIS_TIMEOUT_MS: 120_000,
} as const;
