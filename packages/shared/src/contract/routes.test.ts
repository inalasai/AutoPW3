/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ACCESS_MIN_ROLE, ROUTES, ROUTE_ACCESS, pathParamNames, pathParamsSchema } from '../index';
import type { RouteSpec } from '../index';

/**
 * Drift guard between the route table (schemas/routes.ts) and docs/API_CONTRACT.md section 2: same endpoints, same
 * minimum role, same implementing task. Change one without the other and this fails.
 */

const contract = readFileSync(
  fileURLToPath(new URL('../../../../docs/API_CONTRACT.md', import.meta.url)),
  'utf8',
).replaceAll('\r\n', '\n');

interface DocRow {
  method: string;
  path: string;
  access: string;
  task: string;
}

const docRows: DocRow[] = [];
for (const line of contract.split('\n')) {
  const cells = line.split('|').map((c) => c.trim());
  // | GET | `/health` | public | notes | 14 |  => ['', 'GET', '`/health`', 'public', 'notes', '14', '']
  if (cells.length < 7) continue;
  const [, method, path, access] = cells;
  // Notes may contain a '|' inside backticks, so the task is read from the END of the row.
  const task = cells[cells.length - 2];
  if (!method || !/^(GET|POST|PATCH|PUT|DELETE)$/.test(method)) continue;
  if (!path || !/^`\//.test(path)) continue;
  docRows.push({
    method,
    path: path.replaceAll('`', ''),
    access: (access ?? '').split(' ')[0] as string,
    task: task ?? '',
  });
}

const entries = (Object.entries(ROUTES) as [string, RouteSpec][]).map(([name, spec]) => ({
  name,
  ...spec,
}));
const key = (r: { method: string; path: string }) => `${r.method} ${r.path}`;

describe('route table equals docs/API_CONTRACT.md', () => {
  it('found the contract endpoints', () => {
    expect(docRows.length).toBeGreaterThanOrEqual(50);
  });

  it('has an entry for every documented endpoint and no extra ones', () => {
    expect(entries.map(key).sort()).toEqual(docRows.map(key).sort());
  });

  it('uses the documented minimum role for every endpoint', () => {
    const byKey = new Map(docRows.map((r) => [key(r), r]));
    for (const e of entries) {
      expect(`${key(e)} -> ${e.access}`).toBe(`${key(e)} -> ${byKey.get(key(e))?.access}`);
    }
  });

  it('names the documented implementing task for every endpoint', () => {
    const byKey = new Map(docRows.map((r) => [key(r), r]));
    for (const e of entries) {
      expect(`${key(e)} -> ${e.task}`).toBe(`${key(e)} -> ${byKey.get(key(e))?.task}`);
    }
  });

  it('has unique method and path pairs and unique names', () => {
    expect(new Set(entries.map(key)).size).toBe(entries.length);
  });
});

describe('route table rules', () => {
  it('uses only known access levels', () => {
    for (const e of entries) expect(ROUTE_ACCESS).toContain(e.access);
  });

  it('maps access levels to the household roles (RW means READ_WRITE)', () => {
    expect(ACCESS_MIN_ROLE).toEqual({
      public: null,
      any: null,
      member: 'READ_ONLY',
      RW: 'READ_WRITE',
      ADMIN: 'ADMIN',
    });
  });

  it('requires an Idempotency-Key on commands and invitations only among the creating routes', () => {
    const required = entries
      .filter((e) => e.idempotencyKeyRequired)
      .map(key)
      .sort();
    expect(required).toEqual(
      ['POST /households/{hid}/invitations', 'POST /sites/{siteId}/commands'].sort(),
    );
  });

  it('makes only the health check and the Tesla callback public', () => {
    expect(
      entries
        .filter((e) => e.access === 'public')
        .map((e) => e.path)
        .sort(),
    ).toEqual(['/health', '/provider/tesla/callback']);
  });

  it('lets only ADMIN activate a rule, resume automation and manage members', () => {
    const admin = (n: keyof typeof ROUTES) => ROUTES[n].access;
    expect(admin('activateRule')).toBe('ADMIN');
    expect(admin('resumeAutomation')).toBe('ADMIN');
    expect(admin('pauseAutomation')).toBe('RW');
    expect(admin('changeMemberRole')).toBe('ADMIN');
    expect(admin('createInvitation')).toBe('ADMIN');
    expect(admin('createCommand')).toBe('RW');
    expect(admin('listAudit')).toBe('ADMIN');
  });

  it('gives every route with a success body a response schema, and 204 or a redirect none', () => {
    for (const e of entries) {
      if (e.status === 204 || e.status === 302) expect(e.response).toBeNull();
      else expect(e.response).not.toBeNull();
    }
  });

  it('answers a command request with 202 and a creating POST with 201', () => {
    expect(ROUTES.createCommand.status).toBe(202);
    for (const n of ['createInvitation', 'createSite', 'createTariff', 'createRule'] as const) {
      expect(ROUTES[n].status).toBe(201);
    }
  });
});

describe('path parameters', () => {
  it('finds the placeholders in order', () => {
    expect(pathParamNames('/households/{hid}/members/{userId}')).toEqual(['hid', 'userId']);
    expect(pathParamNames('/health')).toEqual([]);
  });

  it('requires every id to be a UUID and refuses extras', () => {
    const schema = pathParamsSchema('/households/{hid}/members/{userId}');
    const id = '3f8b1c2e-9a4d-4e7b-8c11-6d5f0a2b7e90';
    expect(schema.safeParse({ hid: id, userId: id }).success).toBe(true);
    expect(schema.safeParse({ hid: 'me', userId: id }).success).toBe(false);
    expect(schema.safeParse({ hid: id }).success).toBe(false);
    expect(schema.safeParse({ hid: id, userId: id, extra: id }).success).toBe(false);
  });
});
