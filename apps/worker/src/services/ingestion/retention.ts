import type { Repository } from '../../db/repository';
import type { RetentionResult } from './types';

export interface RetentionOptions {
  readonly dryRun?: boolean;
  readonly rawMetricsRetentionDays?: number; // default: 90 days
  readonly finishedJobsRetentionDays?: number; // default: 30 days
  readonly now?: Date;
}

export async function runRetentionJob(
  repo: Repository,
  options: RetentionOptions = {},
): Promise<RetentionResult> {
  const dryRun = options.dryRun ?? false;
  const rawRetentionDays = options.rawMetricsRetentionDays ?? 90;
  const jobsRetentionDays = options.finishedJobsRetentionDays ?? 30;
  const now = options.now ?? new Date();

  const cutoffRawMetricsMs = now.getTime() - rawRetentionDays * 24 * 60 * 60 * 1000;
  const cutoffRawMetricsUtc = new Date(cutoffRawMetricsMs).toISOString();

  const cutoffJobsMs = now.getTime() - jobsRetentionDays * 24 * 60 * 60 * 1000;
  const cutoffJobsUtc = new Date(cutoffJobsMs).toISOString();

  const rawResult = await repo.purgeOldMetricsLog(cutoffRawMetricsUtc, dryRun);
  const jobsResult = await repo.purgeOldScheduledJobs(cutoffJobsUtc, dryRun);

  return {
    dryRun,
    rawMetricsDeleted: rawResult.deletedCount,
    jobsDeleted: jobsResult.deletedCount,
    cutoffRawMetricsUtc,
    cutoffJobsUtc,
  };
}
