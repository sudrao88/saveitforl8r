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
          resize: KeyboardResize.None,
          style: KeyboardStyle.Dark,
          resizeOnFullScreen: true
      },
      StatusBar: {
          style: 'DARK',
          backgroundColor: '#000000',
          overlaysWebView: true,
      },
      SplashScreen: {
          launchShowDuration: 0,
          launchAutoHide: false,
          backgroundColor: "#000000",
          androidSplashResourceName: "splash",
          showSpinner: false,
      },
      LocalNotifications: {
          smallIcon: "ic_notification",
          iconColor: "#2563eb",
      }
  }
};

export default config;
