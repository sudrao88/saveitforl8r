import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Resolve a path inside the shared workspace package (consumed as TS source).
const shared = (p: string) => fileURLToPath(new URL(`../../packages/shared/src/${p}`, import.meta.url));

// l8rgram's secrets live in a custom-named, gitignored `.env.l8rgram` (see
// `.env.l8rgram.example`). Vite only auto-loads `.env`/`.env.[mode]`, so we
// parse the custom file manually and merge it over the standard env. Absent
// values are fine — the app simply warns that Google sign-in is unconfigured.
const loadL8rgramEnv = (): Record<string, string> => {
  try {
    const raw = readFileSync(fileURLToPath(new URL('./.env.l8rgram', import.meta.url)), 'utf8');
    const out: Record<string, string> = {};
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
    return out;
  } catch {
    return {}; // file not present (CI / fresh checkout) — placeholders only
  }
};

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...loadL8rgramEnv() };
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
      'import.meta.env.VITE_L8RGRAM_GOOGLE_CLIENT_ID': JSON.stringify(env.VITE_L8RGRAM_GOOGLE_CLIENT_ID),
      'import.meta.env.VITE_L8RGRAM_GOOGLE_CLIENT_SECRET': JSON.stringify(env.VITE_L8RGRAM_GOOGLE_CLIENT_SECRET),
      'import.meta.env.VITE_L8RGRAM_HOSTED_URL': JSON.stringify(env.VITE_L8RGRAM_HOSTED_URL),
      'import.meta.env.VITE_PROXY_URL': JSON.stringify(env.VITE_PROXY_URL),
    },
    server: {
      port: 9001,
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
    },
    build: {
      outDir: 'dist', // Ensure this matches capacitor webDir
      target: 'esnext',
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom'],
          },
        },
      },
    },
    worker: {
      // The shared crypto service runs AES-GCM off the main thread in an ES worker.
      format: 'es',
      plugins: () => [react()]
    },
  };
});
