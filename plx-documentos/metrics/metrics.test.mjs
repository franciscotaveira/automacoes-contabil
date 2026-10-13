import assert from 'node:assert/strict';
import test from 'node:test';
import metricsModule from '../lib/metrics.js';

const { COUNTERS, createMetrics } = metricsModule;

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
