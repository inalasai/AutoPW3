import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@autopw3/shared';
import { decryptTokenPayload, encryptTokenPayload } from '../../services/tokens/encryption';
import { base64ToBytea, byteaToBase64 } from '../../services/tokens/postgres-store';
import type { OAuthStatePayload, OAuthStateStore } from './oauth';

async function sha256Bytea(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `\\x${hex}`;
}

/**
 * PostgreSQL-backed durable OAuth state store using Supabase `public.oauth_states`.
 * Protects against CSRF and retains state across multiple Cloudflare Worker PoPs/isolates.
 */
export class PostgresOAuthStateStore implements OAuthStateStore {
  private readonly client: SupabaseClient<Database>;
  private readonly encryptionKey: string;

  constructor(
    supabaseUrl: string,
    supabaseSecretKey: string,
    encryptionKey: string,
    client?: SupabaseClient<Database>,
  ) {
    this.encryptionKey = encryptionKey;
    this.client =
      client ??
      createClient<Database>(supabaseUrl, supabaseSecretKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
  }

  async saveState(payload: OAuthStatePayload): Promise<void> {
    const stateHash = await sha256Bytea(payload.state);
    const encrypted = await encryptTokenPayload(payload.codeVerifier, this.encryptionKey);

    const { error } = await this.client.from('oauth_states').insert({
      state_hash: stateHash,
      household_id: payload.householdId,
      user_id: payload.userId,
      pkce_verifier_ciphertext: base64ToBytea(encrypted.ciphertext),
      pkce_nonce: base64ToBytea(encrypted.iv),
      expires_at: new Date(payload.expiresAt).toISOString(),
    });

    if (error) {
      throw new Error(`Failed to save OAuth state: ${error.message}`);
    }
  }

  async consumeState(state: string): Promise<OAuthStatePayload | null> {
    const stateHash = await sha256Bytea(state);

    const { data, error } = await this.client
      .from('oauth_states')
      .select(
        'id, household_id, user_id, pkce_verifier_ciphertext, pkce_nonce, expires_at, consumed_at',
      )
      .eq('state_hash', stateHash)
      .is('consumed_at', null)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    const expiresAtMs = new Date(data.expires_at).getTime();
    if (Date.now() > expiresAtMs) {
      return null;
    }

    // Mark consumed immediately (single-use invariant)
    await this.client
      .from('oauth_states')
      .update({ consumed_at: new Date().toISOString() })
      .eq('id', data.id);

    try {
      const codeVerifier = await decryptTokenPayload(
        {
          ciphertext: byteaToBase64(data.pkce_verifier_ciphertext),
          iv: byteaToBase64(data.pkce_nonce),
          keyVersion: 1,
        },
        this.encryptionKey,
      );

      return {
        state,
        userId: data.user_id,
        householdId: data.household_id,
        codeVerifier,
        expiresAt: expiresAtMs,
      };
    } catch {
      return null;
    }
  }
}
