import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = process.env.CHOPSTICKS_SOURCE_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('package exposes compiled TypeScript host and browser entries', async () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.match(pkg.main, /^\.\/dist\/src\/host\/index\.mjs$/);
  const host = await import(new URL(pkg.main, `file:///${root.replaceAll('\\', '/')}/`).href);
  assert.equal(host.name, 'chopsticks');
  assert.equal(typeof host.apply, 'function');
  for (const entry of Object.values(pkg.exports)) assert.ok(fs.existsSync(path.join(root, String(entry))));
});
test('release includes executable host, classic client, assets and plugin boundary', () => {
  const release = path.join(root, 'dist/release');
  assert.ok(fs.existsSync(path.join(release, 'package.json')), 'a deployable release must exist');
  const pkg = JSON.parse(fs.readFileSync(path.join(release, 'package.json'), 'utf8'));
  for (const file of [pkg.main, ...Object.values(pkg.exports), 'presets/runtime.patch.yml', 'console/management/index.html', 'maibot/runner.py', 'style/vendor/fishrules.cjs', 'NOTICE.md', 'LICENSE']) {
    assert.ok(fs.existsSync(path.join(release, file)), `missing release entry: ${file}`);
  }
  assert.equal(fs.existsSync(path.join(release, 'tests')), false);
  assert.equal(fs.existsSync(path.join(release, 'config.json')), false);
  assert.equal(fs.existsSync(path.join(release, '.git')), false);
  assert.doesNotMatch(fs.readFileSync(path.join(release, 'console/client.js'), 'utf8'), /^export /m);
});
