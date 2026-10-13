'use strict';

const COUNTERS = Object.freeze([
  'document_received_total',
  'document_extracted_total',
  'reinforcement_failures_total',
  'reconciliation_discrepancies_total',
]);

function createMetrics(initial = {}) {
  const values = new Map(COUNTERS.map((name) => [name, Number(initial[name] || 0)]));

  function assertCounter(name) {
    if (!COUNTERS.includes(name)) throw new Error(`metric_unknown:${name}`);
  }

  return Object.freeze({
    increment(name, amount = 1) {
      assertCounter(name);
      const delta = Number(amount);
      if (!Number.isFinite(delta) || delta < 0) throw new Error('metric_increment_invalid');
      values.set(name, values.get(name) + delta);
      return values.get(name);
    },
    set(name, value) {
      assertCounter(name);
      const next = Number(value);
      if (!Number.isFinite(next) || next < 0) throw new Error('metric_value_invalid');
      values.set(name, next);
      return next;
    },
    snapshot() {
      return Object.fromEntries(COUNTERS.map((name) => [name, values.get(name)]));
    },
    reset() {
      for (const name of COUNTERS) values.set(name, 0);
    },
  });
}

const defaultMetrics = createMetrics();

module.exports = { COUNTERS, createMetrics, defaultMetrics };
