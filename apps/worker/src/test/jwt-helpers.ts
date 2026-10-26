import * as jose from 'jose';

export interface TestAuthKeys {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}

let cachedKeys: TestAuthKeys | null = null;

export async function getTestAuthKeys(): Promise<TestAuthKeys> {
  if (cachedKeys) return cachedKeys;
  const { publicKey, privateKey } = await jose.generateKeyPair('RS256', { modulusLength: 2048 });
  cachedKeys = { publicKey: publicKey as CryptoKey, privateKey: privateKey as CryptoKey };
  return cachedKeys;
}

export async function createTestJwt(
  claims: {
    userId?: string;
    email?: string;
    role?: string;
    exp?: number;
    iss?: string;
  } = {},
  keys?: TestAuthKeys,
): Promise<string> {
  const { privateKey } = keys ?? (await getTestAuthKeys());
  const now = Math.floor(Date.now() / 1000);

  const jwt = await new jose.SignJWT({
    role: claims.role ?? 'authenticated',
    email: claims.email ?? 'user@example.com',
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject(claims.userId ?? 'demo-admin-user')
    .setIssuer(claims.iss ?? 'https://project.supabase.co/auth/v1')
    .setIssuedAt(now)
    .setExpirationTime(claims.exp ?? now + 3600)
    .sign(privateKey);

  return jwt;
}

export async function createHs256Jwt(
  claims: {
    userId?: string;
    role?: string;
  } = {},
): Promise<string> {
  const secret = new TextEncoder().encode('super-secret-key-12345678901234567890');
  const now = Math.floor(Date.now() / 1000);

  return new jose.SignJWT({
    role: claims.role ?? 'authenticated',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.userId ?? 'demo-admin-user')
    .setIssuer('https://project.supabase.co/auth/v1')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(secret);
}
