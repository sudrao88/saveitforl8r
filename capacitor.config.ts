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
          launchShowDuration: 0,
          launchAutoHide: true,
          backgroundColor: "#000000",
          androidSplashResourceName: "splash",
          iosSplashResourceName: "Splash",
          showSpinner: false,
      }
  }
};

export default config;
