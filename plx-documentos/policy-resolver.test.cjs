'use strict';

const assert = require('node:assert/strict');
const {
  normalizeAlias,
  normalizeCnpj,
  hasCnpjShape,
  resolveArchivePolicy,
  resolvePolicyForIngress,
  validatePolicy,
  createPolicyResolver,
  logDecision,
} = require('./policy-resolver.cjs');

const ingress = Object.freeze({
  tenant_id: 'tenant-contabil',
  operation_id: 'operacao-plx',
  session_id: 'sessao-plx',
  group_id: 'grupo-plx@g.us',
});

const policy = Object.freeze({
  ...ingress,
  policy_version: 7,
  active: true,
  group_mode: 'multi_company',
  review: { restricted_root_id: 'drive-restrito' },
  allowed_archive_owners: [
    {
      owner_id: 'empresa-a',
      legal_name: 'Empresa A Ltda',
      tax_identifier: { type: 'CNPJ', value: '12.345.678/0001-90' },
      approved_aliases: ['Empresa A Comércio'],
      drive_root_id: 'drive-empresa-a',
      archive_mode: 'mixed',
    },
    {
      owner_id: 'empresa-b',
      legal_name: 'Empresa B Ltda',
      tax_identifier: { type: 'CNPJ', value: '98.765.432/0001-10' },
      approved_aliases: ['Empresa B Serviços'],
      drive_root_id: 'drive-empresa-b',
      archive_mode: 'received',
    },
  ],
});

const resolve = (document, overrides = {}) => resolveArchivePolicy({ policy: { ...policy, ...overrides }, ingress, document });

assert.equal(normalizeCnpj('AB.123-xy / 0001 9Z'), 'AB123XY00019Z');
assert.equal(normalizeAlias('  Comércio   Árvore  '), 'COMERCIO ARVORE');
assert.equal(hasCnpjShape('12.345.678/0001-90'), true);
assert.equal(hasCnpjShape('CNPJ-INVÁLIDO'), false);
assert.deepEqual(validatePolicy(policy), []);

{
  const result = resolve({
    issuer: { name: 'Fornecedor Ltda', cnpj: '11.111.111/0001-11' },
    recipient: { name: 'Empresa A Ltda', cnpj: '12.345.678/0001-90' },
  });
  assert.equal(result.decision, 'ARCHIVE_AUTHORIZED');
  assert.equal(result.archive_owner.owner_id, 'empresa-a');
  assert.equal(result.archive_direction, 'received');
  assert.equal(result.identity_proof, 'CNPJ_EXACT');
  assert.equal(result.decision_reason, 'CNPJ_EXACT');
  assert.ok(result.decision_log.includes('DECISION:ARCHIVE_AUTHORIZED'));
}

{
  const result = resolve({
    issuer: { name: 'Empresa A Ltda', cnpj: '12.345.678/0001-90' },
    recipient: { name: 'Comprador Ltda', cnpj: '11.111.111/0001-11' },
  });
  assert.equal(result.decision, 'ARCHIVE_AUTHORIZED');
  assert.equal(result.archive_direction, 'issued');
}

{
  const result = resolve({
    issuer: { name: 'Fornecedor Ltda', cnpj: '11.111.111/0001-11' },
    recipient: { name: 'Empresa A Comércio' },
  });
  assert.equal(result.decision, 'ARCHIVE_AUTHORIZED');
  assert.equal(result.identity_proof, 'APPROVED_ALIAS_EXACT');
  assert.equal(result.decision_reason, 'APPROVED_ALIAS_EXACT');
}

{
  const result = resolve({
    issuer: { name: 'Fornecedor Ltda', cnpj: '11.111.111/0001-11' },
    recipient: { name: 'Empresa A Comércio', cnpj: '99.999.999/0001-99' },
  });
  assert.equal(result.decision, 'QUARANTINE');
  assert.ok(result.review_reasons.includes('CNPJ_CONFLICT'));
  assert.equal(result.decision_reason, 'CNPJ_CONFLICT');
}

{
  const result = resolve({
    issuer: { name: 'Empresa A Comércio Internacional' },
    recipient: { name: 'Cliente Ltda', cnpj: '11.111.111/0001-11' },
  });
  assert.equal(result.decision, 'QUARANTINE');
  assert.ok(result.review_reasons.includes('OWNER_NOT_EVIDENCED'));
}

{
  const result = resolve({
    issuer: { name: 'Empresa B Serviços' },
    recipient: { name: 'Cliente Ltda' },
  });
  assert.equal(result.decision, 'QUARANTINE');
  assert.ok(result.review_reasons.includes('DIRECTION_POLICY_MISMATCH'));
}

