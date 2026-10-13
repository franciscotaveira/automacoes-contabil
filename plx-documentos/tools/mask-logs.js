#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

const RULES = [
  [/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]'],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[EMAIL_REDACTED]'],
  [/\b\d{3}\.?(?:\d{3})\.?(?:\d{3})-?\d{2}\b/g, '[CPF_REDACTED]'],
  [/\b\d{2}\.?(?:\d{3})\.?(?:\d{3})\/?\d{4}-?\d{2}\b/g, '[CNPJ_REDACTED]'],
  [/\+?\d[\d ()-]{8,}\d/g, '[PHONE_REDACTED]'],
  [/(api[_-]?key|token|password|secret)(\s*[=:]\s*)[^\s,;]+/gi, '$1$2[REDACTED]'],
];

function maskText(value) {
  return RULES.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), String(value));
}

function maskValue(value) {
  if (Array.isArray(value)) return value.map(maskValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /password|secret|token|api.?key/i.test(key) ? '[REDACTED]' : maskValue(item)]));
  }
  return typeof value === 'string' ? maskText(value) : value;
}

function maskLine(line) {
  try { return JSON.stringify(maskValue(JSON.parse(line))); } catch { return maskText(line); }
}

if (require.main === module) {
  const input = process.argv[2] ? fs.readFileSync(process.argv[2], 'utf8') : fs.readFileSync(0, 'utf8');
  process.stdout.write(input.split(/\r?\n/).map(maskLine).join('\n'));
}

module.exports = { maskText, maskValue, maskLine };
