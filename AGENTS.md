# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Stability over appearance

This app runs live, on stage, during a performance. A crash or audio glitch has
real consequences in a way a plain UI has none of - there is no "reload the
page" mid-song. Stability, correctness, and predictability always outrank
visual polish or how modern something looks.

Concretely:

- Prefer plain React Native core components (`View`, `Text`, `Pressable`,
  etc.) over third-party or platform-experimental UI libraries, especially
  ones wrapping newer/native-only platform APIs (e.g. iOS Liquid Glass).
  `expo-glass-effect` was tried for a "modern" visual pass and pulled after
  it was implicated in a hard-to-reproduce Android Fabric crash
  (`addViewAt: ... already has a parent`) on the Player -> Library back
  transition - see git history around that change for the investigation.
- Before adding a new dependency (especially anything touching rendering,
  native views, audio, or navigation), weigh whether it's well-established
  and battle-tested for this use case, not just whether it looks nice or is
  convenient. When in doubt, ask rather than adding it.
- Don't add a runtime (non-dev) dependency speculatively "for later" - only
  add what's actually being wired up now. An installed-but-unused dependency
  still ships in the native build and adds untested surface area.
- Test/dev-only tooling (Jest, Testing Library, etc.) doesn't ship in the
  built app and isn't a stability concern the same way - this principle is
  about runtime dependencies.
