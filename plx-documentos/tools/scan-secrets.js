#!/usr/bin/env node
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

const allow = new Set(['CHANGE_ME', 'PENDING_CONFIGURATION', 'fixture-metrics-key', 'secret-token']);
const patterns = [
  ['private_key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['aws_key', /AKIA[0-9A-Z]{16}/],
  ['google_key', /AIza[0-9A-Za-z_-]{30,}/],
  ['nvidia_key', /nvapi-[0-9A-Za-z_-]{20,}/],
  ['github_token', /gh[pousr]_[0-9A-Za-z]{30,}/],
  ['long_base64', /(?:[A-Za-z0-9+/]{4000,}={0,2})/],
];
const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const findings = [];
for (const file of files) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
  for (const [name, pattern] of patterns) {
    const match = text.match(pattern);
    if (match && !allow.has(match[0])) findings.push({ file, pattern: name });
  }
}
if (findings.length) {
  console.error(JSON.stringify({ ok: false, findings }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, scanned_files: files.length }));
