/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    // The real native module can't run under Jest; react-native-audio-api
    // ships a purpose-built mock (see its `mock/` entrypoint) for this.
    '^react-native-audio-api$': '<rootDir>/node_modules/react-native-audio-api/lib/commonjs/mock/index.js',
  },
  // jest-expo's default pattern, plus immer/react-redux: both resolve their
  // package.json "react-native" export condition to an untranspiled ESM
  // build, so Jest needs to run them through babel-jest like RN's own code.
  transformIgnorePatterns: [
    '/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|standard-navigation|immer|react-redux))',
    '/node_modules/react-native-reanimated/plugin/',
    '/node_modules/@react-native/babel-preset/',
  ],
  // Jest's 5s default is too tight for the screen tests, which load a project
  // for real: decoding, folding channels to stereo and computing waveform
  // peaks over a second of audio per stem. Most of that is *synchronous* JS
  // (see storage/progress.ts on why those phases block the thread), so with
  // coverage instrumenting every line it can hold the thread for seconds on a
  // slow CI runner - long enough that even waitFor can't get a poll in, and
  // the test dies on Jest's timeout rather than a useful assertion failure.
  // This is what failed the v1.5.0 release build. The number is headroom for
  // a slow machine, not an expectation: the whole suite runs in well under
  // this locally, so a genuinely stuck test still surfaces quickly.
  testTimeout: 20000,
  collectCoverage: true,
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
    '!src/app/**',
    '!src/test-utils/**',
  ],
  coverageDirectory: 'coverage',
  // json-summary feeds the CI job summary table (scripts/coverage-summary.mjs).
  coverageReporters: ['text', 'html', 'lcov', 'json-summary'],
};
