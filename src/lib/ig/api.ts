/**
 * MRO INSTAGRAM (/IG) — camada de acesso ao backend.
 *
 * Toda comunicação passa por Edge Functions. O frontend nunca vê
 * App Secret, access token da Meta, service role key ou senha de admin.
 */
import { supabase } from "@/integrations/supabase/client";
import { IG_OAUTH_REDIRECT_URI } from "@/lib/ig/constants";

export type IgRole = "owner" | "admin" | "manager" | "agent" | "analyst";

export interface IgTenant {
  id: string;
  name: string;
  plan_id: string;
  onboarding_done: boolean;
  is_blocked: boolean;
}

export interface IgAccount {
  id: string;
  tenant_id: string;
  instagram_account_id?: string | null;
  username: string | null;
  name: string | null;
  profile_picture_url: string | null;
  followers_count: number | null;
  media_count: number | null;
  connection_state: "connected" | "needs_reconnect" | "disconnected";
  webhook_subscribed: boolean;
  last_synced_at: string | null;
}

export interface IgPlan {
  id: string;
  name: string;
  price_cents: number;
  max_accounts: number;
  max_automations: number;
  max_messages_month: number;
  max_ai_calls_month: number;
  max_members: number;
  history_days: number;
  features: Record<string, boolean>;
}

export interface IgMe {
  profile: { user_id: string; full_name: string | null; company: string | null; email: string | null } | null;
  memberships: Array<{ tenant_id: string; role: IgRole }>;
  tenants: IgTenant[];
  accounts: IgAccount[];
  plans: IgPlan[];
  is_super_admin: boolean;
}

export interface IgDashboard {
  period_days: number;
  has_account: boolean;
  accounts: Array<Pick<IgAccount, "id" | "username" | "followers_count" | "media_count" | "connection_state" | "last_synced_at">>;
  metrics: Record<string, number | null>;
}

export interface IgConversation {
  id: string;
  participant_id: string;
  participant_username: string | null;
  participant_name: string | null;
  participant_picture_url: string | null;
  last_message_text: string | null;
  last_message_at: string | null;
  last_direction: "in" | "out" | null;
  unread_count: number;
}

export interface IgMessage {
  id: string;
  direction: "in" | "out";
  text: string | null;
  attachments: unknown[];
  sent_at: string;
}

/** Comentário recebido em um post ou Reel. */
export interface IgComment {
  id: string;
  comment_id: string;
  media_id: string | null;
  from_username: string | null;
  text: string | null;
  replied: boolean;
  hidden: boolean;
  commented_at: string | null;
}

export interface IgMedia {
  id: string;
  media_id: string;
  media_type: string | null;
  caption: string | null;
  media_url: string | null;
  thumbnail_url: string | null;
  permalink: string | null;
  like_count: number | null;
  comments_count: number | null;
  published_at: string | null;
}

export type IgMediaType = "IMAGE" | "REELS" | "STORIES";

export interface IgPublication {
  id: string;
  status: "draft" | "publishing" | "published" | "failed";
  media_type: IgMediaType;
  caption: string | null;
  media_url: string | null;
  permalink: string | null;
  last_error: string | null;
  published_at: string | null;
  created_at: string;
}

export interface IgAiSettings {
  tenant_id: string;
  enabled: boolean;
  auto_reply_dm: boolean;
  auto_reply_comments: boolean;
  tone: string;
  business_context: string | null;
  faq: string | null;
  signature: string | null;
  model: string;
}

/** Erro de negócio já traduzido para o usuário final. */
export class IgApiError extends Error {
  readonly code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "IgApiError";
    this.code = code;
  }
}

async function invoke<T>(fn: string, payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body: payload });

  if (error) {
    const fallback = (data as { error?: string } | null)?.error;
    throw new IgApiError(fallback ?? "Não foi possível concluir a operação. Tente novamente.");
  }
  const result = data as { success?: boolean; error?: string; code?: string } & T;
  if (result?.success === false) {
    throw new IgApiError(result.error ?? "Operação não permitida.", result.code);
  }
  return result as T;
}

