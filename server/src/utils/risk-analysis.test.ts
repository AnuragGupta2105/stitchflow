import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateRiskAnalysis,
  type RiskCalculationInput,
} from './risk-analysis';

const now = new Date('2026-11-04T12:00:00.000Z');
const dayMs = 24 * 60 * 60 * 1000;

function makeOrder(
  overrides: Partial<RiskCalculationInput> = {},
): RiskCalculationInput {
  return {
    totalQuantity: 10_000,
    completedQty: 5_000,
    exFactoryDate: new Date('2026-12-14T00:00:00.000Z'),
    milestones: [
      {
        stage: 'STITCHING',
        plannedDate: new Date('2026-11-01T00:00:00.000Z'),
        status: 'IN_PROGRESS',
      },
    ],
    updates: Array.from({ length: 7 }, (_, index) => ({
      stage: 'STITCHING',
      quantity: 1_000,
      createdAt: new Date(now.getTime() - (index + 1) * dayMs),
    })),
    ...overrides,
  };
}

test('marks an order on track when recent run rate leaves more than 14 days of buffer', () => {
  const result = calculateRiskAnalysis(makeOrder(), now);

  assert.equal(result.status, 'ON_TRACK');
  assert.equal(result.actualDailyRate, 1_000);
  assert.equal(result.remainingQuantity, 5_000);
  assert.ok((result.bufferDays ?? 0) > 14);
});

test('marks an order delayed when projected finish is after ex-factory date', () => {
  const result = calculateRiskAnalysis(
    makeOrder({
      totalQuantity: 10_000,
      completedQty: 1_000,
      exFactoryDate: new Date('2026-11-14T00:00:00.000Z'),
      updates: Array.from({ length: 7 }, (_, index) => ({
        stage: 'STITCHING',
        quantity: 100,
        createdAt: new Date(now.getTime() - (index + 1) * dayMs),
      })),
    }),
    now,
  );

  assert.equal(result.status, 'DELAYED');
  assert.ok((result.projectedDays ?? 0) > result.daysLeft);
});

test('marks an order at risk when projected buffer is within 14 days', () => {
  const result = calculateRiskAnalysis(
    makeOrder({
      totalQuantity: 10_000,
      completedQty: 3_000,
      exFactoryDate: new Date('2026-12-04T00:00:00.000Z'),
      updates: Array.from({ length: 7 }, (_, index) => ({
        stage: 'STITCHING',
        quantity: 300,
        createdAt: new Date(now.getTime() - (index + 1) * dayMs),
      })),
    }),
    now,
  );

  assert.equal(result.status, 'AT_RISK');
  assert.ok((result.bufferDays ?? Infinity) <= 14);
});

test('marks an order at risk when no current-stage update was reported in seven days', () => {
  const result = calculateRiskAnalysis(
    makeOrder({ updates: [] }),
    now,
  );

  assert.equal(result.status, 'AT_RISK');
  assert.equal(result.actualDailyRate, 0);
  assert.match(result.reason, /No STITCHING output/);
});

test('marks an order completed when no pieces remain', () => {
  const result = calculateRiskAnalysis(
    makeOrder({ completedQty: 10_000 }),
    now,
  );

  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.remainingQuantity, 0);
});

test('uses latest floor-reported incomplete stage when no milestone is marked in progress', () => {
  const result = calculateRiskAnalysis(
    makeOrder({
      milestones: [
        {
          stage: 'CUTTING',
          plannedDate: new Date('2026-10-20T00:00:00.000Z'),
          status: 'PENDING',
        },
        {
          stage: 'STITCHING',
          plannedDate: new Date('2026-10-25T00:00:00.000Z'),
          status: 'PENDING',
        },
      ],
      updates: [
        {
          stage: 'STITCHING',
          quantity: 250,
          createdAt: new Date(now.getTime() - dayMs),
        },
      ],
    }),
    now,
  );

  assert.equal(result.currentStage, 'STITCHING');
  assert.equal(result.recentOutputPieces, 250);
});
