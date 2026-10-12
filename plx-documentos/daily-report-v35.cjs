'use strict';

const DEPARTMENT_LABELS = {
  fiscal: 'Fiscal',
  contabil: 'Contábil',
  pessoal: 'Folha/Pessoal',
  revisar: 'Revisar',
};

function clean(value, fallback = '') {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || fallback;
}

function reportDate(row) {
  // O fechamento responde "o que foi organizado hoje". A data de referência
  // pertence ao documento e pode ser antiga (boleto/nota atrasada enviada hoje),
  // portanto nunca deve decidir em qual fechamento operacional ele entra.
  const raw = row.organized_at || row.finished_at || row.updated_at || row.received_at || '';
  return clean(raw).slice(0, 10);
}

function countBy(rows, key) {
  return rows.reduce((acc, row) => {
    const value = clean(row[key], 'desconhecido').toLowerCase();
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function sortedEntries(record) {
  return Object.entries(record).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'));
}

function uniqueDocuments(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = clean(row.idempotency_key) || clean(row.drive_file_id) || clean(row.benchmark_id);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function splitMessage(text, limit = 3500) {
  if (text.length <= limit) return [text];
  const parts = [];
  let current = '';
  for (const line of text.split('\n')) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length <= limit) {
      current = candidate;
      continue;
    }
    if (current) parts.push(current);
    current = line.length <= limit ? line : `${line.slice(0, limit - 1)}…`;
  }
  if (current) parts.push(current);
  return parts;
}

function buildDailyReport(inputRows, targetDate, options = {}) {
  const rows = uniqueDocuments(inputRows).filter((row) => {
    const status = clean(row.status).toUpperCase();
    return reportDate(row) === targetDate && ['ORGANIZED', 'ORGANIZED_ATTENTION'].includes(status);
  });
  const attention = rows.filter((row) => Boolean(row.review_required) || clean(row.status).toUpperCase() === 'ORGANIZED_ATTENTION');
  const departments = countBy(rows, 'department');
  const types = countBy(rows, 'document_type');
  const lines = [
    `📂 Fechamento documental — ${targetDate.split('-').reverse().join('/')}`,
    `Total organizado: ${rows.length}`,
    `Sem pendência: ${rows.length - attention.length}`,
    `Com atenção: ${attention.length}`,
    '',
    'Por departamento:',
    ...(sortedEntries(departments).length
      ? sortedEntries(departments).map(([name, count]) => `• ${DEPARTMENT_LABELS[name] || name}: ${count}`)
      : ['• Nenhum documento organizado']),
    '',
    'Por categoria:',
    ...(sortedEntries(types).length
      ? sortedEntries(types).map(([name, count]) => `• ${name}: ${count}`)
      : ['• Nenhuma categoria']),
  ];

  if (attention.length) {
    lines.push('', 'Atenções:');
    attention.slice(0, options.maxAttentionItems || 30).forEach((row) => {
      const name = clean(row.final_filename || row.source_filename || row.original_filename, 'Documento sem nome');
      const reason = clean(row.review_reason, 'conferência humana solicitada');
      lines.push(`• ${name} — ${reason}`);
    });
    if (attention.length > (options.maxAttentionItems || 30)) {
      lines.push(`• +${attention.length - (options.maxAttentionItems || 30)} pendências no manifesto`);
    }
  }

  lines.push('', 'Arquivos permanecem no Drive e prontos para lançamento no sistema contábil.');
  const text = lines.join('\n');
  return {
    target_date: targetDate,
    total: rows.length,
    organized: rows.length - attention.length,
    attention: attention.length,
    departments,
    document_types: types,
    text,
    parts: splitMessage(text, options.messageLimit || 3500),
  };
}

module.exports = { buildDailyReport, splitMessage, uniqueDocuments };
