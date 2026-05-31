import type { CapacitorConfig } from '@capacitor/cli';

// l8rgram native shell. `cap add android/ios` and the photo-library plugin's
// native install are deferred to M6 — this config only declares identity so the
// projects materialize with the right appId / scheme when M6 runs.
const config: CapacitorConfig = {
  appId: 'com.l8rgram.app',
  appName: 'l8rgram',
  webDir: 'dist',
  bundledWebRuntime: false,
  // Deep-link custom scheme is `l8rgram://` (used by the OAuth bouncer redirect,
  // matching deepLinkScheme in index.tsx). iOS registers it via CFBundleURLSchemes
  // in Info.plist and Android via an intent-filter — both wired in M6 when the
  // native projects are generated.
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
      launchAutoHide: false,
      backgroundColor: '#000000',
      showSpinner: false,
    },
  },
};

export default config;
