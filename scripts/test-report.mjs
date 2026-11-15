// npm run test:report — runs every test and writes the results to docs/TEST_REPORT.md.
// Browser tests need Chromium once: npx playwright install chromium (they are marked "not run" if it is missing).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const tmp = path.join(root, '.data');
fs.mkdirSync(tmp, { recursive: true });
const run = (cmd, env = {}) => spawnSync(cmd, { cwd: root, shell: true, stdio: 'inherit', env: { ...process.env, ...env } });

const vitestFile = path.join(tmp, 'vitest-results.json');
const pwFile = path.join(tmp, 'playwright-results.json');
fs.rmSync(vitestFile, { force: true });
fs.rmSync(pwFile, { force: true });

console.log('\n▶ API, integration and unit tests');
run(`npx vitest run --reporter=default --reporter=json --outputFile="${vitestFile}"`);
console.log('\n▶ Browser tests');
run('npx playwright test --reporter=list,json', { PLAYWRIGHT_JSON_OUTPUT_NAME: pwFile });

const lines = [];
const out = (s = '') => lines.push(s);
const mark = (ok) => (ok ? '✅' : '❌');

out('# Test report');
out();
out(`Generated ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC by \`npm run test:report\`.`);
out(`Environment: Node ${process.version}, ${os.type()} ${os.release()} (${os.arch()}).`);
out();

let summary = [];
if (fs.existsSync(vitestFile)) {
  const v = JSON.parse(fs.readFileSync(vitestFile, 'utf8'));
  summary.push(['API, integration and unit (Vitest)', v.numPassedTests, v.numFailedTests, v.numTotalTests]);
  out('## API, integration and unit tests (Vitest)');
  for (const file of v.testResults) {
    out();
    out(`### ${path.relative(root, file.name).replace(/\\/g, '/')}`);
    out();
    out('| Result | Test | Time |');
    out('|---|---|---|');
    for (const t of file.assertionResults) {
      const name = [...t.ancestorTitles, t.title].join(' › ').replace(/\|/g, '\\|');
      out(`| ${mark(t.status === 'passed')} | ${name} | ${Math.round(t.duration ?? 0)} ms |`);
    }
  }
} else {
  summary.push(['API, integration and unit (Vitest)', 0, 0, 0]);
}

out();
out('## Browser tests (Playwright, Chromium)');
if (fs.existsSync(pwFile)) {
  const p = JSON.parse(fs.readFileSync(pwFile, 'utf8'));
  let pass = 0, fail = 0;
  const walk = (suite, trail) => {
    for (const s of suite.suites ?? []) walk(s, [...trail, s.title].filter(Boolean));
    for (const spec of suite.specs ?? []) {
      const ok = spec.ok;
      ok ? pass++ : fail++;
      const ms = spec.tests?.[0]?.results?.[0]?.duration ?? 0;
      out(`| ${mark(ok)} | ${[...trail, spec.title].join(' › ').replace(/\|/g, '\\|')} | ${ms} ms |`);
    }
  };
  out();
  out('| Result | Test | Time |');
  out('|---|---|---|');
  for (const s of p.suites) walk(s, [s.title]);
  summary.push(['Browser end-to-end (Playwright)', pass, fail, pass + fail]);
} else {
  out();
  out('Not run (Chromium is not installed). Run `npx playwright install chromium`, then this script again.');
  summary.push(['Browser end-to-end (Playwright)', 0, 0, 0]);
}

const head = ['', '## Summary', '', '| Suite | Passed | Failed | Total |', '|---|---|---|---|',
  ...summary.map(([n, a, b, c]) => `| ${n} | ${a} | ${b} | ${c} |`)];
lines.splice(4, 0, ...head);
fs.writeFileSync(path.join(root, 'docs', 'TEST_REPORT.md'), lines.join('\n') + '\n');
console.log('\nWrote docs/TEST_REPORT.md');
const failed = summary.some(([, , f]) => f > 0);
process.exit(failed ? 1 : 0);
