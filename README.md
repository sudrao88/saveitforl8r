# SaveItForL8R

A personal second brain application for capturing, organizing, and recalling memories using AI.

## Features

- **Capture Everything**: Save text, images, and links quickly.
- **AI-Powered Organization**: Gemini AI automatically tags, summarizes, and categorizes your inputs.
- **Semantic Search**: Ask questions to your second brain and get answers based on your saved memories.
- **Local & Secure**: All data is stored locally in your browser (IndexedDB) and encrypted.
- **Offline First**: Works without an internet connection.
- **Google Drive Sync**: Optional encrypted backup and sync across devices.

## Tech Stack

- **Frontend**: React, TypeScript, Vite, Tailwind CSS
- **AI**: Google Gemini API (Multimodal)
- **Storage**: IndexedDB (Local), Google Drive (Cloud Sync)
- **Encryption**: Web Crypto API (AES-GCM)
- **Deployment**: Firebase Hosting / Google Cloud Run

## Getting Started

1.  Clone the repository.
2.  Install dependencies: `npm install`
3.  Run development server: `npm run dev`
4.  Build for production: `npm run build`

## Deployment

To deploy to Google Cloud Run:

```bash
gcloud builds submit --tag gcr.io/saveitforl8r-project/saveitforl8r
gcloud run deploy saveitforl8r --image gcr.io/saveitforl8r-project/saveitforl8r --platform managed
```
