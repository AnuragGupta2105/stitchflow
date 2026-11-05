export type RiskCalculationInput = {
  totalQuantity: number;
  completedQty: number;
  exFactoryDate: Date;
  milestones: Array<{
    stage: string;
    plannedDate: Date;
    status: string;
  }>;
  updates: Array<{
    stage: string;
    quantity: number;
    createdAt: Date;
  }>;
};

export const DAY_MS = 24 * 60 * 60 * 1000;
export const RUN_RATE_WINDOW_DAYS = 7;
export const EARLY_WARNING_BUFFER_DAYS = 14;

export function calculateRiskAnalysis(
  order: RiskCalculationInput,
  now = new Date(),
) {
  const remainingQuantity = Math.max(
    order.totalQuantity - order.completedQty,
    0,
  );

  const todayUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const exFactoryUtc = Date.UTC(
    order.exFactoryDate.getUTCFullYear(),
    order.exFactoryDate.getUTCMonth(),
    order.exFactoryDate.getUTCDate(),
  );
  const daysLeft = Math.ceil((exFactoryUtc - todayUtc) / DAY_MS);

  const sortedMilestones = [...order.milestones].sort(
    (a, b) => a.plannedDate.getTime() - b.plannedDate.getTime(),
  );
  const inProgressMilestone = sortedMilestones.find(
    (milestone) => milestone.status === 'IN_PROGRESS',
  );
  const firstIncompleteMilestone = sortedMilestones.find(
    (milestone) => milestone.status !== 'COMPLETED',
  );
  const latestUpdate = [...order.updates].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  )[0];
  const latestReportedIncompleteMilestone = latestUpdate
    ? sortedMilestones.find(
        (milestone) =>
          milestone.stage === latestUpdate.stage && milestone.status !== 'COMPLETED',
      )
    : undefined;

  // An explicit IN_PROGRESS milestone wins. If TNA statuses have not yet been
  // advanced, use the latest stage actually reported by the floor before
  // falling back to the first incomplete milestone.
  const currentMilestone =
    inProgressMilestone ??
    latestReportedIncompleteMilestone ??
    firstIncompleteMilestone ??
    sortedMilestones[sortedMilestones.length - 1];
  const currentStage = currentMilestone?.stage ?? latestUpdate?.stage ?? null;

  const lookbackStart = new Date(
    now.getTime() - RUN_RATE_WINDOW_DAYS * DAY_MS,
  );
  const currentStageUpdates = order.updates.filter(
    (update) =>
      update.createdAt.getTime() >= lookbackStart.getTime() &&
      (!currentStage || update.stage === currentStage),
  );

  const recentOutputPieces = currentStageUpdates.reduce(
    (total, update) => total + update.quantity,
    0,
  );
  const reportingDays = new Set(
    currentStageUpdates.map((update) => update.createdAt.toISOString().slice(0, 10)),
  ).size;

  // The divisor remains seven, including days with no report. This is
  // deliberately conservative: missed reporting cannot inflate the run rate.
  const actualDailyRate =
    currentStageUpdates.length > 0
      ? recentOutputPieces / RUN_RATE_WINDOW_DAYS
      : 0;
  const requiredDailyRate =
    daysLeft > 0 && remainingQuantity > 0
      ? remainingQuantity / daysLeft
      : null;
  const projectedDays =
    actualDailyRate > 0 && remainingQuantity > 0
      ? remainingQuantity / actualDailyRate
      : remainingQuantity === 0
        ? 0
        : null;
  const bufferDays =
    projectedDays === null
      ? null
      : Number((daysLeft - projectedDays).toFixed(1));

  let status: 'ON_TRACK' | 'AT_RISK' | 'DELAYED' | 'COMPLETED';
  let reason: string;

  if (remainingQuantity === 0) {
    status = 'COMPLETED';
    reason = 'All order quantities are marked complete.';
  } else if (daysLeft <= 0) {
    status = 'DELAYED';
    reason = 'The ex-factory date has arrived or passed with pieces still remaining.';
  } else if (currentStageUpdates.length === 0 || actualDailyRate <= 0) {
    status = 'AT_RISK';
    reason = `No ${currentStage ?? 'current-stage'} output was reported in the last ${RUN_RATE_WINDOW_DAYS} calendar days.`;
  } else if (projectedDays !== null && projectedDays > daysLeft) {
    status = 'DELAYED';
    reason = 'At the recent output rate, the projected finish is after the ex-factory date.';
  } else if (bufferDays !== null && bufferDays <= EARLY_WARNING_BUFFER_DAYS) {
    status = 'AT_RISK';
    reason = `Projected finish has ${Math.max(0, bufferDays).toFixed(1)} days of buffer, within the ${EARLY_WARNING_BUFFER_DAYS}-day early-warning window.`;
  } else {
    status = 'ON_TRACK';
    reason = 'Recent output is sufficient to finish with more than 14 days of projected buffer.';
  }

  return {
    status,
    reason,
    currentStage,
    remainingQuantity,
    daysLeft: Math.max(daysLeft, 0),
    recentOutputPieces,
    reportingDays,
    lookbackDays: RUN_RATE_WINDOW_DAYS,
    requiredDailyRate,
    actualDailyRate: Number(actualDailyRate.toFixed(2)),
    projectedDays: projectedDays === null ? null : Number(projectedDays.toFixed(1)),
    bufferDays,
    earlyWarningDays: EARLY_WARNING_BUFFER_DAYS,
  };
}
