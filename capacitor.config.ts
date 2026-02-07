import type { CapacitorConfig } from '@capacitor/cli';
import { KeyboardResize, KeyboardStyle } from '@capacitor/keyboard';

const config: CapacitorConfig = {
  appId: 'com.saveitforl8r.app',
  appName: 'SaveItForL8r',
  webDir: 'dist',
  server: {
    allowNavigation: [
      "saveitforl8r.com",
      "*.saveitforl8r.com"
    ]
  },
  plugins: {
      Keyboard: {
          resize: KeyboardResize.Body,
          style: KeyboardStyle.Dark,
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
