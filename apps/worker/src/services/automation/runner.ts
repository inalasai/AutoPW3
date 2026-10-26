import { Decimal, type AutomationExecution } from '@autopw3/shared';
import type { Clock } from '@autopw3/domain';
import { freshnessOf, resolveTariffRate } from '@autopw3/domain';
import type { Repository } from '../../db/repository';
import type { ITeslaClient } from '../../providers/tesla/client';
import { evaluateSiteCapabilities } from '../../providers/tesla/capabilities';
import { executeDeviceCommand } from '../commands/executor';
import type { TokenStore } from '../tokens/store';
import { evaluateRulesForContext } from './evaluator';
import type { EvaluationContext, EvaluationRunnerOptions } from './types';

export interface AutomationRunnerDependencies {
  readonly repo: Repository;
  readonly teslaClient: ITeslaClient;
  readonly tokenStore?: TokenStore;
  readonly clock?: Clock;
}

export interface SiteAutomationRunReport {
  readonly siteId: string;
  readonly scheduledSlot: string;
  readonly evaluatedCount: number;
  readonly wouldActCount: number;
  readonly actedCount: number;
  readonly skippedCount: number;
  readonly errors: readonly string[];
}

export async function runAutomationForSite(
  siteId: string,
  scheduledSlot: Date,
  deps: AutomationRunnerDependencies,
  options?: EvaluationRunnerOptions,
): Promise<SiteAutomationRunReport> {
  const clock = deps.clock ?? { now: () => new Date() };
  const now = clock.now();
  const maxMissedMinutes = options?.maxMissedMinutes ?? 15;
  const scheduledSlotIso = scheduledSlot.toISOString();
  const errors: string[] = [];

  const site = await deps.repo.getSite(siteId);
  if (!site) {
    return {
      siteId,
      scheduledSlot: scheduledSlotIso,
      evaluatedCount: 0,
      wouldActCount: 0,
      actedCount: 0,
      skippedCount: 0,
      errors: ['Site not found'],
    };
  }

  const householdId =
    (await deps.repo.getHouseholdIdForSite(siteId)) ?? '11111111-1111-4111-8111-111111111111';
  const rulesPage = await deps.repo.listRules(siteId, 100);
  const rules = rulesPage.items;

  // 1. Missed run recovery check
  const delayMs = now.getTime() - scheduledSlot.getTime();
  if (delayMs > maxMissedMinutes * 60_000) {
    let missedCount = 0;
    for (const rule of rules) {
      if (rule.mode === 'DISABLED') continue;
      const executionId = crypto.randomUUID();
      const execution: AutomationExecution = {
        id: executionId,
        ruleId: rule.id,
        siteId,
        scheduledSlot: scheduledSlotIso,
        evaluatedAt: now.toISOString(),
        modeAtEvaluation: rule.mode,
        decision: 'SKIPPED_MISSED',
        reason: `Scheduled slot was delayed by ${Math.round(delayMs / 60000)}m (exceeds ${maxMissedMinutes}m recovery window)`,
        commandId: null,
      };
      await deps.repo.recordAutomationExecution(execution);
      missedCount++;
    }

    return {
      siteId,
      scheduledSlot: scheduledSlotIso,
      evaluatedCount: missedCount,
      wouldActCount: 0,
      actedCount: 0,
      skippedCount: missedCount,
      errors: [`Scheduled slot delayed by ${Math.round(delayMs / 60000)}m; skipped`],
    };
  }

  // 2. Resolve telemetry and freshness
  const latestSample = await deps.repo.getLatestPowerSample(siteId);
  const freshnessResult = freshnessOf(latestSample?.sampledAt ?? null, now);
  const batterySocPercent = latestSample?.batterySocPercent ?? null;

  // 3. Resolve active tariff import rate
  let currentImportRate: Decimal | null = null;
  try {
    const tariffsPage = await deps.repo.listTariffs(householdId, {
      direction: 'IMPORT',
      asOf: now.toISOString().slice(0, 10),
    });
    if (tariffsPage.items.length > 0) {
      const activeTariff = tariffsPage.items[0]!;
      const rateRes = resolveTariffRate(now.getTime(), [activeTariff], 'IMPORT');
      if (rateRes.ok) {
        currentImportRate = Decimal(rateRes.ratePerKwh);
      }
    }
  } catch (err) {
    errors.push(`Tariff resolution failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 4. Resolve site capabilities and pause status
  const isAutomationPaused = await deps.repo.getAutomationPaused(householdId);
  const capabilities = evaluateSiteCapabilities();

  const context: EvaluationContext = {
    siteId,
    householdId,
    timezone: site.timezone || 'UTC',
    now,
    scheduledSlot,
    batterySocPercent,
    telemetryFreshness: freshnessResult.freshness,
    currentImportRate,
    capabilities,
    isAutomationPaused,
  };

  // 5. Evaluate all rules
  const evaluatedResults = evaluateRulesForContext(rules, context);

  let wouldActCount = 0;
  let actedCount = 0;
  let skippedCount = 0;

  for (const evalResult of evaluatedResults) {
    const executionId = crypto.randomUUID();

    // Idempotency: slot key safety
    const executionToRecord: AutomationExecution = {
      id: executionId,
      ruleId: evalResult.ruleId,
      siteId,
      scheduledSlot: scheduledSlotIso,
      evaluatedAt: now.toISOString(),
      modeAtEvaluation: evalResult.mode,
      decision: evalResult.decision,
      reason: evalResult.reason,
      commandId: null,
    };

    const recordResult = await deps.repo.recordAutomationExecution(executionToRecord);

    // If already recorded for this rule and slot, ignore duplicate delivery
    if (recordResult.alreadyRecorded) {
      continue;
    }

    if (evalResult.decision === 'WOULD_ACT') {
      wouldActCount++;
      // Dry run: NEVER dispatch command
    } else if (evalResult.decision === 'ACTED') {
      actedCount++;
      // Active rule: dispatch through Task 17 command service
      for (const action of evalResult.actions) {
        const slotSafe = scheduledSlotIso.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 32);
        const idempotencyKey = `auto-${evalResult.ruleId.slice(0, 8)}-${slotSafe}`;

        try {
          const dispatchRes = await executeDeviceCommand(
            siteId,
            action,
            {
              origin: 'AUTOMATION',
              actorUserId: null,
              idempotencyKey,
            },
            {
              repo: deps.repo,
              teslaClient: deps.teslaClient,
              tokenStore: deps.tokenStore,
              clock,
            },
          );

          void dispatchRes;
        } catch (dispatchErr) {
          errors.push(
            `Rule "${evalResult.ruleName}" command dispatch failed: ${dispatchErr instanceof Error ? dispatchErr.message : String(dispatchErr)}`,
          );
        }
      }
    } else {
      skippedCount++;
    }
  }

  return {
    siteId,
    scheduledSlot: scheduledSlotIso,
    evaluatedCount: evaluatedResults.length,
    wouldActCount,
    actedCount,
    skippedCount,
    errors,
  };
}
