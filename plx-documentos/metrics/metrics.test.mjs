import assert from 'node:assert/strict';
import test from 'node:test';
import metricsModule from '../lib/metrics.js';

const { COUNTERS, createMetrics, evaluateAlerts } = metricsModule;

test('metrics exposes only declared non-negative counters', () => {
  const metrics = createMetrics();
  metrics.increment('document_received_total');
  metrics.increment('document_extracted_total', 2);
  assert.deepEqual(Object.keys(metrics.snapshot()), [...COUNTERS]);
  assert.equal(metrics.snapshot().document_received_total, 1);
  assert.equal(metrics.snapshot().document_extracted_total, 2);
  assert.throws(() => metrics.increment('unknown_total'), /metric_unknown/);
  assert.throws(() => metrics.increment('document_received_total', -1), /metric_increment_invalid/);
});

test('evaluateAlerts reports configured operational thresholds', () => {
  assert.deepEqual(evaluateAlerts({ document_received_total: 10 }), []);
  assert.deepEqual(
    evaluateAlerts({
      document_received_total: 10,
      reinforcement_failures_total: 3,
      reconciliation_discrepancies_total: 1,
    }, { review_required_total: 2 }),
    [
      { code: 'REINFORCEMENT_FAILURE_RATE', severity: 'warning', value: 3 },
      { code: 'REVIEW_RATE_HIGH', severity: 'warning', value: 0.2 },
      { code: 'RECONCILIATION_DISCREPANCY', severity: 'critical', value: 1 },
    ],
  );
});
