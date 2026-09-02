/**
 * Utilitários de IA de texto compartilhados pelas funções do /instagram.
 *
 * Motivação: as chaves de IA agora são cadastradas pelo painel /admin (aba
 * Tokens, tabela `api_tokens`). Antes cada função lia apenas variáveis de
 * ambiente, então "Gerar legenda" quebrava com 500 mesmo havendo token salvo.
 * Aqui a resolução é única: /admin primeiro, ambiente como fallback.
 *
 * Também centraliza o registro durável de tudo que a IA gera
 * (`public.instagram_ai_generations`), para que estratégias e legendas nunca
 * se perdam se o JSON de sessão do navegador for sobrescrito.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export type TextProvider = "openai" | "deepseek" | "gateway";

export interface ResolvedAiKey {
  key: string;
  provider: TextProvider;
  source: string;
}

function providerFromToken(name: string): TextProvider {
  const n = name.toLowerCase();
  if (n.includes("deepseek")) return "deepseek";
  if (n.includes("openai") || n.includes("chatgpt") || n.includes("gpt")) return "openai";
  return "gateway";
}

function serviceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

/**
 * Resolve a chave de IA de texto disponível.
 * Prioridade: tokens salvos no /admin → variáveis de ambiente.
 */
export async function resolveTextAiKey(): Promise<ResolvedAiKey | null> {
  const candidates = [
    "openai",
    "openai_api_key",
    "chatgpt",
    "gpt",
    "deepseek",
    "deepseek_api_key",
    "lovable",
    "lovable_api_key",
  ];

  try {
    const db = serviceClient();
    if (db) {
      const { data } = await db.from("api_tokens").select("key, value").in("key", candidates);
      if (Array.isArray(data) && data.length > 0) {
        for (const wanted of candidates) {
          const row = data.find(
            (r: { key: string; value: string }) => r.key === wanted && String(r.value ?? "").trim(),
          );
          if (row) {
            return {
              key: String(row.value).trim(),
              provider: providerFromToken(wanted),
              source: `admin:${wanted}`,
            };
          }
        }
      }
    }
  } catch (error) {
    console.error("⚠️ Falha ao ler api_tokens:", (error as Error).message);
  }

  const envOpenai = Deno.env.get("OPENAI_API_KEY");
  if (envOpenai?.trim()) return { key: envOpenai.trim(), provider: "openai", source: "env:OPENAI_API_KEY" };

  const envDeepseek = Deno.env.get("DEEPSEEK_API_KEY");
  if (envDeepseek?.trim()) {
    return { key: envDeepseek.trim(), provider: "deepseek", source: "env:DEEPSEEK_API_KEY" };
  }

  const envGateway = Deno.env.get("LOVABLE_API_KEY");
  if (envGateway?.trim()) return { key: envGateway.trim(), provider: "gateway", source: "env:LOVABLE_API_KEY" };

  return null;
}

const ENDPOINTS: Record<TextProvider, { baseUrl: string; model: string }> = {
  openai: { baseUrl: "https://api.openai.com/v1/chat/completions", model: "gpt-4o-mini" },
  deepseek: { baseUrl: "https://api.deepseek.com/v1/chat/completions", model: "deepseek-chat" },
  gateway: { baseUrl: "https://ai.gateway.lovable.dev/v1/chat/completions", model: "google/gemini-2.5-flash" },
};

/** Chamada OpenAI-compatível para OpenAI/ChatGPT, DeepSeek e gateway. */
export async function callTextAi(opts: {
  auth: ResolvedAiKey;
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {
  const { baseUrl, model } = ENDPOINTS[opts.auth.provider];

  const response = await fetch(baseUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.auth.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: opts.systemPrompt },
        { role: "user", content: opts.userPrompt },
      ],
      temperature: opts.temperature ?? 0.8,
      max_tokens: opts.maxTokens ?? 3000,
    }),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`Provedor ${opts.auth.provider} respondeu ${response.status}: ${detail}`);
  }

  const data = await response.json();
  const content = String(data?.choices?.[0]?.message?.content ?? "").trim();
  if (!content) throw new Error(`Provedor ${opts.auth.provider} retornou resposta vazia`);
  return content;
}

/**
 * Registra a geração da IA no banco. Best-effort: uma falha aqui nunca
 * impede o usuário de receber o conteúdo já gerado.
 */
export async function recordAiGeneration(entry: {
  accountUsername?: string | null;
  profileUsername?: string | null;
  kind: string;
  type?: string | null;
  title?: string | null;
  payload: unknown;
  provider?: string | null;
}): Promise<void> {
  try {
    const db = serviceClient();
    if (!db) return;
    const { error } = await db.from("instagram_ai_generations").insert({
      account_username: entry.accountUsername ?? null,
      profile_username: entry.profileUsername ?? null,
      kind: entry.kind,
      type: entry.type ?? null,
      title: entry.title ?? null,
      payload: entry.payload ?? {},
      provider: entry.provider ?? null,
    });
    if (error) console.error("⚠️ Não foi possível registrar a geração da IA:", error.message);
  } catch (error) {
    console.error("⚠️ Não foi possível registrar a geração da IA:", (error as Error).message);
  }
}
