import { z } from 'zod';
import { createPrivilegedRpcClient, type PrivilegedRpcClient } from '../../db/system-client';
import type { OAuthStatePayload, OAuthStateStore } from '../../providers/tesla/oauth';
import type { DecryptedTokens, TokenStore } from './store';
import { decryptTokenPayload, encryptTokenPayload, type Keyring } from './encryption';

type DurableKeySource = string | Uint8Array | Keyring;

const tokenEnvelopeSchema = z.object({
  householdId: z.string().uuid(),
  tokens: z.object({
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1),
    expiresAt: z.number().int().positive(),
    tokenType: z.string().min(1),
    scope: z.string(),
    regionBaseUrl: z.string().url().startsWith('https://'),
  }),
});

const oauthEnvelopeSchema = z.object({
  householdId: z.string().uuid(),
  userId: z.string().uuid(),
  codeVerifier: z.string().min(43).max(128),
  expiresAt: z.number().int().positive(),
});

interface StoredCredentialRow {
  readonly nonce: string;
  readonly ciphertext: string;
  readonly version: number;
  readonly scopes: readonly string[] | null;
  readonly fleet_api_base_url: string;
  readonly access_expires_at: string | null;
  readonly status: string;
}

interface StoredOAuthStateRow {
  readonly household_id: string;
  readonly user_id: string;
  readonly pkce_verifier_ciphertext: string;
  readonly pkce_nonce: string;
  readonly expires_at: string;
}

export class SupabaseTokenStore implements TokenStore {
  private readonly rpc: PrivilegedRpcClient;
  private readonly refreshOwners = new Map<string, string>();

  constructor(
    supabaseUrl: string,
    serviceRoleKey: string,
    private readonly keySource: DurableKeySource,
    private readonly activeKeyVersion = 1,
    fetcher: typeof fetch = fetch,
  ) {
    this.rpc = createPrivilegedRpcClient(supabaseUrl, serviceRoleKey, fetcher);
    this.assertActiveKey();
  }

  async saveTokens(householdId: string, tokens: DecryptedTokens): Promise<void> {
    const payload = await encryptTokenPayload(
      JSON.stringify({ householdId, tokens }),
      this.activeKey(),
      this.activeKeyVersion,
    );
    await this.rpc.call<boolean>('worker_save_tesla_credentials', {
      p_household_id: householdId,
      p_key_id: `v${payload.keyVersion}`,
      p_nonce: toPostgresBytea(fromBase64(payload.iv)),
      p_ciphertext: toPostgresBytea(fromBase64(payload.ciphertext)),
      p_version: payload.keyVersion,
      p_scopes: tokens.scope.split(' ').filter(Boolean),
      p_fleet_api_base_url: tokens.regionBaseUrl,
      p_access_expires_at: new Date(tokens.expiresAt * 1000).toISOString(),
    });
  }

  async getTokens(householdId: string): Promise<DecryptedTokens | null> {
    const rows = await this.rpc.call<readonly StoredCredentialRow[]>(
      'worker_get_tesla_credentials',
      { p_household_id: householdId },
    );
    const row = rows[0];
    if (!row || row.status !== 'ACTIVE') return null;
    const encrypted = {
      ciphertext: toBase64(fromPostgresBytea(row.ciphertext)),
      iv: toBase64(fromPostgresBytea(row.nonce)),
      keyVersion: row.version,
    };
    let decoded: unknown;
    try {
      decoded = JSON.parse(await decryptTokenPayload(encrypted, this.keySource));
    } catch {
      throw new Error('Encrypted Tesla credential could not be verified');
    }
    const envelope = tokenEnvelopeSchema.safeParse(decoded);
    const rowExpiry = row.access_expires_at ? Date.parse(row.access_expires_at) : Number.NaN;
    if (
      !envelope.success ||
      envelope.data.householdId !== householdId ||
      envelope.data.tokens.regionBaseUrl !== row.fleet_api_base_url ||
      !Number.isFinite(rowExpiry) ||
      Math.abs(envelope.data.tokens.expiresAt * 1000 - rowExpiry) >= 1000
    ) {
      throw new Error('Encrypted Tesla credential record is invalid');
    }
    return envelope.data.tokens;
  }

  async deleteTokens(householdId: string): Promise<void> {
    await this.rpc.call<boolean>('worker_delete_tesla_credentials', {
      p_household_id: householdId,
    });
    await this.releaseRefreshLock(householdId);
    this.refreshOwners.delete(householdId);
  }

  async acquireRefreshLock(householdId: string, ttlMs = 15_000): Promise<boolean> {
    const leaseSeconds = Math.max(1, Math.min(3600, Math.ceil(ttlMs / 1000)));
    const owner = createLeaseOwner();
    const acquired = await this.rpc.call<boolean>('worker_acquire_lock', {
      p_key: `token:${householdId}`,
      p_owner: owner,
      p_lease_seconds: leaseSeconds,
    });
    if (acquired) this.refreshOwners.set(householdId, owner);
    return acquired;
  }

