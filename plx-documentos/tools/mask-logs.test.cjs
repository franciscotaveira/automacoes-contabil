'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { maskLine, maskValue } = require('./mask-logs.js');

test('mask logs redacts credentials and personal identifiers', () => {
  const result = maskValue({ token: 'secret-token', email: 'user@example.com', note: 'CNPJ 12.345.678/0001-95' });
  assert.equal(result.token, '[REDACTED]');
  assert.equal(result.email, '[EMAIL_REDACTED]');
  assert.match(result.note, /CNPJ_REDACTED/);
  assert.doesNotMatch(maskLine('Authorization: Bearer abc.def'), /abc\.def/);
});
