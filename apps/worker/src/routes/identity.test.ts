import { describe, expect, it, vi } from 'vitest';
import type { IdentityRepository } from '../db/identity-repository';
import type { InvitationItem } from '../db/repository';
import type { VerifiedUser } from '../lib/jwt';
import { handleCreateInvitation } from './identity';

const caller = {
  userId: 'user-123',
  email: 'user@example.com',
} as VerifiedUser;

const invitation = {
  id: 'invitation-123',
} as InvitationItem;

function makeRepo() {
  return {
    createInvitation: vi.fn().mockResolvedValue({
      invitation,
      token: 'test-token',
    }),
  } as unknown as IdentityRepository;
}

const validConfig = {
  appBaseUrl: 'http://localhost:5173',
  allowedOrigins: 'http://localhost:5173,https://app.autopw3.com',
  environment: 'test',
};

describe('handleCreateInvitation URL configuration', () => {
  it('creates an invitation with a URL built from APP_BASE_URL', async () => {
    const repo = makeRepo();

    const response = await handleCreateInvitation(
      'household-123',
      {},
      caller,
      repo,
      validConfig,
      'request-1',
    );

    expect(response.status).toBe(201);

    const body = (await response.json()) as {
      invitation: InvitationItem;
      token: string;
      link: string;
    };

    expect(body.invitation).toEqual(invitation);
    expect(body.token).toBe('test-token');
    expect(body.link).toBe('http://localhost:5173/invite?token=test-token');
    expect(repo.createInvitation).toHaveBeenCalledOnce();
  });

  it('encodes the invitation token in the URL', async () => {
    const repo = makeRepo();

    (repo.createInvitation as ReturnType<typeof vi.fn>).mockResolvedValue({
      invitation,
      token: 'token+with&special=characters',
    });

    const response = await handleCreateInvitation(
      'household-123',
      {},
      caller,
      repo,
      validConfig,
      'request-2',
    );

    const body = (await response.json()) as { link: string };
    const url = new URL(body.link);

    expect(url.pathname).toBe('/invite');
    expect(url.searchParams.get('token')).toBe('token+with&special=characters');
  });

  it('rejects a missing APP_BASE_URL before creating an invitation', async () => {
    const repo = makeRepo();

    const response = await handleCreateInvitation(
      'household-123',
      {},
      caller,
      repo,
      {
        ...validConfig,
        appBaseUrl: undefined,
      },
      'request-3',
    );

    expect(response.status).toBe(502);
    expect(repo.createInvitation).not.toHaveBeenCalled();
  });

  it('rejects an origin not present in ALLOWED_ORIGINS', async () => {
    const repo = makeRepo();

    const response = await handleCreateInvitation(
      'household-123',
      {},
      caller,
      repo,
      {
        ...validConfig,
        appBaseUrl: 'https://attacker.example.com',
      },
      'request-4',
    );

    expect(response.status).toBe(502);
    expect(repo.createInvitation).not.toHaveBeenCalled();
  });

  it('rejects HTTP outside local and test environments', async () => {
    const repo = makeRepo();

    const response = await handleCreateInvitation(
      'household-123',
      {},
      caller,
      repo,
      {
        appBaseUrl: 'http://app.autopw3.com',
        allowedOrigins: 'http://app.autopw3.com',
        environment: 'production',
      },
      'request-5',
    );

    expect(response.status).toBe(502);
    expect(repo.createInvitation).not.toHaveBeenCalled();
  });

  it.each([
    'https://app.autopw3.com/some/path',
    'https://user:password@app.autopw3.com',
    'https://app.autopw3.com?redirect=attacker.example.com',
  ])('rejects an invalid base URL: %s', async (appBaseUrl) => {
    const repo = makeRepo();

    const response = await handleCreateInvitation(
      'household-123',
      {},
      caller,
      repo,
      {
        appBaseUrl,
        allowedOrigins: 'https://app.autopw3.com',
        environment: 'production',
      },
      'request-6',
    );

    expect(response.status).toBe(502);
    expect(repo.createInvitation).not.toHaveBeenCalled();
  });
});
