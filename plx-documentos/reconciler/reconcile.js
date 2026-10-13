#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function asEntries(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.entries)) return value.entries;
  if (Array.isArray(value?.documents)) return value.documents;
  throw new Error('manifest_entries_required');
}

function asDriveFiles(value) {
  const files = Array.isArray(value) ? value : value?.files;
  if (!Array.isArray(files)) throw new Error('drive_sim_files_required');
  return new Map(files.map((file) => [String(file.drive_id ?? file.drive_file_id ?? file.id ?? ''), file]));
}

function reconcile(manifest, driveSimulation, { generatedAt = new Date().toISOString() } = {}) {
  const entries = asEntries(manifest);
  const driveFiles = asDriveFiles(driveSimulation);
  const discrepancies = [];

  for (const entry of entries) {
    const correlationId = String(entry.correlation_id ?? 'UNKNOWN');
    const driveId = String(entry.drive_id ?? entry.drive_file_id ?? '');
    const expectedHash = String(entry.hash ?? entry.document_hash ?? entry.sha256 ?? '');
    const base = {
      correlation_id: correlationId,
      manifest_path: entry.manifest_path ?? entry.organized_path ?? null,
      expected_hash: expectedHash || null,
      drive_hash: null,
    };
    if (!driveId) {
      discrepancies.push({ ...base, status: 'MANIFEST_DRIVE_ID_MISSING' });
      continue;
    }
    const driveFile = driveFiles.get(driveId);
    if (!driveFile) {
      discrepancies.push({ ...base, status: 'DRIVE_FILE_MISSING' });
      continue;
    }
    const driveHash = String(driveFile.hash ?? driveFile.document_hash ?? driveFile.sha256 ?? '');
    if (!expectedHash || !driveHash || driveHash !== expectedHash) {
      discrepancies.push({ ...base, drive_hash: driveHash || null, status: 'HASH_MISMATCH' });
    }
  }

  return {
    ok: discrepancies.length === 0,
    generated_at: generatedAt,
    checked_total: entries.length,
    discrepancies_total: discrepancies.length,
    discrepancies,
  };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!['--manifest', '--drive-sim', '--out'].includes(key)) continue;
    args[key.slice(2)] = argv[index + 1];
    index += 1;
  }
  if (!args.manifest || !args['drive-sim'] || !args.out) throw new Error('usage: --manifest FILE --drive-sim FILE --out FILE');
  return args;
}

function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const manifest = JSON.parse(fs.readFileSync(path.resolve(args.manifest), 'utf8'));
  const driveSimulation = JSON.parse(fs.readFileSync(path.resolve(args['drive-sim']), 'utf8'));
  const result = reconcile(manifest, driveSimulation);
  fs.writeFileSync(path.resolve(args.out), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  return result.ok ? 0 : 2;
}

if (require.main === module) {
  try {
    process.exitCode = runCli();
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', module: 'reconciler', error: String(error?.message || 'reconciliation_failed') }));
    process.exitCode = 1;
  }
}

module.exports = { asEntries, asDriveFiles, reconcile, parseArgs, runCli };
