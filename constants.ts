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
  }
} as const;
