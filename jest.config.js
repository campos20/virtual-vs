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
  collectCoverage: true,
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
    '!src/app/**',
    '!src/test-utils/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'html', 'lcov'],
};
