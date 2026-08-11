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
  `expo-glass-effect` was tried for a "modern" visual pass and caused a
  hard-to-reproduce Android Fabric crash (`addViewAt: ... already has a
  parent`) on the Player -> Library back transition, confirmed only after
  several rounds of investigation (see git history for the full trail).
  Fixing it took four changes together, not any single one in isolation:
  1. Dropped `expo-glass-effect`/`GlassView` entirely (reverted to plain
     `View` - it was never doing anything but rendering as one on Android
     anyway).
  2. Moved `VerticalFader`/`TransportBar`'s drag gestures off
     `react-native-gesture-handler`'s `GestureDetector`/`Gesture` API onto
     React Native's own built-in `PanResponder` (no extra native
     view/handler registration), and dropped `GestureHandlerRootView` from
     `_layout.tsx`. `react-native-gesture-handler`/`react-native-reanimated`
     stay in `package.json` only because `expo-router` requires them as
     peer dependencies internally - app code should not import from either
     directly.
  3. Replaced all three `FlatList` usages (Library's project list, the
     mixer's channel strips, the new-project file list) with plain
     `ScrollView` + `.map()` - none of these lists are ever long enough to
     need virtualization, and `VirtualizedList`'s internal cell-recycling
     schedules its own deferred, timer-based state updates.
  4. Set `_layout.tsx`'s `<Stack>` to `animation: 'none'` (removes the
     window where both screens' native view trees are present/rendering at
     once during an animated transition) and wrapped the app in
     `SafeAreaProvider` (react-native-safe-area-context requires it as an
     ancestor of any `SafeAreaView`; every screen was using `SafeAreaView`
     without one).
  Confirmed fixed by the user after 20+ consecutive Player <-> Library
  round trips with no repro (previously it reproduced within 3-6). If it
  ever resurfaces, re-read the git history around these four commits before
  reaching for a new theory - the working hypothesis was an accumulation
  across mount/unmount cycles (view tag numbers climbed each attempt: 126,
  1378, 1694) rather than a one-shot race, and step 4 is the most likely of
  the four to be load-bearing, but this was never isolated with a minimal
  repro.
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
