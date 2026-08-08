// STUB: full project import is out of scope for phase 1 (see AGENTS.md).
//
// TODO(zip import/export): once we bundle a zip lib (e.g. react-native-zip-archive):
//   1. `expo-document-picker`'s `getDocumentAsync({ type: 'application/zip' })` to pick a
//      `.zip` archive containing manifest.json + stem files.
//   2. Unzip into `projectsDirectory` (see ./paths.ts) under a fresh project id folder,
//      using `expo-file-system`'s new `Directory`/`File` API (v57 - no legacy
//      `FileSystem.copyAsync`/`readAsStringAsync` calls).
//   3. Validate the extracted `manifest.json` against `ProjectManifest` (types/project.ts)
//      before registering it with the `projects` slice.
//   4. Surface per-file errors (missing stem referenced by manifest, corrupt archive) to the
//      user instead of silently dropping tracks.
//
// `Directory.pickDirectoryAsync()` (expo-file-system v57) is also worth evaluating as an
// alternative to zip import - it lets the user point straight at a folder of stems without
// packaging, at the cost of the iOS access grant only lasting the current app session.
export {};
