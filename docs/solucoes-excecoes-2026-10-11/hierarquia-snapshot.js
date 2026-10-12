// Snapshot isolado de 2026-10-11. Somente diagnóstico; NÃO importar como correção.
const doc = $input.first().json;
const d = new Date(doc.reference_date + 'T12:00:00-03:00');
const months = ['01 - Janeiro','02 - Fevereiro','03 - Março','04 - Abril','05 - Maio','06 - Junho','07 - Julho','08 - Agosto','09 - Setembro','10 - Outubro','11 - Novembro','12 - Dezembro'];
const departmentFolders = { fiscal: '01 - Fiscal', contabil: '02 - Contabil', pessoal: '03 - Pessoal', revisar: '99 - Revisar' };
const typeLabels = { 'nf-e':'NF-e','nfs-e':'NFS-e','nfc-e':'NFC-e','cupom-fiscal':'Cupom fiscal','ct-e':'CT-e','mdf-e':'MDF-e',extrato:'Extrato',comprovante:'Comprovante',recibo:'Recibo',boleto:'Boleto',fatura:'Fatura',balancete:'Balancete',razao:'Razão',diario:'Diário',dre:'DRE',folha:'Folha',holerite:'Holerite',fgts:'FGTS',inss:'INSS',atestado:'Atestado',admissao:'Admissão',ferias:'Férias',rescisao:'Rescisão',ponto:'Ponto',afastamento:'Afastamento',guia:'Guia',outro:'Outro' };
const filename = String(doc.source_filename ?? '');
const dot = filename.lastIndexOf('.');
const candidate = dot >= 0 ? filename.slice(dot + 1).toLowerCase() : '';
const extValid = candidate.length >= 1 && candidate.length <= 8 && Array.from(candidate).every(ch => (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9'));
const mimeExtensions = { 'application/pdf': '.pdf', 'application/xml': '.xml', 'text/xml': '.xml', 'image/jpeg': '.jpg', 'image/png': '.png' };
const ext = extValid ? '.' + candidate : (mimeExtensions[String(doc.mime_type ?? '').toLowerCase()] ?? '');
const forbidden = new Set(['/','\\',':','*','?','"','<','>','|']);
const clean = (v) => {
  let s = Array.from(String(v ?? '')).map(ch => forbidden.has(ch) ? '-' : ch).join('');
  s = s.split('\n').join(' ').split('\r').join(' ').split('\t').join(' ').trim();
  while (s.includes('  ')) s = s.split('  ').join(' ');
  return s.slice(0, 120);
};
const recipient = clean(doc.recipient_name);
const issuer = clean(doc.issuer_name);
const configuredOwner = clean(doc.archive_owner_name);
const configuredOwnerCnpj = String(doc.archive_owner_cnpj ?? '').replace(/\D/g, '');
const issuerCnpj = String(doc.issuer_cnpj ?? '').replace(/\D/g, '');
const recipientCnpj = String(doc.recipient_cnpj ?? '').replace(/\D/g, '');
const rawMode = String(doc.archive_mode ?? 'received').toLowerCase();
const archiveMode = ['received', 'issued', 'mixed'].includes(rawMode) ? rawMode : 'received';
let archiveDirection = archiveMode === 'issued' ? 'issued' : 'received';
const reviewReasons = [...new Set(String(doc.review_reason ?? '').split('|').filter(Boolean))];
if (archiveMode === 'mixed') {
  const ownerName = configuredOwner.toLowerCase();
  const issuerMatchesOwner = Boolean(configuredOwnerCnpj && issuerCnpj && configuredOwnerCnpj === issuerCnpj)
    || Boolean(ownerName && issuer.toLowerCase().includes(ownerName));
  const recipientMatchesOwner = Boolean(configuredOwnerCnpj && recipientCnpj && configuredOwnerCnpj === recipientCnpj)
    || Boolean(ownerName && recipient.toLowerCase().includes(ownerName));
  if (issuerMatchesOwner && !recipientMatchesOwner) archiveDirection = 'issued';
  else if (recipientMatchesOwner && !issuerMatchesOwner) archiveDirection = 'received';
  else {
    archiveDirection = 'unknown';
    reviewReasons.push('ARCHIVE_DIRECTION_NOT_EVIDENCED');
  }
}
const evidenceOwner = archiveDirection === 'issued' ? issuer : recipient;
const evidenceOwnerCnpj = archiveDirection === 'issued' ? issuerCnpj : recipientCnpj;
const normalizeIdentity = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]/g, '');
const configuredOwnerKey = normalizeIdentity(configuredOwner);
const evidenceOwnerKey = normalizeIdentity(evidenceOwner);
const namesMatch = configuredOwnerKey.length >= 6 && evidenceOwnerKey.length >= 6
  && (configuredOwnerKey.includes(evidenceOwnerKey) || evidenceOwnerKey.includes(configuredOwnerKey));
const cnpjConflict = Boolean(configuredOwnerCnpj && evidenceOwnerCnpj && configuredOwnerCnpj !== evidenceOwnerCnpj);
const ownerMatchesDocument = !configuredOwner
  ? Boolean(evidenceOwner)
  : (!cnpjConflict && (Boolean(configuredOwnerCnpj && evidenceOwnerCnpj && configuredOwnerCnpj === evidenceOwnerCnpj) || namesMatch));
const ownerMismatch = Boolean(configuredOwner) && !ownerMatchesDocument;
if (!configuredOwner && !evidenceOwner) reviewReasons.push('ARCHIVE_OWNER_NOT_EVIDENCED');
if (ownerMismatch) reviewReasons.push('ARCHIVE_OWNER_NOT_A_DOCUMENT_PARTY');
const mustQuarantine = archiveDirection === 'unknown' || ownerMismatch || (!configuredOwner && !evidenceOwner);
const clientFolder = mustQuarantine ? '99 - Revisar' : (configuredOwner || evidenceOwner);
const reviewRequired = Boolean(doc.review_required) || mustQuarantine;
const clientInFilename = configuredOwner || evidenceOwner || clean(doc.company_name) || 'Cliente não identificado';
const organizedFilename = clean(typeLabels[doc.document_type] ?? doc.document_type) + ' - ' + clientInFilename + ' - ' + doc.reference_date + ' - ' + clean(doc.document_number) + ' - ' + issuer + ext;
return [{ json: {
  ...doc,
  client_folder: clientFolder,
  folder_owner: mustQuarantine ? 'review' : (configuredOwner ? 'configured_owner' : (archiveDirection === 'issued' ? 'issuer' : 'recipient')),
  archive_mode: archiveMode,
  archive_direction: archiveDirection,
  archive_owner_name: configuredOwner || evidenceOwner,
  archive_owner_match: ownerMatchesDocument,
  issuer_folder: clientFolder,
  review_required: reviewRequired,
  review_reason: [...new Set(reviewReasons)].join('|'),
  year_folder: String(d.getFullYear()),
  department_folder: departmentFolders[doc.department] ?? '99 - Revisar',
  month_folder: months[d.getMonth()],
  day_folder: String(d.getDate()).padStart(2, '0'),
  organized_filename: organizedFilename
} }];
