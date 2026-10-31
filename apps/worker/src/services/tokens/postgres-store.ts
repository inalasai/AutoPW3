import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@autopw3/shared';
import { decryptTokenPayload, encryptTokenPayload } from './encryption';
import type { DecryptedTokens, TokenStore } from './store';

export function base64ToBytea(base64: string): string {
  const bin = atob(base64);
  let hex = '\\x';
  for (let i = 0; i < bin.length; i++) {
    hex += bin.charCodeAt(i).toString(16).padStart(2, '0');
  }
  return hex;
}

export function byteaToBase64(bytea: string): string {
  const hex = bytea.startsWith('\\x') ? bytea.substring(2) : bytea;
  let bin = '';
  for (let i = 0; i < hex.length; i += 2) {
    bin += String.fromCharCode(parseInt(hex.substring(i, i + 2), 16));
  }
  return btoa(bin);
}

/**
 * PostgreSQL-backed durable token store using Supabase `public.tesla_credentials`.
 * Tokens are encrypted at rest with AES-256-GCM.
 */
export class PostgresTokenStore implements TokenStore {
  private readonly client: SupabaseClient<Database>;
  private readonly encryptionKey: string;
  private readonly keyVersion: number;

  constructor(
    supabaseUrl: string,
    supabaseSecretKey: string,
    encryptionKey: string,
    keyVersion = 1,
    client?: SupabaseClient<Database>,
  ) {
    this.encryptionKey = encryptionKey;
    this.keyVersion = keyVersion;
    this.client =
      client ??
      createClient<Database>(supabaseUrl, supabaseSecretKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
  }

  async saveTokens(householdId: string, tokens: DecryptedTokens): Promise<void> {
    const plaintext = JSON.stringify(tokens);
    const encrypted = await encryptTokenPayload(plaintext, this.encryptionKey, this.keyVersion);

    const nonceBytea = base64ToBytea(encrypted.iv);
    const ciphertextBytea = base64ToBytea(encrypted.ciphertext);

    const { error } = await this.client.from('tesla_credentials').upsert(
      {
        household_id: householdId,
        key_id: `v${this.keyVersion}`,
        nonce: nonceBytea,
        ciphertext: ciphertextBytea,
        version: this.keyVersion,
        scopes: tokens.scope ? tokens.scope.split(' ') : [],
        fleet_api_base_url: tokens.regionBaseUrl || 'https://fleet-api.prd.na.vn.cloud.tesla.com',
        status: 'ACTIVE',
        access_expires_at: new Date(tokens.expiresAt * 1000).toISOString(),
        last_refresh_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'household_id' },
    );

    if (error) {
      throw new Error(`Failed to persist tokens: ${error.message}`);
    }
  }

  async getTokens(householdId: string): Promise<DecryptedTokens | null> {
    const { data, error } = await this.client
      .from('tesla_credentials')
      .select('ciphertext, nonce, version, status')
      .eq('household_id', householdId)
      .eq('status', 'ACTIVE')
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    try {
      const plaintext = await decryptTokenPayload(
        {
          ciphertext: byteaToBase64(data.ciphertext),
          iv: byteaToBase64(data.nonce),
          keyVersion: data.version,
        },
        this.encryptionKey,
      );

      return JSON.parse(plaintext) as DecryptedTokens;
    } catch {
      return null;
    }
  }

  async deleteTokens(householdId: string): Promise<void> {
    await this.client.from('tesla_credentials').delete().eq('household_id', householdId);
  }

  async acquireRefreshLock(householdId: string, ttlMs = 15_000): Promise<boolean> {
    try {
      // Try atomic lease via job_locks
      const now = new Date();
      const expiresAt = new Date(now.getTime() + ttlMs).toISOString();

      const { data: existing } = await this.client
        .from('job_locks')
        .select('key, lease_expires_at')
        .eq('key', `token:${householdId}`)
        .maybeSingle();

      if (existing && new Date(existing.lease_expires_at) > now) {
        return false;
      }

      const { error } = await this.client.from('job_locks').upsert({
        key: `token:${householdId}`,
        owner: 'worker',
        lease_expires_at: expiresAt,
      });

      return !error;
    } catch {
      return true;
    }
  }

  async releaseRefreshLock(householdId: string): Promise<void> {
    try {
      await this.client.from('job_locks').delete().eq('key', `token:${householdId}`);
    } catch {
      // Ignore cleanup error
    }
  }
}
