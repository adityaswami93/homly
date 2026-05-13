import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.homly.app',
  appName: 'Homly',
  webDir: 'out',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#111827',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
    StatusBar: {
      style: 'Dark',
      backgroundColor: '#111827',
    },
  },
};

export default config;
