/**
 * MRO INSTAGRAM (/IG) — API principal do cliente.
 *
 * Ações:
 *  - bootstrap        : garante perfil + tenant (owner) para o usuário autenticado
 *  - me               : perfil, tenants, papel, plano, limites e contas conectadas
 *  - dashboard        : métricas reais do tenant no período (sem números fictícios)
 *  - disconnect       : remove conta do Instagram e seus tokens
 *  - notifications    : leitura das notificações do tenant
 */
import {
  assertTenantMember,
  audit,
  clientIp,
  corsHeaders,
  fail,
  getAuthUser,
  json,
  rateLimit,
  serviceClient,
} from "../_shared/ig-core.ts";

type Action =
  | "bootstrap"
  | "me"
  | "dashboard"
  | "disconnect"
  | "notifications"
  | "conversations"
  | "messages"
  | "send_message"
  | "subscribe_webhook";


const PERIODS: Record<string, number> = { today: 1, "7d": 7, "30d": 30, "90d": 90 };

interface MetaMessage {
  id?: string;
  created_time?: string;
  from?: { id?: string; username?: string; name?: string };
  to?: { data?: Array<{ id?: string; username?: string; name?: string }> };
  message?: string;
  attachments?: { data?: unknown[] };
}

interface MetaConversation {
  id?: string;
  updated_time?: string;
  participants?: { data?: Array<{ id?: string; username?: string; name?: string }> };
  messages?: { data?: MetaMessage[] };
}

/**
 * Importa conversas já existentes pela Conversations API oficial. Isso cobre
 * mensagens enviadas antes da assinatura do webhook e também recupera o Inbox
 * quando a Meta entrega apenas eventos auxiliares, como confirmações de leitura.
 */
