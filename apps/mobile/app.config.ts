import type { ExpoConfig } from "expo/config";

// "StayBook" is a placeholder brand. Change name, slug, scheme, bundle ids and icons before release.
// The scheme must match `mobile_scheme` in infra/terraform (Cognito callback URL).
const scheme = "staybook";

const config: ExpoConfig = {
  name: "StayBook",
  slug: "staybook",
  scheme,
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: "in.example.staybook",
    supportsTablet: false,
    infoPlist: {
      NSLocationWhenInUseUsageDescription: "Shows stays near you on the map.",
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: "in.example.staybook",
    // Plugins add these by default; the app never touches shared storage, and Play review flags them.
    blockedPermissions: ["android.permission.READ_EXTERNAL_STORAGE", "android.permission.WRITE_EXTERNAL_STORAGE"],
  },
  plugins: [
    "expo-router",
    ["expo-notifications", { color: "#E5483A" }],
    "expo-secure-store",
    "expo-web-browser",
    ["expo-location", { locationWhenInUsePermission: "Shows stays near you on the map." }],
    [
      "react-native-maps",
      {
        // Google Maps on Android needs a key for release builds; iOS uses Apple Maps unless set.
        androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_KEY,
        iosGoogleMapsApiKey: process.env.GOOGLE_MAPS_IOS_KEY,
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  // Push notifications need the EAS project id (`eas init` prints it). Without it, push is simply off.
  extra: process.env.EAS_PROJECT_ID ? { eas: { projectId: process.env.EAS_PROJECT_ID } } : {},
};

export default config;
