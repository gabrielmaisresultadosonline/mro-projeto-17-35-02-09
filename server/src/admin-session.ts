import crypto from 'node:crypto';
import type { Request } from 'express';

interface AdminSessionPayload {
  email?: string;
  scope?: string;
  exp?: number;
}

function encodeBase64Url(value: Buffer): string {
  return value.toString('base64url');
}

function decodeBase64Url(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** Mesmo fallback usado em supabase/functions/_shared/mro-admin-credentials.ts. */
const FALLBACK_ADMIN_SESSION_SECRET = 'mro-admin-session-fallback-secret';

/** Emite uma sessão compatível com as Edge Functions administrativas. */
export function createAdminSession(email: string, scope = 'mro-main-admin'): {
  token: string;
  expiresAt: number;
} {
  const secret = process.env.MRO_ADMIN_SESSION_SECRET?.trim() || FALLBACK_ADMIN_SESSION_SECRET;
  const expiresAt = Date.now() + 12 * 60 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ email, scope, exp: expiresAt }), 'utf8');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest();
  return { token: `${encodeBase64Url(payload)}.${encodeBase64Url(signature)}`, expiresAt };
}

/** Valida o mesmo token HMAC emitido pela função lovablack-api. */
export function hasValidAdminSession(req: Request): boolean {
  const secret = process.env.MRO_ADMIN_SESSION_SECRET?.trim() || FALLBACK_ADMIN_SESSION_SECRET;
  const token = req.header('x-admin-token')?.trim();
  if (!token) return false;

  const parts = token.split('.');
  if (parts.length !== 2) return false;

  try {
    const payloadBytes = decodeBase64Url(parts[0]);
    const suppliedSignature = decodeBase64Url(parts[1]);
    const expectedSignature = crypto.createHmac('sha256', secret).update(payloadBytes).digest();
    if (
      suppliedSignature.length !== expectedSignature.length ||
      !crypto.timingSafeEqual(suppliedSignature, expectedSignature)
    ) return false;

    const payload = JSON.parse(payloadBytes.toString('utf8')) as AdminSessionPayload;
    return payload.scope === 'mro-main-admin' &&
      typeof payload.email === 'string' &&
      typeof payload.exp === 'number' &&
      payload.exp >= Date.now();
  } catch {
    return false;
  }
}