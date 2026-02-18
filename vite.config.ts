import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    base: '/',
    plugins: [
      react(),
      tailwindcss(),
    ],
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
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
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
      sourcemap: true
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
