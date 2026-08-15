#!/usr/bin/env node
/**
 * Writes the release version into app.json before `expo prebuild`.
 *
 * package.json is the single source of truth for the version - the release
 * workflow refuses to build if the git tag disagrees with it - so app.json is
 * derived here rather than being kept in sync by hand.
 *
 * Android additionally needs `versionCode`: a plain increasing integer that
 * has to go up with every build the Play Store or a device sees, and which
 * can't be derived from a semver string like "1.0.0-alpha.0". The workflow
 * passes the run number, which only ever increases.
 *
 * Usage: node scripts/sync-app-version.mjs <version> <versionCode>
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [, , version, versionCode] = process.argv;

if (!version || !versionCode) {
  console.error('Usage: sync-app-version.mjs <version> <versionCode>');
  process.exit(1);
}

if (!/^\d+$/.test(versionCode)) {
  console.error(`versionCode must be a positive integer, got "${versionCode}"`);
  process.exit(1);
}

const path = new URL('../app.json', import.meta.url);
const app = JSON.parse(readFileSync(path, 'utf8'));

app.expo.version = version;
app.expo.android = { ...app.expo.android, versionCode: Number(versionCode) };

writeFileSync(path, `${JSON.stringify(app, null, 2)}\n`);

console.log(`app.json set to version ${version} (versionCode ${versionCode})`);
