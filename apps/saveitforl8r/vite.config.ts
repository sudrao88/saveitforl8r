import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Resolve a path inside the shared workspace package (consumed as TS source).
const shared = (p: string) => fileURLToPath(new URL(`../../packages/shared/src/${p}`, import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    base: '/',
    plugins: [
      react(),
      tailwindcss(),
    ],
    resolve: {
      // Mirror the @l8r/shared exports map. Pointing every specifier at the
      // real source files keeps a single module instance (no duplicate
      // encryption singletons) and lets vitest resolve vi.mock targets.
      alias: [
        { find: '@l8r/shared/tokens.css', replacement: shared('design-system/tokens.css') },
        { find: '@l8r/shared/design-system', replacement: shared('design-system/design-system.ts') },
        { find: '@l8r/shared/auth', replacement: shared('auth/index.ts') },
        { find: '@l8r/shared/ai', replacement: shared('ai/index.ts') },
        { find: '@l8r/shared/crypto', replacement: shared('crypto/index.ts') },
        { find: '@l8r/shared/platform', replacement: shared('platform/index.ts') },
        { find: '@l8r/shared', replacement: shared('index.ts') },
      ],
    },
    define: {
      'import.meta.env.VITE_GOOGLE_CLIENT_ID': JSON.stringify(env.VITE_GOOGLE_CLIENT_ID),
      'import.meta.env.VITE_GOOGLE_CLIENT_SECRET': JSON.stringify(env.VITE_GOOGLE_CLIENT_SECRET),
      'import.meta.env.VITE_PROXY_URL': JSON.stringify(env.VITE_PROXY_URL),
    },
    server: {
      port: 9000,
      host: '0.0.0.0',
      allowedHosts: true, // Allow all hosts for cloud environments
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp'
      }
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './setupTests.ts',
      // Run this app's tests plus the @l8r/shared package's tests (incl. the
      // token-storage migration suite) under one `npm test -w saveitforl8r`.
      include: [
        '**/*.{test,spec}.{ts,tsx}',
        '../../packages/shared/src/**/*.{test,spec}.{ts,tsx}',
      ],
    },
    build: {
      outDir: 'dist', // Ensure this matches capacitor webDir
      target: 'esnext',
      sourcemap: false,
      rollupOptions: {
        output: {
          // Split large vendor dependencies into separate chunks so they
          // can be cached independently. Keeps the main bundle lean.
          manualChunks: {
            'vendor-react': ['react', 'react-dom'],
            'vendor-marked': ['marked'],
            'vendor-dexie': ['dexie'],
            'vendor-pdf': ['pdfjs-dist'],
          },
        },
      },
    },
    worker: {
      format: 'es',
      plugins: () => [react()]
    },
    optimizeDeps: {
      exclude: ['@xenova/transformers', '@orama/orama']
    }
  };
});
