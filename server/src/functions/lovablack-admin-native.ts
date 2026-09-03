import crypto from "node:crypto";
import type { Request, Response } from "express";
import { createAdminSession } from "../admin-session.js";
import { adminQuery } from "../db.js";

interface AdminLoginBody {
  action?: unknown;
  email?: unknown;
  password?: unknown;
}

interface AdminCredentialsRow {
  admin_email: string | null;
  admin_password: string | null;
}

function parseBody(body: unknown): AdminLoginBody | null {
  try {
    if (Buffer.isBuffer(body)) return JSON.parse(body.toString("utf8")) as AdminLoginBody;
    if (typeof body === "string") return JSON.parse(body) as AdminLoginBody;
    if (body && typeof body === "object") return body as AdminLoginBody;
    return null;
  } catch {
    return null;
  }
}

function safeEqual(left: string, right: string): boolean {
  const leftHash = crypto.createHash("sha256").update(left).digest();
  const rightHash = crypto.createHash("sha256").update(right).digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
}

function matchesCredentials(
  email: string,
  password: string,
  candidateEmail: string | null | undefined,
  candidatePassword: string | null | undefined,
): boolean {
  const expectedEmail = candidateEmail?.trim().toLowerCase();
  const expectedPassword = candidatePassword?.trim();
  return Boolean(
    expectedEmail && expectedPassword &&
    safeEqual(email, expectedEmail) && safeEqual(password, expectedPassword),
  );
}

/**
 * Atende somente admin_login sem iniciar uma função Deno. As demais ações de
 * lovablack-api continuam no host original. Isso impede que uma falha de cold
 * start derrube justamente o acesso aos painéis administrativos.
 */
export async function handleNativeLovablackAdminLogin(req: Request, res: Response): Promise<boolean> {
  if (req.method !== "POST") return false;
  const body = parseBody(req.body);
  if (body?.action !== "admin_login") return false;

  const requestId = crypto.randomUUID();
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password.trim() : "";
  if (!email || !password || email.length > 255 || password.length > 255) {
    console.warn(`[admin-login:${requestId}] entrada inválida`);
    res.status(400).json({ success: false, error: "Credenciais inválidas", request_id: requestId });
    return true;
  }

  let configured: AdminCredentialsRow | undefined;
  try {
    const rows = await adminQuery<AdminCredentialsRow>(
      "SELECT admin_email, admin_password FROM public.license_settings LIMIT 1",
    );
    configured = rows[0];
  } catch (error) {
    const message = error instanceof Error ? error.message : "erro desconhecido";
    console.error(`[admin-login:${requestId}] falha ao consultar license_settings: ${message}`);
  }

  const envMatch = matchesCredentials(
    email,
    password,
    process.env.MRO_ADMIN_EMAIL,
    process.env.MRO_ADMIN_PASSWORD,
  );
  const databaseMatch = matchesCredentials(
    email,
    password,
    configured?.admin_email,
    configured?.admin_password,
  );

  if (!envMatch && !databaseMatch) {
    console.warn(`[admin-login:${requestId}] credenciais recusadas; fontes verificadas: ambiente,banco`);
    res.status(401).json({ success: false, error: "Credenciais inválidas", request_id: requestId });
    return true;
  }

  const session = createAdminSession(email);
  console.info(`[admin-login:${requestId}] sessão emitida; fonte=${databaseMatch ? "banco" : "ambiente"}`);
  res.status(200).json({ success: true, token: session.token, expires_at: session.expiresAt });
  return true;
}