  async releaseRefreshLock(householdId: string): Promise<void> {
    const owner = this.refreshOwners.get(householdId);
    if (!owner) return;
    try {
      await this.rpc.call<boolean>('worker_release_lock', {
        p_key: `token:${householdId}`,
        p_owner: owner,
      });
    } finally {
      this.refreshOwners.delete(householdId);
    }
  }

  private assertActiveKey(): void {
    if (!Number.isInteger(this.activeKeyVersion) || this.activeKeyVersion < 1) {
      throw new Error('Invalid active token key version');
    }
    this.activeKey();
  }

  private activeKey(): string | Uint8Array {
    if (typeof this.keySource === 'string' || this.keySource instanceof Uint8Array) {
      return this.keySource;
    }
    const key = this.keySource[this.activeKeyVersion];
    if (!key) throw new Error('Active token encryption key is unavailable');
    return key;
  }
}

export class SupabaseOAuthStateStore implements OAuthStateStore {
  private readonly rpc: PrivilegedRpcClient;

  constructor(
    supabaseUrl: string,
    serviceRoleKey: string,
    private readonly keySource: DurableKeySource,
    private readonly activeKeyVersion = 1,
    fetcher: typeof fetch = fetch,
  ) {
    this.rpc = createPrivilegedRpcClient(supabaseUrl, serviceRoleKey, fetcher);
    if (!Number.isInteger(activeKeyVersion) || activeKeyVersion < 1) {
      throw new Error('Invalid active token key version');
    }
    if (
      typeof keySource === 'object' &&
      !(keySource instanceof Uint8Array) &&
      !keySource[activeKeyVersion]
    ) {
      throw new Error('Active token encryption key is unavailable');
    }
  }

  async saveState(payload: OAuthStatePayload): Promise<void> {
    const envelope = {
      householdId: payload.householdId,
      userId: payload.userId,
      codeVerifier: payload.codeVerifier,
      expiresAt: payload.expiresAt,
    };
    const encrypted = await encryptTokenPayload(
      JSON.stringify(envelope),
      this.activeKey(),
      this.activeKeyVersion,
    );
    const ciphertext = fromBase64(encrypted.ciphertext);
    const versionPrefix = new Uint8Array(4);
    new DataView(versionPrefix.buffer).setUint32(0, encrypted.keyVersion);
    const versionedCiphertext = new Uint8Array(versionPrefix.length + ciphertext.length);
    versionedCiphertext.set(versionPrefix);
    versionedCiphertext.set(ciphertext, versionPrefix.length);
    await this.rpc.call<boolean>('worker_save_oauth_state', {
      p_state: payload.state,
      p_household_id: payload.householdId,
      p_user_id: payload.userId,
      p_pkce_verifier_ciphertext: toPostgresBytea(versionedCiphertext),
      p_pkce_nonce: toPostgresBytea(fromBase64(encrypted.iv)),
      p_expires_at: new Date(payload.expiresAt).toISOString(),
    });
  }

  async consumeState(state: string): Promise<OAuthStatePayload | null> {
    const rows = await this.rpc.call<readonly StoredOAuthStateRow[]>('worker_consume_oauth_state', {
      p_state: state,
    });
    const row = rows[0];
    if (!row) return null;
    const versionedCiphertext = fromPostgresBytea(row.pkce_verifier_ciphertext);
    if (versionedCiphertext.length <= 20) return null;
    const version = new DataView(
      versionedCiphertext.buffer,
      versionedCiphertext.byteOffset,
      versionedCiphertext.byteLength,
    ).getUint32(0);
    const encrypted = {
      ciphertext: toBase64(versionedCiphertext.slice(4)),
      iv: toBase64(fromPostgresBytea(row.pkce_nonce)),
      keyVersion: version,
    };
    let decoded: unknown;
    try {
      decoded = JSON.parse(await decryptTokenPayload(encrypted, this.keySource));
    } catch {
      throw new Error('Encrypted OAuth state could not be verified');
    }
    const envelope = oauthEnvelopeSchema.safeParse(decoded);
    const expiresAt = Date.parse(row.expires_at);
    if (
      !envelope.success ||
      envelope.data.householdId !== row.household_id ||
      envelope.data.userId !== row.user_id ||
      envelope.data.expiresAt !== expiresAt ||
      expiresAt <= Date.now()
    ) {
      return null;
    }
    return {
      state,
      householdId: row.household_id,
      userId: row.user_id,
      codeVerifier: envelope.data.codeVerifier,
      expiresAt,
    };
  }

  private activeKey(): string | Uint8Array {
    if (typeof this.keySource === 'string' || this.keySource instanceof Uint8Array) {
      return this.keySource;
    }
    const key = this.keySource[this.activeKeyVersion];
    if (!key) throw new Error('Active token encryption key is unavailable');
    return key;
  }
}

function createLeaseOwner(): string {
  return `refresh-${crypto.randomUUID()}`;
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toBase64(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value));
}

function toPostgresBytea(value: Uint8Array): string {
  return `\\x${Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function fromPostgresBytea(value: string): Uint8Array {
  if (!/^\\x(?:[0-9a-f]{2})+$/i.test(value)) throw new Error('Invalid encrypted bytea value');
  const hex = value.slice(2);
  return Uint8Array.from({ length: hex.length / 2 }, (_, index) =>
    Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16),
  );
}
