/**
 * Guarda única de autorização administrativa das Edge Functions.
 *
 * Motivo: cada painel tinha a sua própria checagem (uns comparavam email/senha
 * no corpo da requisição, outros não checavam nada). Isso causava dois
 * problemas: endpoints privilegiados acessíveis sem sessão e mensagens de
 * "Credenciais inválidas" por divergência entre implementações.
 *
 * Contrato: o painel faz login uma vez, recebe um token HMAC assinado no
 * servidor e passa esse token em `x-admin-token` (ou `admin_token` no corpo).
 * Nenhuma senha volta para o navegador e nenhuma senha trafega novamente.
 */

import { verifyAdminSessionToken } from "./admin-session.ts";
import { resolveMroAdminCredentials } from "./mro-admin-credentials.ts";

/** Escopos emitidos hoje pelos painéis administrativos. */
export const ADMIN_SCOPES = ["mro-main-admin", "instagram-admin"] as const;
export type AdminScope = (typeof ADMIN_SCOPES)[number];

export interface AdminSessionPayload {
  email?: string;
  scope?: string;
  exp?: number;
}

/** Segredos possíveis: o secret dedicado e a service key (usada pelo instagram-admin). */
function candidateSecrets(): string[] {
  const { sessionSecret } = resolveMroAdminCredentials();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  const secrets = [sessionSecret];
  if (serviceKey) secrets.push(serviceKey);
  return secrets.filter((value, index) => value && secrets.indexOf(value) === index);
}

function extractToken(req: Request, body: unknown): string | null {
  const header = req.headers.get("x-admin-token")?.trim();
  if (header) return header;

  if (body && typeof body === "object") {
    const candidate = (body as Record<string, unknown>).admin_token;
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

/**
 * Valida a sessão administrativa. Retorna o payload quando o token é válido
 * para qualquer um dos escopos aceitos; `null` caso contrário.
 */
export async function resolveAdminSession(
  req: Request,
  body: unknown,
  scopes: readonly string[] = ADMIN_SCOPES,
): Promise<AdminSessionPayload | null> {
  const token = extractToken(req, body);
  if (!token) return null;

  for (const secret of candidateSecrets()) {
    for (const scope of scopes) {
      const payload = await verifyAdminSessionToken(token, secret, scope);
      if (payload) return payload as AdminSessionPayload;
    }
  }
  return null;
}

export async function isAdminRequest(
  req: Request,
  body: unknown,
  scopes: readonly string[] = ADMIN_SCOPES,
): Promise<boolean> {
  return (await resolveAdminSession(req, body, scopes)) !== null;
}
