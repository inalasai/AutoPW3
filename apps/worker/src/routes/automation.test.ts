import { beforeEach, describe, expect, it } from 'vitest';
import type { CreateRuleRequest, UpdateRuleRequest } from '@autopw3/shared';
import { InMemoryRepository } from '../db/repository';
import {
  handleActivateRule,
  handleCreateRule,
  handleDeleteRule,
  handleListExecutions,
  handleListRules,
  handleUpdateRule,
} from './automation';

describe('automation routes', () => {
  const SITE_ID = '22222222-2222-4222-8222-222222222222';
  let repo: InMemoryRepository;

  beforeEach(() => {
    repo = new InMemoryRepository();
  });

  const VALID_CREATE: CreateRuleRequest = {
    name: 'Evening Peak Reserve',
    priority: 150,
    mode: 'DRY_RUN',
    definition: {
      conditions: [
        {
          type: 'BATTERY_SOC',
          comparator: 'LT',
          valuePercent: 40,
        },
      ],
      actions: [
        {
          kind: 'SET_BACKUP_RESERVE',
          params: { backupReservePercent: 50 },
        },
      ],
    },
  };

  it('lists existing rules for site', async () => {
    const res = await handleListRules(SITE_ID, {}, repo, 'req-1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items.length).toBeGreaterThan(0);
  });

  it('creates rule in DRY_RUN or DISABLED mode, but rejects creation in ACTIVE mode', async () => {
    // 1. Success in DRY_RUN
    const res = await handleCreateRule(SITE_ID, VALID_CREATE, repo, 'req-2');
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; mode: string };
    expect(created.mode).toBe('DRY_RUN');

    // 2. Rejection if client attempts to pass ACTIVE at creation
    const invalidActive = { ...VALID_CREATE, mode: 'ACTIVE' as const };
    const rejectRes = await handleCreateRule(
      SITE_ID,
      invalidActive as unknown as CreateRuleRequest,
      repo,
      'req-3',
    );
    expect(rejectRes.status).toBe(422);
    const errBody = (await rejectRes.json()) as { error: { code: string } };
    expect(errBody.error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects activating rule via standard handleUpdateRule', async () => {
    const rulesPage = await repo.listRules(SITE_ID, 10);
    const ruleId = rulesPage.items[0]!.id;

    const res = await handleUpdateRule(
      ruleId,
      { version: 1, mode: 'ACTIVE' as const } as unknown as UpdateRuleRequest,
      repo,
      'req-4',
    );
    expect(res.status).toBe(422);
  });

  it('restricts handleActivateRule to ADMIN role only', async () => {
    const rulesPage = await repo.listRules(SITE_ID, 10);
    const ruleId = rulesPage.items[0]!.id;

    // READ_WRITE forbidden
    const rwRes = await handleActivateRule(ruleId, 'READ_WRITE', repo, 'req-5');
    expect(rwRes.status).toBe(403);

    // ADMIN allowed
    const adminRes = await handleActivateRule(ruleId, 'ADMIN', repo, 'req-6');
    expect(adminRes.status).toBe(200);
    const body = (await adminRes.json()) as { mode: string };
    expect(body.mode).toBe('ACTIVE');
  });

  it('deletes rule via handleDeleteRule', async () => {
    const res = await handleCreateRule(SITE_ID, VALID_CREATE, repo, 'req-7');
    const created = (await res.json()) as { id: string };

    const delRes = await handleDeleteRule(created.id, repo, 'req-8');
    expect(delRes.status).toBe(200);

    const lookup = await repo.getRule(created.id);
    expect(lookup).toBeNull();
  });

  it('lists executions for a site', async () => {
    const execRes = await handleListExecutions(SITE_ID, {}, repo, 'req-9');
    expect(execRes.status).toBe(200);
    const body = (await execRes.json()) as { items: unknown[] };
    expect(Array.isArray(body.items)).toBe(true);
  });
});
