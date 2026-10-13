'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { reconcile } = require('./reconcile.js');

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));

test('reconcile reports success when Drive ids and hashes match', () => {
  const result = reconcile(fixture('sample-manifest.json'), fixture('sample-drive.json'), { generatedAt: '2026-10-13T00:00:00.000Z' });
  assert.equal(result.ok, true);
  assert.equal(result.checked_total, 2);
  assert.equal(result.discrepancies_total, 0);
});

test('reconcile identifies missing files and hash mismatches', () => {
  const result = reconcile(fixture('sample-manifest.json'), fixture('sample-drive-mismatch.json'));
  assert.equal(result.ok, false);
  assert.deepEqual(result.discrepancies.map((item) => item.status), ['HASH_MISMATCH', 'DRIVE_FILE_MISSING']);
});

test('CLI writes the report and exits 2 when inconsistencies exist', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'plx-reconcile-'));
  const output = path.join(temp, 'result.json');
  try {
    const child = spawnSync(process.execPath, [
      path.join(__dirname, 'reconcile.js'),
      '--manifest', path.join(__dirname, 'fixtures', 'sample-manifest.json'),
      '--drive-sim', path.join(__dirname, 'fixtures', 'sample-drive-mismatch.json'),
      '--out', output,
    ], { encoding: 'utf8' });
    assert.equal(child.status, 2);
    assert.equal(JSON.parse(fs.readFileSync(output, 'utf8')).discrepancies_total, 2);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

