/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_L8RGRAM_GOOGLE_CLIENT_ID: string;
  readonly VITE_L8RGRAM_GOOGLE_CLIENT_SECRET: string;
  readonly VITE_L8RGRAM_HOSTED_URL: string;
  readonly VITE_PROXY_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
