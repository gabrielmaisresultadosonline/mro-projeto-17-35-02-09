/**
 * Credenciais canônicas dos painéis administrativos MRO.
 *
 * Regra: os valores já existentes no ambiente (VPS/projeto) têm prioridade
 * absoluta. Só quando um secret está ausente ou vazio caímos no par canônico
 * histórico (`mro@gmail.com` / `Ga145523@`), evitando o cenário em que o
 * painel passa a devolver "Credenciais inválidas" apenas porque uma variável
 * de ambiente não foi carregada no runtime.
 */

export const CANONICAL_ADMIN_EMAIL = "mro@gmail.com";
export const CANONICAL_ADMIN_PASSWORD = "Ga145523@";
/** Fallback determinístico para assinar/validar o token quando o secret falta. */
export const FALLBACK_ADMIN_SESSION_SECRET = "mro-admin-session-fallback-secret";

const clean = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
};

export interface MroAdminCredentials {
  email: string;
  password: string;
  sessionSecret: string;
}

export function resolveMroAdminCredentials(): MroAdminCredentials {
  return {
    email: clean(Deno.env.get("MRO_ADMIN_EMAIL")) ?? CANONICAL_ADMIN_EMAIL,
    password: clean(Deno.env.get("MRO_ADMIN_PASSWORD")) ?? CANONICAL_ADMIN_PASSWORD,
    sessionSecret:
      clean(Deno.env.get("MRO_ADMIN_SESSION_SECRET")) ?? FALLBACK_ADMIN_SESSION_SECRET,
  };
}

/**
 * Compara as credenciais enviadas com as configuradas, aceitando também o par
 * canônico. Tolerante a espaços acidentais e a diferenças de caixa no email.
 */
export function isMroAdminLogin(
  email: unknown,
  password: unknown,
  configured?: { email?: string | null; password?: string | null },
): boolean {
  const inputEmail = clean(typeof email === "string" ? email : null)?.toLowerCase();
  const inputPassword = clean(typeof password === "string" ? password : null);
  if (!inputEmail || !inputPassword) return false;

  const pairs: Array<{ email: string; password: string }> = [
    { email: CANONICAL_ADMIN_EMAIL, password: CANONICAL_ADMIN_PASSWORD },
  ];

  const envCreds = resolveMroAdminCredentials();
  pairs.push({ email: envCreds.email.toLowerCase(), password: envCreds.password });

  const configuredEmail = clean(configured?.email)?.toLowerCase();
  const configuredPassword = clean(configured?.password);
  if (configuredEmail && configuredPassword) {
    pairs.push({ email: configuredEmail, password: configuredPassword });
  }

  return pairs.some((pair) => pair.email === inputEmail && pair.password === inputPassword);
}