{
  const result = resolve({
    issuer: { name: 'Empresa A Ltda', cnpj: '12.345.678/0001-90' },
    recipient: { name: 'Empresa A Ltda', cnpj: '12.345.678/0001-90' },
  });
  assert.equal(result.decision, 'QUARANTINE');
  assert.ok(result.review_reasons.includes('INTERNAL_OR_AMBIGUOUS_DIRECTION'));
}

{
  const invalidModePolicy = {
    ...policy,
    allowed_archive_owners: policy.allowed_archive_owners.map((owner, index) => index === 0 ? { ...owner, archive_mode: 'typo' } : owner),
  };
  const result = resolveArchivePolicy({
    policy: invalidModePolicy,
    ingress,
    document: { recipient: { name: 'Empresa A Comércio' } },
  });
  assert.equal(result.decision, 'QUARANTINE');
  assert.ok(result.review_reasons.some((reason) => reason.endsWith('ARCHIVE_MODE_INVALID')));
}

{
  const result = resolve({ recipient: { name: 'Empresa A Comércio' } }, { active: false });
  assert.equal(result.decision, 'QUARANTINE');
  assert.ok(result.review_reasons.includes('POLICY_INACTIVE'));
}

{
  const result = resolveArchivePolicy({
    policy,
    ingress: { ...ingress, group_id: 'outro-grupo@g.us' },
    document: { recipient: { name: 'Empresa A Comércio' } },
  });
  assert.equal(result.decision, 'QUARANTINE');
  assert.ok(result.review_reasons.includes('POLICY_SCOPE_GROUP_ID_MISMATCH'));
}

{
  const selected = resolvePolicyForIngress([policy], ingress);
  assert.equal(selected.policy, policy);
  assert.deepEqual(selected.reasons, []);
  const missing = resolvePolicyForIngress([policy], { ...ingress, tenant_id: '' });
  assert.deepEqual(missing.reasons, ['INGRESS_TENANT_ID_REQUIRED']);
  const ambiguous = resolvePolicyForIngress([policy, policy], ingress);
  assert.deepEqual(ambiguous.reasons, ['POLICY_MAPPING_AMBIGUOUS']);
  assert.equal(ambiguous.decision_reason, 'POLICY_MAPPING_AMBIGUOUS');
  assert.equal(ambiguous.policy_version, null);
}

{
  const noOwners = { ...policy, allowed_archive_owners: [] };
  const result = resolveArchivePolicy({ policy: noOwners, ingress, document: {} });
  assert.equal(result.decision, 'QUARANTINE');
  assert.equal(result.decision_reason, 'POLICY_ARCHIVE_OWNER_REQUIRED');
  assert.ok(result.decision_log.includes('REASON:POLICY_ARCHIVE_OWNER_REQUIRED'));
}

{
  const resolver = createPolicyResolver({ policies: [policy] });
  const selected = resolver.resolvePolicyForIngress(ingress);
  assert.equal(selected.policy, policy);
  assert.equal(selected.policy_version, 7);
  assert.equal(selected.decision_reason, 'POLICY_SCOPE_EXACT');
}

{
  const result = resolve({ recipient: { name: 'Empresa A Comércio' } });
  const entry = logDecision(policy, ingress, { correlation_id: 'tenant:group:message', sha256: 'abc' }, result);
  assert.equal(entry.event, 'archive_policy_decision');
  assert.equal(entry.policy_version, 7);
  assert.equal(entry.decision_reason, 'APPROVED_ALIAS_EXACT');
  assert.equal(entry.correlation_id, 'tenant:group:message');
  assert.equal(entry.document_hash, 'abc');
  assert.equal(entry.archive_owner_id, 'empresa-a');
}

{
  const singleCompanyWithTwoOwners = { ...policy, group_mode: 'single_company' };
  assert.ok(validatePolicy(singleCompanyWithTwoOwners).includes('POLICY_SINGLE_COMPANY_REQUIRES_ONE_OWNER'));
}

{
  const malformedCnpj = {
    ...policy,
    allowed_archive_owners: policy.allowed_archive_owners.map((owner, index) => index === 0
      ? { ...owner, tax_identifier: { type: 'CNPJ', value: '123' } }
      : owner),
  };
  assert.ok(validatePolicy(malformedCnpj).includes('POLICY_OWNER_0_CNPJ_INVALID'));
}

console.log('PASS policy resolver: explicit scope, exact identity, direction and quarantine cases');
