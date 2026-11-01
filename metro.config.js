// Learn more https://docs.expo.dev/guides/customizing-metro
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// --- Desktop build ------------------------------------------------------------
//
// The web platform is the desktop app: the same screens rendered with
// react-native-web inside Tauri (see desktop/README.md). For web bundles only,
// the few phone-only pieces are swapped for desktop versions in desktop/web/.
// iOS/Android bundles never see any of this.

const DESKTOP_WEB = path.join(__dirname, "desktop", "web");

/** Packages replaced wholesale. */
const PACKAGE_REDIRECTS = {
  "expo-file-system": "shims/expo-file-system.ts",
  "expo-document-picker": "shims/expo-document-picker.ts",
  "expo-sharing": "shims/expo-sharing.ts",
  "react-native-audio-api": "shims/react-native-audio-api.ts",
};

/** App modules replaced, by resolved file path. */
const SOURCE_REDIRECTS = {
  [path.join(__dirname, "src", "engine", "AudioEngine.ts")]:
    "engine/AudioEngine.ts",
  [path.join(__dirname, "src", "engine", "waveform.ts")]: "engine/waveform.ts",
  [path.join(__dirname, "src", "platform", "desktop.tsx")]: "ui/desktop.tsx",
};

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = () => context.resolveRequest(context, moduleName, platform);
  // Files inside desktop/web import the originals they build on (e.g. the
  // desktop waveform module re-exports the mobile one), so no redirects there.
  if (platform !== "web" || context.originModulePath.startsWith(DESKTOP_WEB)) {
    return resolve();
  }
  if (PACKAGE_REDIRECTS[moduleName]) {
    return {
      type: "sourceFile",
      filePath: path.join(DESKTOP_WEB, PACKAGE_REDIRECTS[moduleName]),
    };
  }
  const resolved = resolve();
  if (resolved.type === "sourceFile" && SOURCE_REDIRECTS[resolved.filePath]) {
    return {
      type: "sourceFile",
      filePath: path.join(DESKTOP_WEB, SOURCE_REDIRECTS[resolved.filePath]),
    };
  }
  return resolved;
};

// The Rust build output and the desktop shell's own node_modules are huge
// and never part of the JS bundle.
config.resolver.blockList = [
  /desktop\/src-tauri\/target\/.*/,
  /desktop\/src-tauri\/gen\/.*/,
  /desktop\/node_modules\/.*/,
];

module.exports = config;
