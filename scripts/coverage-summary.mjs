#!/usr/bin/env node
/**
 * Renders Jest's coverage summary as Markdown.
 *
 * Written for GitHub Actions job summaries (`$GITHUB_STEP_SUMMARY`), so
 * coverage is visible on the run itself without uploading it to a third-party
 * service or granting anything access to the repository. Prints to stdout, so
 * it's equally usable locally:
 *
 *   npx jest && node scripts/coverage-summary.mjs
 */
import { readFileSync } from 'node:fs';

const LOWEST_COUNT = 10;

const summaryPath = new URL('../coverage/coverage-summary.json', import.meta.url);

let summary;
try {
  summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
} catch {
  console.error('No coverage/coverage-summary.json - run jest with coverage first.');
  process.exit(1);
}

const { total, ...files } = summary;

/** Green at 80+, amber at 50+, red below - a rough "is this looked at" signal. */
function badge(pct) {
  if (pct >= 80) return '🟢';
  if (pct >= 50) return '🟡';
  return '🔴';
}

function pct(metric) {
  return `${metric.pct.toFixed(1)}%`;
}

const lines = [];

lines.push('## Test coverage', '');
lines.push('| | Statements | Branches | Functions | Lines |');
lines.push('| --- | --- | --- | --- | --- |');
lines.push(
  `| ${badge(total.lines.pct)} **Total** | ${pct(total.statements)} | ${pct(total.branches)} | ${pct(total.functions)} | ${pct(total.lines)} |`
);
lines.push('');

const root = process.cwd();
const ranked = Object.entries(files)
  .map(([path, metrics]) => ({
    path: path.replace(`${root}/`, ''),
    pct: metrics.lines.pct,
    uncovered: metrics.lines.total - metrics.lines.covered,
  }))
  // Files with nothing to cover would otherwise sit at the top at 0%.
  .filter((file) => file.uncovered > 0)
  .sort((a, b) => a.pct - b.pct || b.uncovered - a.uncovered)
  .slice(0, LOWEST_COUNT);

if (ranked.length > 0) {
  lines.push(`<details><summary>Least covered files (${ranked.length})</summary>`, '');
  lines.push('| File | Lines | Uncovered |');
  lines.push('| --- | --- | --- |');
  for (const file of ranked) {
    lines.push(`| \`${file.path}\` | ${badge(file.pct)} ${file.pct.toFixed(1)}% | ${file.uncovered} |`);
  }
  lines.push('', '</details>');
}

console.log(lines.join('\n'));
