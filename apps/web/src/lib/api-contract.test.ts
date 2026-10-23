import { describe, expect, it } from 'vitest';
import { parseRouteResponse, routePath } from './api-contract';

const id = '3f8b1c2e-9a4d-4e7b-8c11-6d5f0a2b7e90';

describe('routePath', () => {
  it('builds paths from the shared route table', () => {
    expect(routePath('health')).toBe('/api/v1/health');
    expect(routePath('getSite', { siteId: id })).toBe(`/api/v1/sites/${id}`);
    expect(routePath('changeMemberRole', { hid: id, userId: id })).toBe(
      `/api/v1/households/${id}/members/${id}`,
    );
  });

  it('refuses a missing or malformed id instead of building a path', () => {
    expect(() => routePath('getSite')).toThrow();
    expect(() => routePath('getSite', { siteId: '../admin' })).toThrow();
    expect(() => routePath('getSite', { siteId: id, extra: id })).toThrow();
  });
});

describe('parseRouteResponse', () => {
  it('accepts a body the contract allows', () => {
    expect(parseRouteResponse('health', { status: 'ok' })).toEqual({ status: 'ok' });
  });

  it('rejects a body the contract does not allow', () => {
    expect(() => parseRouteResponse('health', { status: 'ok', version: '1' })).toThrow();
    expect(() => parseRouteResponse('getMe', { memberships: [] })).toThrow();
  });

  it('rejects a response request for a route with no body', () => {
    expect(() => parseRouteResponse('removeMember', {})).toThrow();
  });
});
