'use strict';

/**
 * Pure authorization policy resolver for WhatsApp document triage.
 *
 * This module deliberately has no I/O and no knowledge of n8n, Drive or WAHA.
 * It answers one narrow question: may this ingress event be archived for one
 * configured owner, and if so, under which direction? Every other outcome is
 * a restricted-review (quarantine) decision.
 */

const ARCHIVE_MODES = new Set(['received', 'issued', 'mixed']);
const GROUP_MODES = new Set(['single_company', 'multi_company', 'test']);

const value = (input) => String(input ?? '').trim();

/** Preserve letters in the post-2026 CNPJ representation while removing only formatting. */
function normalizeCnpj(input) {
  return value(input).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function hasCnpjShape(input) {
  return /^[A-Z0-9]{14}$/.test(normalizeCnpj(input));
}

/** Exact-name comparison only. This must never be used as a fuzzy match. */
function normalizeAlias(input) {
  return value(input)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function present(input) {
  return value(input).length > 0;
}

function unique(items) {
  return [...new Set(items)];
}

function quarantine(reasons, policy, extra = {}) {
  const uniqueReasons = unique(reasons);
  return {
    decision: 'QUARANTINE',
    archive_authorized: false,
    review_required: true,
    review_reasons: uniqueReasons,
    policy_version: policy?.policy_version ?? null,
    decision_reason: uniqueReasons[0] ?? 'QUARANTINE_REQUIRED',
    decision_log: [
      `POLICY_VERSION:${policy?.policy_version ?? 'NONE'}`,
      'DECISION:QUARANTINE',
      ...uniqueReasons.map((reason) => `REASON:${reason}`),
    ],
    restricted_root_id: policy?.review?.restricted_root_id ?? null,
    archive_owner: null,
    archive_direction: null,
    ...extra,
  };
}

function validateOwner(owner, index) {
  const reasons = [];
  if (!owner || typeof owner !== 'object' || Array.isArray(owner)) {
    return [`POLICY_OWNER_${index}_INVALID`];
  }
  if (!present(owner.owner_id)) reasons.push(`POLICY_OWNER_${index}_ID_REQUIRED`);
  if (!present(owner.legal_name)) reasons.push(`POLICY_OWNER_${index}_LEGAL_NAME_REQUIRED`);
  if (!present(owner.drive_root_id)) reasons.push(`POLICY_OWNER_${index}_DRIVE_ROOT_REQUIRED`);
  if (!ARCHIVE_MODES.has(value(owner.archive_mode).toLowerCase())) {
    reasons.push(`POLICY_OWNER_${index}_ARCHIVE_MODE_INVALID`);
  }

  const cnpj = normalizeCnpj(owner.tax_identifier?.value ?? owner.cnpj);
  const aliases = Array.isArray(owner.approved_aliases)
    ? owner.approved_aliases.map(normalizeAlias).filter(Boolean)
    : [];
  if (!cnpj && aliases.length === 0) reasons.push(`POLICY_OWNER_${index}_IDENTITY_REQUIRED`);
  if (cnpj && !hasCnpjShape(cnpj)) reasons.push(`POLICY_OWNER_${index}_CNPJ_INVALID`);
  if (aliases.length !== unique(aliases).length) reasons.push(`POLICY_OWNER_${index}_ALIASES_DUPLICATED`);
  return reasons;
}

/**
 * Validates a policy before it can authorize a document. A valid configuration
 * is necessary but never sufficient: the document still needs matching proof.
 */
function validatePolicy(policy) {
  const reasons = [];
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return ['POLICY_MISSING'];
  if (policy.active !== true) reasons.push('POLICY_INACTIVE');
  for (const key of ['tenant_id', 'operation_id', 'session_id', 'group_id']) {
    if (!present(policy[key])) reasons.push(`POLICY_${key.toUpperCase()}_REQUIRED`);
  }
  if (!present(policy.policy_version)) reasons.push('POLICY_VERSION_REQUIRED');
  if (!GROUP_MODES.has(value(policy.group_mode).toLowerCase())) reasons.push('POLICY_GROUP_MODE_INVALID');
  if (!present(policy.review?.restricted_root_id)) reasons.push('POLICY_RESTRICTED_REVIEW_ROOT_REQUIRED');

  const owners = Array.isArray(policy.allowed_archive_owners) ? policy.allowed_archive_owners : [];
  if (owners.length === 0) reasons.push('POLICY_ARCHIVE_OWNER_REQUIRED');
  if (value(policy.group_mode).toLowerCase() === 'single_company' && owners.length !== 1) {
    reasons.push('POLICY_SINGLE_COMPANY_REQUIRES_ONE_OWNER');
  }
  owners.forEach((owner, index) => reasons.push(...validateOwner(owner, index)));

  const ownerIds = owners.map((owner) => value(owner?.owner_id)).filter(Boolean);
  if (ownerIds.length !== unique(ownerIds).length) reasons.push('POLICY_OWNER_IDS_DUPLICATED');
  const cnpjs = owners.map((owner) => normalizeCnpj(owner?.tax_identifier?.value ?? owner?.cnpj)).filter(Boolean);
  if (cnpjs.length !== unique(cnpjs).length) reasons.push('POLICY_OWNER_CNPJS_DUPLICATED');

  const aliases = owners.flatMap((owner) => Array.isArray(owner?.approved_aliases) ? owner.approved_aliases.map(normalizeAlias).filter(Boolean) : []);
  if (aliases.length !== unique(aliases).length) reasons.push('POLICY_ALIASES_AMBIGUOUS');
  return unique(reasons);
}

function ingressScopeReasons(policy, ingress) {
  if (!ingress || typeof ingress !== 'object') return ['INGRESS_SCOPE_REQUIRED'];
  const reasons = [];
  for (const key of ['tenant_id', 'operation_id', 'session_id', 'group_id']) {
    if (!present(ingress[key])) reasons.push(`INGRESS_${key.toUpperCase()}_REQUIRED`);
    else if (value(policy[key]) !== value(ingress[key])) reasons.push(`POLICY_SCOPE_${key.toUpperCase()}_MISMATCH`);
  }
  return reasons;
}

/** Select exactly one active policy for an authenticated ingress scope. */
function resolvePolicyForIngress(policies, ingress) {
  const candidates = Array.isArray(policies) ? policies : [];
  const result = (policy, reasons, decisionReason) => ({
    policy,
    reasons,
    policy_version: policy?.policy_version ?? null,
    decision_reason: decisionReason,
    decision_log: [
      `POLICY_VERSION:${policy?.policy_version ?? 'NONE'}`,
      `DECISION:${policy ? 'POLICY_SELECTED' : 'POLICY_REJECTED'}`,
      ...(reasons.length ? reasons.map((reason) => `REASON:${reason}`) : [`REASON:${decisionReason}`]),
    ],
  });
  if (!ingress || typeof ingress !== 'object') return result(null, ['INGRESS_SCOPE_REQUIRED'], 'INGRESS_SCOPE_REQUIRED');
  const required = ['tenant_id', 'operation_id', 'session_id', 'group_id'];
  const missing = required.filter((key) => !present(ingress[key]));
  if (missing.length) {
    const reasons = missing.map((key) => `INGRESS_${key.toUpperCase()}_REQUIRED`);
    return result(null, reasons, reasons[0]);
  }
  const matches = candidates.filter((policy) => policy?.active === true && required.every((key) => value(policy[key]) === value(ingress[key])));
  if (matches.length === 0) return result(null, ['POLICY_NOT_FOUND_FOR_INGRESS_SCOPE'], 'POLICY_NOT_FOUND_FOR_INGRESS_SCOPE');
  if (matches.length > 1) return result(null, ['POLICY_MAPPING_AMBIGUOUS'], 'POLICY_MAPPING_AMBIGUOUS');
  const reasons = validatePolicy(matches[0]);
  return reasons.length ? result(null, reasons, reasons[0]) : result(matches[0], [], 'POLICY_SCOPE_EXACT');
}

function partyIdentity(party) {
  const cnpj = normalizeCnpj(party?.cnpj ?? party?.tax_identifier?.value);
  return {
    cnpj,
    name: normalizeAlias(party?.name ?? party?.legal_name),
    has_supplied_cnpj: cnpj.length > 0,
  };
}

/**
 * Returns a proof result. A supplied conflicting CNPJ always blocks an alias;
 * aliases only support documents whose CNPJ was not extracted.
 */
function matchesOwner(owner, party) {
  const identity = partyIdentity(party);
  const ownerCnpj = normalizeCnpj(owner.tax_identifier?.value ?? owner.cnpj);
  const aliases = new Set((owner.approved_aliases ?? []).map(normalizeAlias).filter(Boolean));
  if (identity.has_supplied_cnpj) {
    if (ownerCnpj && identity.cnpj === ownerCnpj) return { matched: true, proof: 'CNPJ_EXACT', reason: null };
    return { matched: false, proof: null, reason: 'CNPJ_CONFLICT' };
  }
  if (identity.name && aliases.has(identity.name)) return { matched: true, proof: 'APPROVED_ALIAS_EXACT', reason: null };
  return { matched: false, proof: null, reason: 'OWNER_NOT_EVIDENCED' };
}

function resolveOwnerDirection(owner, document) {
  const mode = value(owner.archive_mode).toLowerCase();
  const issuer = matchesOwner(owner, document?.issuer);
  const recipient = matchesOwner(owner, document?.recipient);

  if (mode === 'received') {
    if (recipient.matched) return { authorized: true, direction: 'received', proof: recipient.proof };
    return { authorized: false, reasons: [issuer.matched ? 'DIRECTION_POLICY_MISMATCH' : recipient.reason] };
  }
  if (mode === 'issued') {
    if (issuer.matched) return { authorized: true, direction: 'issued', proof: issuer.proof };
    return { authorized: false, reasons: [recipient.matched ? 'DIRECTION_POLICY_MISMATCH' : issuer.reason] };
  }
  if (issuer.matched && recipient.matched) return { authorized: false, reasons: ['INTERNAL_OR_AMBIGUOUS_DIRECTION'] };
  if (issuer.matched) return { authorized: true, direction: 'issued', proof: issuer.proof };
  if (recipient.matched) return { authorized: true, direction: 'received', proof: recipient.proof };
  return { authorized: false, reasons: unique([issuer.reason, recipient.reason]) };
}

/**
 * Resolve a document against one already-selected policy.
 * Never infer a company from a group name, model output, or fuzzy text.
 */
function resolveArchivePolicy({ policy, ingress, document }) {
  const policyReasons = validatePolicy(policy);
  if (policyReasons.length) return quarantine(policyReasons, policy);
  const scopeReasons = ingressScopeReasons(policy, ingress);
  if (scopeReasons.length) return quarantine(scopeReasons, policy);
  if (!document || typeof document !== 'object') return quarantine(['DOCUMENT_REQUIRED'], policy);

  const candidates = policy.allowed_archive_owners.map((owner) => ({ owner, result: resolveOwnerDirection(owner, document) }));
  const authorized = candidates.filter(({ result }) => result.authorized);
  if (authorized.length === 1) {
    const { owner, result } = authorized[0];
    return {
      decision: 'ARCHIVE_AUTHORIZED',
      archive_authorized: true,
      review_required: false,
      review_reasons: [],
      policy_version: policy.policy_version,
      decision_reason: result.proof,
      decision_log: [
        `POLICY_VERSION:${policy.policy_version}`,
        'DECISION:ARCHIVE_AUTHORIZED',
        `REASON:${result.proof}`,
        `OWNER:${owner.owner_id}`,
        `DIRECTION:${result.direction}`,
      ],
      restricted_root_id: policy.review.restricted_root_id,
      archive_owner: {
        owner_id: owner.owner_id,
        legal_name: owner.legal_name,
        drive_root_id: owner.drive_root_id,
      },
      archive_direction: result.direction,
      identity_proof: result.proof,
    };
  }
  if (authorized.length > 1) return quarantine(['MULTIPLE_ARCHIVE_OWNERS_MATCHED'], policy);
  return quarantine(unique(candidates.flatMap(({ result }) => result.reasons ?? ['OWNER_NOT_EVIDENCED'])), policy);
}

function createPolicyResolver({ policies = [] } = {}) {
  const configuredPolicies = Array.isArray(policies) ? [...policies] : [];
  return Object.freeze({
    resolvePolicyForIngress: (ingress) => resolvePolicyForIngress(configuredPolicies, ingress),
    resolveArchivePolicy: ({ policy, ingress, document }) => resolveArchivePolicy({ policy, ingress, document }),
  });
}

function logDecision(policy, ingress, document, result) {
  return {
    module: 'policy-resolver',
    event: 'archive_policy_decision',
    policy_version: result?.policy_version ?? policy?.policy_version ?? null,
    decision: result?.decision ?? (result?.policy ? 'POLICY_SELECTED' : 'POLICY_REJECTED'),
    decision_reason: result?.decision_reason ?? null,
    decision_log: Array.isArray(result?.decision_log) ? [...result.decision_log] : [],
    tenant_id: ingress?.tenant_id ?? policy?.tenant_id ?? null,
    operation_id: ingress?.operation_id ?? policy?.operation_id ?? null,
    session_id: ingress?.session_id ?? policy?.session_id ?? null,
    group_id: ingress?.group_id ?? policy?.group_id ?? null,
    correlation_id: document?.correlation_id ?? null,
    document_hash: document?.document_hash ?? document?.sha256 ?? null,
    archive_owner_id: result?.archive_owner?.owner_id ?? null,
    archive_direction: result?.archive_direction ?? null,
  };
}

module.exports = {
  ARCHIVE_MODES,
  GROUP_MODES,
  normalizeAlias,
  normalizeCnpj,
  hasCnpjShape,
  validatePolicy,
  resolvePolicyForIngress,
  resolveArchivePolicy,
  createPolicyResolver,
  logDecision,
};
