const { withAppBuildGradle } = require('@expo/config-plugins');

const MARKER = '// virtual-vs release signing';

/**
 * Appended to the end of android/app/build.gradle rather than patched into
 * the middle of it. `android/` isn't checked in, so this has to survive
 * `expo prebuild` regenerating the file from Expo's template - and appending
 * makes no assumptions about what that template currently looks like, which
 * string-replacing a `signingConfig` line would.
 *
 * Gradle allows the `android { }` extension to be re-opened, so this adds a
 * release signing config without touching anything Expo wrote above it.
 *
 * It only takes effect when the signing properties are passed in. Without
 * them nothing changes and the build keeps Expo's default signing, so both
 * local builds and CI runs without a keystore configured still work.
 */
const SIGNING_SNIPPET = `
${MARKER}
if (project.hasProperty('VIRTUALVS_STORE_FILE')) {
    android {
        signingConfigs {
            release {
                storeFile file(VIRTUALVS_STORE_FILE)
                storePassword VIRTUALVS_STORE_PASSWORD
                keyAlias VIRTUALVS_KEY_ALIAS
                keyPassword VIRTUALVS_KEY_PASSWORD
            }
        }
        buildTypes {
            release {
                signingConfig signingConfigs.release
            }
        }
    }
}
`;

module.exports = function withAndroidSigning(config) {
  return withAppBuildGradle(config, (modConfig) => {
    if (!modConfig.modResults.contents.includes(MARKER)) {
      modConfig.modResults.contents += SIGNING_SNIPPET;
    }
    return modConfig;
  });
};