async function syncInboxHistory(
  db: ReturnType<typeof serviceClient>,
  tenantId: string,
  account: { id: string; instagram_account_id: string | null; instagram_user_id: string | null },
  accessToken: string,
): Promise<{ conversations: number; messages: number }> {
  const params = new URLSearchParams({
    platform: "instagram",
    fields: "id,updated_time,participants,messages.limit(50){id,created_time,from,to,message,attachments}",
    limit: "50",
    access_token: accessToken,
  });
  const response = await fetch(`https://graph.instagram.com/v21.0/me/conversations?${params.toString()}`);
  const payload = (await response.json().catch(() => ({}))) as {
    data?: MetaConversation[];
    error?: { message?: string; code?: number };
  };

  if (!response.ok || payload.error) {
    const detail = payload.error?.message ?? `HTTP ${response.status}`;
    console.error(`[ig-api] inbox sync failed: ${detail.slice(0, 240)}`);
    throw new Error("Não foi possível sincronizar as conversas do Instagram.");
  }

  const ownIds = new Set(
    [account.instagram_account_id, account.instagram_user_id].filter((value): value is string => Boolean(value)),
  );
  let conversationCount = 0;
  let messageCount = 0;

  for (const conversation of payload.data ?? []) {
    const participants = conversation.participants?.data ?? [];
    const participant = participants.find((item) => item.id && !ownIds.has(String(item.id)));
    const fallbackMessage = conversation.messages?.data?.[0];
    const fallbackSender = fallbackMessage?.from?.id ? String(fallbackMessage.from.id) : null;
    const participantId = participant?.id
      ? String(participant.id)
      : fallbackSender && !ownIds.has(fallbackSender)
        ? fallbackSender
        : null;
    if (!participantId) continue;

    const { data: savedConversation, error: conversationError } = await db
      .from("ig_conversations")
      .upsert(
        {
          tenant_id: tenantId,
          ig_account_id: account.id,
          participant_id: participantId,
          participant_username: participant?.username ?? null,
          participant_name: participant?.name ?? null,
        },
        { onConflict: "ig_account_id,participant_id" },
      )
      .select("id")
      .single();

    if (conversationError || !savedConversation) {
      console.error("[ig-api] conversation sync persist failed:", conversationError?.message ?? "missing row");
      continue;
    }
    conversationCount++;

    const orderedMessages = [...(conversation.messages?.data ?? [])].reverse();
    let latest: { text: string | null; sentAt: string; direction: "in" | "out" } | null = null;

    for (const message of orderedMessages) {
      if (!message.id) continue;
      const senderId = message.from?.id ? String(message.from.id) : null;
      const recipientId = message.to?.data?.[0]?.id ? String(message.to.data[0].id) : null;
      const direction: "in" | "out" = senderId && ownIds.has(senderId) ? "out" : "in";
      const sentAt = message.created_time ?? conversation.updated_time ?? new Date().toISOString();
      const text = message.message ?? null;
      const attachments = message.attachments?.data ?? [];
      const { error: messageError } = await db.from("ig_messages").upsert(
        {
          tenant_id: tenantId,
          conversation_id: savedConversation.id,
          ig_account_id: account.id,
          mid: message.id,
          direction,
          text,
          attachments,
          sender_id: senderId,
          recipient_id: recipientId,
          sent_at: sentAt,
        },
        { onConflict: "mid" },
      );
      if (!messageError) {
        messageCount++;
        latest = { text: text ?? (attachments.length > 0 ? "[anexo]" : null), sentAt, direction };
      }
    }

    if (latest) {
      await db
        .from("ig_conversations")
        .update({
          last_message_text: latest.text,
          last_message_at: latest.sentAt,
          last_direction: latest.direction,
        })
        .eq("id", savedConversation.id);
    }
  }

  return { conversations: conversationCount, messages: messageCount };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const db = serviceClient();

  try {
    const user = await getAuthUser(req);
    if (!user) return fail("Sessão inválida. Faça login novamente.", 401, "unauthenticated");

    const allowed = await rateLimit(db, `ig-api:${user.id}`, 120, 60);
    if (!allowed) return fail("Muitas requisições. Aguarde alguns segundos.", 429, "rate_limited");

    const body = (await req.json().catch(() => ({}))) as {
      action?: Action;
      tenant_id?: string;
      account_id?: string;
      period?: string;
      full_name?: string;
      company?: string;
      conversation_id?: string;
      text?: string;
      comment_id?: string;
      media_id?: string;
      caption?: string;
      media_url?: string;
      media_type?: string;
      settings?: Record<string, unknown>;
      prompt?: string;

    };


    const action = body.action;
    if (!action) return fail("Ação não informada.", 400);

    // ---------------- BOOTSTRAP ----------------
    if (action === "bootstrap") {
      await db.from("ig_profiles").upsert(
        {
          user_id: user.id,
          email: user.email,
          full_name: body.full_name ?? null,
          company: body.company ?? null,
          last_login_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );

      const { data: membership } = await db
        .from("ig_tenant_members")
        .select("tenant_id")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();

      if (!membership) {
        const tenantName = body.company?.trim() || body.full_name?.trim() || user.email || "Meu workspace";
        const { data: tenant, error: tenantError } = await db
          .from("ig_tenants")
          .insert({ name: tenantName, created_by: user.id, plan_id: "solo" })
          .select("id")
          .single();

        if (tenantError || !tenant) return fail("Não foi possível criar seu workspace.", 500);

        await db.from("ig_tenant_members").insert({
          tenant_id: tenant.id,
          user_id: user.id,
          role: "owner",
        });
        await db.from("ig_subscriptions").insert({
          tenant_id: tenant.id,
          plan_id: "solo",
          status: "trialing",
        });
        await db.from("ig_notification_settings").insert({ tenant_id: tenant.id });

        await audit(db, {
          tenant_id: tenant.id,
          actor_user_id: user.id,
          action: "tenant.created",
          ip: clientIp(req),
        });
      }

      return json({ success: true });
    }

    // ---------------- ME ----------------
    if (action === "me") {
      const [{ data: profile }, { data: memberships }] = await Promise.all([
        db.from("ig_profiles").select("*").eq("user_id", user.id).maybeSingle(),
        db.from("ig_tenant_members").select("tenant_id, role").eq("user_id", user.id),
      ]);

      const tenantIds = (memberships ?? []).map((m) => m.tenant_id);

      const [{ data: tenants }, { data: accounts }, { data: superAdmin }] = await Promise.all([
        tenantIds.length
          ? db.from("ig_tenants").select("id, name, plan_id, onboarding_done, is_blocked").in("id", tenantIds)
          : Promise.resolve({ data: [] as unknown[] }),
        tenantIds.length
          ? db
              .from("ig_accounts")
              .select(
                "id, tenant_id, username, name, profile_picture_url, followers_count, media_count, connection_state, last_synced_at, webhook_subscribed, instagram_account_id",
              )
              .in("tenant_id", tenantIds)
              .is("deleted_at", null)
          : Promise.resolve({ data: [] as unknown[] }),
        db.from("ig_super_admins").select("user_id").eq("user_id", user.id).maybeSingle(),
      ]);

      const { data: plans } = await db.from("ig_plans").select("*").eq("is_active", true);

      return json({
        success: true,
        profile: profile ?? null,
        memberships: memberships ?? [],
        tenants: tenants ?? [],
        accounts: accounts ?? [],
        plans: plans ?? [],
        is_super_admin: Boolean(superAdmin),
      });
    }

    // Ações seguintes exigem tenant válido do usuário.
    const tenantId = body.tenant_id;
    if (!tenantId) return fail("Workspace não informado.", 400);
    if (!(await assertTenantMember(db, tenantId, user.id))) {
      return fail("Você não tem acesso a este workspace.", 403, "forbidden");
    }

    // ---------------- DASHBOARD ----------------
    if (action === "dashboard") {
      const days = PERIODS[body.period ?? "30d"] ?? 30;
      const since = new Date(Date.now() - days * 86_400_000).toISOString();

      const [{ data: accounts }, { data: usage }, { count: eventCount }] = await Promise.all([
        db
          .from("ig_accounts")
          .select("id, username, followers_count, media_count, connection_state, last_synced_at")
          .eq("tenant_id", tenantId)
          .is("deleted_at", null),
        db.from("ig_usage").select("metric, value, period_start").eq("tenant_id", tenantId),
        db
          .from("ig_webhook_events")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .gte("received_at", since),
      ]);

      const metrics = Object.fromEntries((usage ?? []).map((u) => [u.metric, Number(u.value)]));

      return json({
        success: true,
        period_days: days,
        has_account: (accounts ?? []).length > 0,
        accounts: accounts ?? [],
        // Somente dados reais. Ausência de dado retorna null → UI mostra "Sem dados disponíveis".
        metrics: {
          followers: accounts?.[0]?.followers_count ?? null,
          media: accounts?.[0]?.media_count ?? null,
          messages_received: metrics.messages_received ?? null,
          messages_sent: metrics.messages_sent ?? null,
          comments_processed: metrics.comments_processed ?? null,
          automations_executed: metrics.automations_executed ?? null,
          leads: metrics.leads ?? null,
          ai_calls: metrics.ai_calls ?? null,
          webhook_events: eventCount ?? 0,
        },
      });
    }

    // ---------------- DISCONNECT ----------------
    if (action === "disconnect") {
      if (!body.account_id) return fail("Conta não informada.", 400);
      if (!(await assertTenantMember(db, tenantId, user.id, ["owner", "admin"]))) {
        return fail("Apenas o proprietário ou administrador pode desconectar contas.", 403);
      }

      await db.from("ig_tokens").delete().eq("ig_account_id", body.account_id).eq("tenant_id", tenantId);
      await db
        .from("ig_accounts")
        .update({ connection_state: "disconnected", is_active: false, deleted_at: new Date().toISOString() })
        .eq("id", body.account_id)
        .eq("tenant_id", tenantId);

      await audit(db, {
        tenant_id: tenantId,
        actor_user_id: user.id,
        action: "instagram.disconnected",
        target: body.account_id,
        ip: clientIp(req),
      });

      return json({ success: true });
    }

    // ---------------- NOTIFICATIONS ----------------
    if (action === "notifications") {
      const { data } = await db
        .from("ig_notifications")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(50);

      return json({ success: true, notifications: data ?? [] });
    }

    // ---------------- INBOX: LISTA DE CONVERSAS ----------------
    if (action === "conversations") {
      const { data } = await db
        .from("ig_conversations")
        .select(
          "id, participant_id, participant_username, participant_name, participant_picture_url, last_message_text, last_message_at, last_direction, unread_count",
        )
        .eq("tenant_id", tenantId)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(100);

      return json({ success: true, conversations: data ?? [] });
    }

    // ---------------- INBOX: MENSAGENS DE UMA CONVERSA ----------------
    if (action === "messages") {
      if (!body.conversation_id) return fail("Conversa não informada.", 400);

      const { data } = await db
        .from("ig_messages")
        .select("id, direction, text, attachments, sent_at")
        .eq("tenant_id", tenantId)
        .eq("conversation_id", body.conversation_id)
        .order("sent_at", { ascending: true })
        .limit(300);

      await db
        .from("ig_conversations")
        .update({ unread_count: 0 })
        .eq("id", body.conversation_id)
        .eq("tenant_id", tenantId);

      return json({ success: true, messages: data ?? [] });
    }

    // ---------------- INBOX: RESPONDER ----------------
    if (action === "send_message") {
      const text = (body.text ?? "").trim();
      if (!body.conversation_id) return fail("Conversa não informada.", 400);
      if (!text) return fail("Escreva uma mensagem antes de enviar.", 400);
      if (text.length > 950) return fail("A mensagem excede o limite do Instagram (950 caracteres).", 400);

      const { data: conversation } = await db
        .from("ig_conversations")
        .select("id, participant_id, ig_account_id")
        .eq("id", body.conversation_id)
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (!conversation) return fail("Conversa não encontrada.", 404);

      const { data: token } = await db
        .from("ig_tokens")
        .select("access_token")
        .eq("ig_account_id", conversation.ig_account_id)
        .maybeSingle();

      if (!token?.access_token) {
        return fail("Conta do Instagram sem autorização válida. Reconecte em Configurações.", 400, "needs_reconnect");
      }

      const res = await fetch("https://graph.instagram.com/v21.0/me/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { id: conversation.participant_id },
          message: { text },
          access_token: token.access_token,
        }),
      });
      const result = await res.json().catch(() => ({}));

      if (!res.ok || result.error) {
        console.error("[ig-api] send_message failed:", JSON.stringify(result).slice(0, 300));
        const metaMessage = (result?.error?.error_user_msg as string | undefined) ?? null;
        return fail(
          metaMessage ??
            "O Instagram não aceitou o envio. Só é possível responder dentro de 24h após a última mensagem do usuário.",
          400,
          "meta_error",
        );
      }

      const sentAt = new Date().toISOString();
      await db.from("ig_messages").insert({
        tenant_id: tenantId,
        conversation_id: conversation.id,
        ig_account_id: conversation.ig_account_id,
        mid: (result.message_id as string | undefined) ?? null,
        direction: "out",
        text,
        sender_id: null,
        recipient_id: conversation.participant_id,
        sent_at: sentAt,
      });

      await db
        .from("ig_conversations")
        .update({ last_message_text: text, last_message_at: sentAt, last_direction: "out", unread_count: 0 })
        .eq("id", conversation.id);

      return json({ success: true, sent_at: sentAt });
    }

    // ---------------- ASSINAR WEBHOOK DA CONTA ----------------
    if (action === "subscribe_webhook") {
      const { data: accounts } = await db
        .from("ig_accounts")
        .select("id, instagram_account_id, instagram_user_id")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null);

      let subscribed = 0;
      let syncedConversations = 0;
      let syncedMessages = 0;
      let syncError: string | null = null;
      for (const account of accounts ?? []) {
        const { data: token } = await db
          .from("ig_tokens")
          .select("access_token")
          .eq("ig_account_id", account.id)
          .maybeSingle();
        if (!token?.access_token) continue;

        const res = await fetch(
          `https://graph.instagram.com/v21.0/me/subscribed_apps?subscribed_fields=messages,comments,live_comments,message_reactions&access_token=${token.access_token}`,
          { method: "POST" },
        );
        const result = await res.json().catch(() => ({}));
        const ok = res.ok && result.success !== false && !result.error;
        if (!ok) console.error("[ig-api] subscribe failed:", JSON.stringify(result).slice(0, 300));
        await db.from("ig_accounts").update({ webhook_subscribed: ok }).eq("id", account.id);
        if (ok) subscribed++;

        try {
          const synced = await syncInboxHistory(db, tenantId, account, token.access_token);
          syncedConversations += synced.conversations;
          syncedMessages += synced.messages;
        } catch (error) {
          syncError = error instanceof Error ? error.message : "Falha ao sincronizar o histórico.";
        }
      }

      return json({
        success: true,
        subscribed,
        synced_conversations: syncedConversations,
        synced_messages: syncedMessages,
        sync_error: syncError,
      });
    }

    // ================= COMENTÁRIOS / CONTEÚDO / IA =================
    // Helper local: conta conectada + token válido do tenant.
    const loadAccount = async () => {
      const { data: account } = await db
        .from("ig_accounts")
        .select("id, instagram_account_id, instagram_user_id, username")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!account) return { account: null, token: null };
      const { data: token } = await db
        .from("ig_tokens")
        .select("access_token")
        .eq("ig_account_id", account.id)
        .maybeSingle();
      return { account, token: (token?.access_token as string | undefined) ?? null };
    };

    const graph = async (path: string, init?: RequestInit) => {
      const res = await fetch(`https://graph.instagram.com/v21.0/${path}`, init);
      const payload = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
        error?: { message?: string; error_user_msg?: string };
      };
      if (!res.ok || payload.error) {
        const detail = payload.error?.error_user_msg ?? payload.error?.message ?? `HTTP ${res.status}`;
        console.error(`[ig-api] graph ${path.split("?")[0]} failed: ${String(detail).slice(0, 240)}`);
        throw new Error(String(detail));
      }
      return payload;
    };

    // ---------------- LISTA DE COMENTÁRIOS ----------------
    if (action === "comments") {
      const { data } = await db
        .from("ig_comments")
        .select("id, comment_id, media_id, from_username, text, replied, hidden, commented_at")
        .eq("tenant_id", tenantId)
        .eq("is_own", false)
        .order("commented_at", { ascending: false, nullsFirst: false })
        .limit(200);
      return json({ success: true, comments: data ?? [] });
    }

    // ---------------- SINCRONIZAR COMENTÁRIOS DAS ÚLTIMAS MÍDIAS ----------------
    if (action === "sync_comments") {
      const { account, token } = await loadAccount();
      if (!account || !token) {
        return fail("Conecte uma conta do Instagram em Configurações.", 400, "needs_connection");
      }

      const media = (await graph(
        `me/media?fields=id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,like_count,comments_count,timestamp&limit=25&access_token=${token}`,
      )) as { data?: Array<Record<string, unknown>> };

      let savedMedia = 0;
      let savedComments = 0;
      const ownIds = new Set(
        [account.instagram_account_id, account.instagram_user_id].filter((v): v is string => Boolean(v)),
      );

      for (const item of media.data ?? []) {
        const mediaId = String(item.id ?? "");
        if (!mediaId) continue;
        await db.from("ig_media").upsert(
          {
            tenant_id: tenantId,
            ig_account_id: account.id,
            media_id: mediaId,
            media_type: (item.media_type as string) ?? null,
            media_product_type: (item.media_product_type as string) ?? null,
            caption: (item.caption as string) ?? null,
            media_url: (item.media_url as string) ?? null,
            thumbnail_url: (item.thumbnail_url as string) ?? null,
            permalink: (item.permalink as string) ?? null,
            like_count: (item.like_count as number) ?? null,
            comments_count: (item.comments_count as number) ?? null,
            published_at: (item.timestamp as string) ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "media_id" },
        );
        savedMedia++;

        try {
          const comments = (await graph(
            `${mediaId}/comments?fields=id,text,username,timestamp,from,parent_id&limit=50&access_token=${token}`,
          )) as { data?: Array<Record<string, unknown>> };

          for (const comment of comments.data ?? []) {
            const commentId = String(comment.id ?? "");
            if (!commentId) continue;
            const fromId = (comment.from as { id?: string } | undefined)?.id ?? null;
            const username =
              (comment.username as string | undefined) ??
              (comment.from as { username?: string } | undefined)?.username ??
              null;
            await db.from("ig_comments").upsert(
              {
                tenant_id: tenantId,
                ig_account_id: account.id,
                comment_id: commentId,
                media_id: mediaId,
                parent_comment_id: (comment.parent_id as string) ?? null,
                from_id: fromId,
                from_username: username,
                text: (comment.text as string) ?? null,
                is_own: Boolean(fromId && ownIds.has(String(fromId))),
                commented_at: (comment.timestamp as string) ?? null,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "comment_id" },
            );
            savedComments++;
          }
        } catch (error) {
          console.error(`[ig-api] comments sync media ${mediaId}:`, (error as Error).message);
        }
      }

      await audit(db, { tenant_id: tenantId, actor_user_id: user.id, action: "comments.synced" });
      return json({ success: true, media: savedMedia, comments: savedComments });
    }

    // ---------------- RESPONDER COMENTÁRIO ----------------
    if (action === "reply_comment") {
      const text = (body.text ?? "").trim();
      if (!body.comment_id) return fail("Comentário não informado.", 400);
      if (!text) return fail("Escreva a resposta antes de enviar.", 400);
      if (text.length > 2200) return fail("A resposta excede o limite do Instagram.", 400);

      const { token } = await loadAccount();
      if (!token) return fail("Conta do Instagram sem autorização válida. Reconecte em Configurações.", 400, "needs_reconnect");

      try {
        await graph(`${body.comment_id}/replies`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ message: text, access_token: token }),
        });
      } catch (error) {
        return fail((error as Error).message, 400, "meta_error");
      }

      await db
        .from("ig_comments")
        .update({ replied: true, updated_at: new Date().toISOString() })
        .eq("tenant_id", tenantId)
        .eq("comment_id", body.comment_id);

      await audit(db, { tenant_id: tenantId, actor_user_id: user.id, action: "comment.replied" });
      return json({ success: true });
    }

    // ---------------- OCULTAR / MOSTRAR COMENTÁRIO ----------------
    if (action === "hide_comment") {
      if (!body.comment_id) return fail("Comentário não informado.", 400);
      const hide = body.blocked !== false;
      const { token } = await loadAccount();
      if (!token) return fail("Conta do Instagram sem autorização válida.", 400, "needs_reconnect");

      try {
        await graph(`${body.comment_id}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ hide: String(hide), access_token: token }),
        });
      } catch (error) {
        return fail((error as Error).message, 400, "meta_error");
      }

      await db
        .from("ig_comments")
        .update({ hidden: hide, updated_at: new Date().toISOString() })
        .eq("tenant_id", tenantId)
        .eq("comment_id", body.comment_id);

      return json({ success: true, hidden: hide });
    }

    // ---------------- CONTEÚDO: MÍDIAS E PUBLICAÇÕES ----------------
    if (action === "content") {
      const [{ data: media }, { data: publications }] = await Promise.all([
        db
          .from("ig_media")
          .select("id, media_id, media_type, caption, media_url, thumbnail_url, permalink, like_count, comments_count, published_at")
          .eq("tenant_id", tenantId)
          .order("published_at", { ascending: false, nullsFirst: false })
          .limit(60),
        db
          .from("ig_publications")
          .select("id, status, media_type, caption, media_url, permalink, last_error, published_at, created_at")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false })
          .limit(40),
      ]);
      return json({ success: true, media: media ?? [], publications: publications ?? [] });
    }

    // ---------------- PUBLICAR NO INSTAGRAM ----------------
    if (action === "publish") {
      const caption = (body.caption ?? "").trim();
      const mediaUrl = (body.media_url ?? "").trim();
      const mediaType = body.media_type === "REELS" || body.media_type === "STORIES" ? body.media_type : "IMAGE";

      if (!/^https:\/\/.+/i.test(mediaUrl)) return fail("Informe o link https público da imagem ou vídeo.", 400);
      if (caption.length > 2200) return fail("A legenda excede 2200 caracteres.", 400);

      const { account, token } = await loadAccount();
      if (!account || !token) return fail("Conecte uma conta do Instagram em Configurações.", 400, "needs_connection");

      const { data: publication } = await db
        .from("ig_publications")
        .insert({
          tenant_id: tenantId,
          ig_account_id: account.id,
          status: "publishing",
          media_type: mediaType,
          caption: caption || null,
          media_url: mediaUrl,
          created_by: user.id,
        })
        .select("id")
        .single();

      try {
        const containerParams = new URLSearchParams({ caption, access_token: token });
        if (mediaType === "IMAGE") containerParams.set("image_url", mediaUrl);
        else {
          containerParams.set("video_url", mediaUrl);
          containerParams.set("media_type", mediaType);
        }

        const container = (await graph("me/media", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: containerParams,
        })) as { id?: string };

        if (!container.id) throw new Error("O Instagram não devolveu o identificador da publicação.");

        const published = (await graph("me/media_publish", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ creation_id: container.id, access_token: token }),
        })) as { id?: string };

        await db
          .from("ig_publications")
          .update({
            status: "published",
            container_id: container.id,
            published_media_id: published.id ?? null,
            published_at: new Date().toISOString(),
            last_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", publication?.id ?? "");

        await audit(db, { tenant_id: tenantId, actor_user_id: user.id, action: "content.published" });
        return json({ success: true, media_id: published.id ?? null });
      } catch (error) {
        const message = (error as Error).message.slice(0, 400);
        await db
          .from("ig_publications")
          .update({ status: "failed", last_error: message, updated_at: new Date().toISOString() })
          .eq("id", publication?.id ?? "");
        console.error("[ig-api] publish failed:", message);
        return fail(message, 400, "meta_error");
      }
    }

    // ---------------- AGENTE DE IA: CONFIGURAÇÃO ----------------
    if (action === "ai_settings") {
      const { data } = await db.from("ig_ai_settings").select("*").eq("tenant_id", tenantId).maybeSingle();
      return json({
        success: true,
        settings:
          data ?? {
            tenant_id: tenantId,
            enabled: false,
            auto_reply_dm: false,
            auto_reply_comments: false,
            tone: "profissional e acolhedor",
            business_context: null,
            faq: null,
            signature: null,
            model: "google/gemini-2.5-flash",
          },
        ai_available: Boolean(Deno.env.get("LOVABLE_API_KEY")),
      });
    }

    if (action === "save_ai_settings") {
      const input = (body.settings ?? {}) as Record<string, unknown>;
      const limited = (value: unknown, max: number) =>
        typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;

      const { error } = await db.from("ig_ai_settings").upsert(
        {
          tenant_id: tenantId,
          enabled: Boolean(input.enabled),
          auto_reply_dm: Boolean(input.auto_reply_dm),
          auto_reply_comments: Boolean(input.auto_reply_comments),
          tone: limited(input.tone, 120) ?? "profissional e acolhedor",
          business_context: limited(input.business_context, 4000),
          faq: limited(input.faq, 8000),
          signature: limited(input.signature, 200),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id" },
      );

      if (error) {
        console.error("[ig-api] save_ai_settings failed:", error.message);
        return fail("Não foi possível salvar a configuração do agente.", 500);
      }
      await audit(db, { tenant_id: tenantId, actor_user_id: user.id, action: "ai.settings_saved" });
      return json({ success: true });
    }

    // ---------------- AGENTE DE IA: GERAR RESPOSTA ----------------
    if (action === "ai_generate") {
      const prompt = (body.prompt ?? "").trim();
      if (!prompt) return fail("Escreva a mensagem ou o comentário para o agente responder.", 400);
      if (prompt.length > 4000) return fail("Texto muito longo para o agente.", 400);

      const apiKey = Deno.env.get("LOVABLE_API_KEY");
      if (!apiKey) return fail("Agente de IA ainda não habilitado neste ambiente.", 503, "ai_unavailable");

      const { data: settings } = await db.from("ig_ai_settings").select("*").eq("tenant_id", tenantId).maybeSingle();

      const system = [
        "Você é o atendente virtual de um perfil profissional do Instagram.",
        `Tom de voz: ${settings?.tone ?? "profissional e acolhedor"}.`,
        settings?.business_context ? `Contexto do negócio: ${settings.business_context}` : null,
        settings?.faq ? `Perguntas frequentes e respostas oficiais: ${settings.faq}` : null,
        "Responda em português do Brasil, no máximo 700 caracteres, sem inventar preços, prazos ou dados que não estejam no contexto.",
        settings?.signature ? `Finalize com: ${settings.signature}` : null,
      ]
        .filter(Boolean)
        .join("\n");

      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: settings?.model ?? "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: system },
            { role: "user", content: prompt },
          ],
        }),
      });

      if (res.status === 429) return fail("Limite de uso da IA atingido. Tente novamente em instantes.", 429, "rate_limited");
      if (res.status === 402) return fail("Créditos de IA esgotados no workspace.", 402, "no_credits");

      const payload = (await res.json().catch(() => ({}))) as {
        choices?: Array<{ message?: { content?: string } }>;
        error?: { message?: string };
      };

      if (!res.ok) {
        console.error("[ig-api] ai_generate failed:", (payload.error?.message ?? `HTTP ${res.status}`).slice(0, 200));
        return fail("O agente de IA não conseguiu responder agora.", 502, "ai_error");
      }

      const reply = payload.choices?.[0]?.message?.content?.trim() ?? "";
      if (!reply) return fail("O agente de IA não retornou texto.", 502, "ai_empty");

      const period = new Date(new Date().setUTCDate(1)).toISOString().slice(0, 10);
      const { data: usageRow } = await db
        .from("ig_usage")
        .select("id, value")
        .eq("tenant_id", tenantId)
        .eq("metric", "ai_calls")
        .eq("period_start", period)
        .maybeSingle();

      if (usageRow) {
        await db
          .from("ig_usage")
          .update({ value: Number(usageRow.value) + 1, updated_at: new Date().toISOString() })
          .eq("id", usageRow.id);
      } else {
        await db.from("ig_usage").insert({ tenant_id: tenantId, metric: "ai_calls", period_start: period, value: 1 });
      }


      return json({ success: true, reply });
    }

    // ---------------- LOGS/DIAGNÓSTICO DO WORKSPACE ----------------
    if (action === "logs") {
      const [{ data: logs }, { data: jobs }, { data: events }] = await Promise.all([
        db
          .from("ig_audit_logs")
          .select("id, action, actor_type, result, created_at")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false })
          .limit(50),
        db
          .from("ig_jobs")
          .select("id, type, status, attempts, last_error, created_at")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false })
          .limit(30),
        db
          .from("ig_webhook_events")
          .select("id, field, status, error, received_at")
          .eq("tenant_id", tenantId)
          .order("received_at", { ascending: false })
          .limit(30),
      ]);
      return json({ success: true, logs: logs ?? [], jobs: jobs ?? [], events: events ?? [] });
    }

    return fail("Ação não reconhecida.", 400);


  } catch (error) {
    console.error("[ig-api] unexpected error:", (error as Error).message);
    return fail("Erro interno. Tente novamente em instantes.", 500);
  }
});
