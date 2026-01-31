import { Memory } from '../types';

const timestamp = Date.now();

export const SAMPLE_MEMORIES: Memory[] = [
  {
    id: 'sample-ai',
    timestamp: timestamp - 2000,
    content: 'AI Powered',
    tags: ['AI', 'Gemini', 'Context'],
    isSample: true,
    enrichment: {
      summary: 'AI adds context to your memories and helps you find them later by searching in natural language.',
      locationIsRelevant: false,
      suggestedTags: ['AI', 'Gemini'],
      entityContext: {
        type: 'Sample',
        title: 'Contextual Recall',
        subtitle: 'Powered by Gemini',
        description: 'AI adds context to your memories, making them richer. It also helps you find memories from the past by asking questions in natural language.'
      }
    }
  },
  {
    id: 'sample-offline',
    timestamp: timestamp,
    content: 'Offline Access',
    tags: ['Offline', 'Device'],
    isSample: true,
    enrichment: {
      summary: 'Access the memories you save even without an internet connection. Easily view and filter things even in airplane mode!',
      locationIsRelevant: false,
      suggestedTags: ['Offline', 'Device'],
      entityContext: {
        type: 'Sample',
        title: 'Available without internet',
        subtitle: 'Even in airplane mode',
        description: 'Since all your memories are stored on your device, you can easily retrieve them even when you do not have internet access. You can view old memories and even use filters when offline. You can add new memories, which can be enriched once you have internet access.'
      }
    }
  },
  {
    id: 'sample-security',
    timestamp: timestamp - 1000,
    content: 'Privacy First',
    tags: ['Privacy', 'Security', 'Encrypted'],
    isSample: true,
    enrichment: {
      summary: 'Your memories are stored locally on this device and encrypted. We do not store your data on any cloud server.',
      locationIsRelevant: false,
      suggestedTags: ['Privacy', 'Security'],
      entityContext: {
        type: 'Sample',
        title: 'Private & Secure',
        subtitle: 'Encrypted Local Storage',
        description: 'Your data lives in your browser. We use advanced encryption to ensure only you can access your memories. Clear your cache only if you have a backup!'
      }
    }
  }
];
