import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.saveitforl8r.app',
  appName: 'SaveItForL8r',
  webDir: 'dist',
  plugins: {
      Keyboard: {
          resize: 'body',
          style: 'dark',
          resizeOnFullScreen: true
      },
      SplashScreen: {
          launchShowDuration: 2000,
          launchAutoHide: true,
          backgroundColor: "#111827",
          androidSplashResourceName: "splash",
          iosSplashResourceName: "Splash",
          showSpinner: true,
          androidSpinnerStyle: "large",
          iosSpinnerStyle: "small",
          spinnerColor: "#3b82f6",
      }
  }
};

export default config;