export const igApi = {
  bootstrap: (input: { full_name?: string; company?: string }) =>
    invoke<{ success: true }>("ig-api", { action: "bootstrap", ...input }),

  me: () => invoke<IgMe>("ig-api", { action: "me" }),

  dashboard: (tenantId: string, period: string) =>
    invoke<IgDashboard>("ig-api", { action: "dashboard", tenant_id: tenantId, period }),

  disconnect: (tenantId: string, accountId: string) =>
    invoke<{ success: true }>("ig-api", { action: "disconnect", tenant_id: tenantId, account_id: accountId }),

  notifications: (tenantId: string) =>
    invoke<{ notifications: Array<{ id: string; type: string; title: string; body: string | null; created_at: string }> }>(
      "ig-api",
      { action: "notifications", tenant_id: tenantId },
    ),

  conversations: (tenantId: string) =>
    invoke<{ conversations: IgConversation[] }>("ig-api", { action: "conversations", tenant_id: tenantId }),

  messages: (tenantId: string, conversationId: string) =>
    invoke<{ messages: IgMessage[] }>("ig-api", {
      action: "messages",
      tenant_id: tenantId,
      conversation_id: conversationId,
    }),

  sendMessage: (tenantId: string, conversationId: string, text: string) =>
    invoke<{ sent_at: string }>("ig-api", {
      action: "send_message",
      tenant_id: tenantId,
      conversation_id: conversationId,
      text,
    }),

  subscribeWebhook: (tenantId: string) =>
    invoke<{
      subscribed: number;
      synced_conversations: number;
      synced_messages: number;
      sync_error: string | null;
    }>("ig-api", { action: "subscribe_webhook", tenant_id: tenantId }),

  comments: (tenantId: string) =>
    invoke<{ comments: IgComment[] }>("ig-api", { action: "comments", tenant_id: tenantId }),

  syncComments: (tenantId: string) =>
    invoke<{ media: number; comments: number }>("ig-api", { action: "sync_comments", tenant_id: tenantId }),

  replyComment: (tenantId: string, commentId: string, text: string) =>
    invoke<{ success: true }>("ig-api", {
      action: "reply_comment",
      tenant_id: tenantId,
      comment_id: commentId,
      text,
    }),

  hideComment: (tenantId: string, commentId: string, hidden: boolean) =>
    invoke<{ hidden: boolean }>("ig-api", {
      action: "hide_comment",
      tenant_id: tenantId,
      comment_id: commentId,
      hidden,
    }),

  content: (tenantId: string) =>
    invoke<{ media: IgMedia[]; publications: IgPublication[] }>("ig-api", {
      action: "content",
      tenant_id: tenantId,
    }),

  publish: (tenantId: string, input: { caption: string; media_url: string; media_type: IgMediaType }) =>
    invoke<{ media_id: string | null }>("ig-api", { action: "publish", tenant_id: tenantId, ...input }),

  aiSettings: (tenantId: string) =>
    invoke<{ settings: IgAiSettings; ai_available: boolean }>("ig-api", {
      action: "ai_settings",
      tenant_id: tenantId,
    }),

  saveAiSettings: (tenantId: string, settings: Partial<IgAiSettings>) =>
    invoke<{ success: true }>("ig-api", { action: "save_ai_settings", tenant_id: tenantId, settings }),

  aiGenerate: (tenantId: string, prompt: string) =>
    invoke<{ reply: string }>("ig-api", { action: "ai_generate", tenant_id: tenantId, prompt }),

  logs: (tenantId: string) =>
    invoke<{
      logs: Array<{ id: string; action: string; actor_type: string; result: string; created_at: string }>;
      jobs: Array<{ id: string; type: string; status: string; attempts: number; last_error: string | null; created_at: string }>;
      events: Array<{ id: string; field: string; status: string; error: string | null; received_at: string }>;
    }>("ig-api", { action: "logs", tenant_id: tenantId }),

  oauthConfig: () => invoke<{ app_id: string; scopes: string }>("ig-oauth", { action: "get-config" }),

  exchangeCode: (input: { code: string; redirect_uri: string; tenant_id: string }) =>
    invoke<{ account: IgAccount }>("ig-oauth", { action: "exchange-code", ...input }),
};


/** URL de callback do OAuth — deve estar cadastrada no App da Meta. */
export const IG_REDIRECT_URI = IG_OAUTH_REDIRECT_URI;

/** Monta a URL de autorização da Meta usando somente dados públicos. */
export function buildInstagramAuthUrl(appId: string, scopes: string, state: string): string {
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: IG_REDIRECT_URI,
    response_type: "code",
    scope: scopes,
    state,
  });
  return `https://www.instagram.com/oauth/authorize?${params.toString()}`;
}
