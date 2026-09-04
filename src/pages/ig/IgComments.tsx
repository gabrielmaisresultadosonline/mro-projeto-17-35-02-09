/**
 * /IG/comments — Comentários reais dos posts e Reels da conta conectada.
 *
 * Os comentários chegam pelo webhook (ig-webhook → ig-worker) e também podem
 * ser importados pela Graph API. Resposta pública e ocultar usam a API oficial.
 */
import { useCallback, useEffect, useState } from "react";
import { EyeOff, MessageSquare, RefreshCcw, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import IgLayout from "@/components/ig/IgLayout";
import IgGuard from "@/components/ig/IgGuard";
import { IgEmpty, IgError, IgLoading } from "@/components/ig/IgStates";
import { igApi, type IgComment } from "@/lib/ig/api";
import { useToast } from "@/hooks/use-toast";
import IgDiagnostics from "@/components/ig/IgDiagnostics";

function formatDate(value: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const IgCommentsContent = ({
  tenantId,
  tenants,
  activeTenantId,
  onTenantChange,
}: {
  tenantId: string;
  tenants: Parameters<typeof IgLayout>[0]["tenants"];
  activeTenantId: string | null;
  onTenantChange: (id: string) => void;
}) => {
  const { toast } = useToast();
  const [comments, setComments] = useState<IgComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await igApi.comments(tenantId);
      setComments(result.comments);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar os comentários.");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Tempo real: comentários gravados pelo worker aparecem sem recarregar.
  useEffect(() => {
    const channel = supabase
      .channel(`ig-comments-${tenantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ig_comments", filter: `tenant_id=eq.${tenantId}` },
        () => {
          void load();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [tenantId, load]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await igApi.syncComments(tenantId);
      toast({
        title: "Importação concluída",
        description: `${result.media} publicação(ões) e ${result.comments} comentário(s) sincronizados.`,
      });
      await load();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Não foi possível importar",
        description: err instanceof Error ? err.message : "Tente novamente.",
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleSuggest = async (comment: IgComment) => {
    setBusyId(comment.id);
    try {
      const result = await igApi.aiGenerate(
        tenantId,
        `Responda publicamente a este comentário do Instagram de @${comment.from_username ?? "seguidor"}: "${comment.text ?? ""}"`,
      );
      setReplyTo(comment.id);
      setDraft(result.reply);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Agente de IA",
        description: err instanceof Error ? err.message : "Tente novamente.",
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleReply = async (comment: IgComment) => {
    const text = draft.trim();
    if (!text) return;
    setBusyId(comment.id);
    try {
      await igApi.replyComment(tenantId, comment.comment_id, text);
      toast({ title: "Resposta publicada", description: "O comentário foi respondido no Instagram." });
      setDraft("");
      setReplyTo(null);
      await load();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Não foi possível responder",
        description: err instanceof Error ? err.message : "Tente novamente.",
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleHide = async (comment: IgComment) => {
    setBusyId(comment.id);
    try {
      const result = await igApi.hideComment(tenantId, comment.comment_id, !comment.hidden);
      toast({ title: result.hidden ? "Comentário oculto" : "Comentário visível novamente" });
      await load();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Não foi possível alterar",
        description: err instanceof Error ? err.message : "Tente novamente.",
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <IgLayout
      title="Comentários"
      description="Comentários recebidos nos seus posts e Reels, com resposta pública pela API oficial."
      tenants={tenants}
      activeTenantId={activeTenantId}
      onTenantChange={onTenantChange}
      actions={
        <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
          <RefreshCcw className="mr-2 h-4 w-4" aria-hidden />
          {syncing ? "Importando..." : "Importar do Instagram"}
        </Button>
      }
    >
      {error ? (
        <IgError message={error} onRetry={load} />
      ) : loading ? (
        <IgLoading label="Carregando comentários..." />
      ) : comments.length === 0 ? (
        <IgEmpty
          title="Nenhum comentário ainda"
          description="Clique em Importar do Instagram para trazer os comentários das últimas publicações. Novos comentários aparecem aqui automaticamente."
          icon={<MessageSquare className="h-6 w-6" aria-hidden />}
        />
      ) : (
        <ul className="space-y-3">
          {comments.map((comment) => (
            <li key={comment.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">@{comment.from_username ?? "seguidor"}</span>
                <span className="text-xs text-muted-foreground">{formatDate(comment.commented_at)}</span>
                {comment.replied ? <Badge variant="secondary">Respondido</Badge> : null}
                {comment.hidden ? <Badge variant="outline">Oculto</Badge> : null}
              </div>

              <p className="mt-2 whitespace-pre-wrap break-words text-sm text-foreground">
                {comment.text ?? "[comentário sem texto]"}
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setReplyTo(replyTo === comment.id ? null : comment.id);
                    setDraft("");
                  }}
                >
                  <Send className="mr-2 h-4 w-4" aria-hidden />
                  Responder
                </Button>
                <Button size="sm" variant="ghost" onClick={() => handleSuggest(comment)} disabled={busyId === comment.id}>
                  <Sparkles className="mr-2 h-4 w-4" aria-hidden />
                  Sugestão da IA
                </Button>
                <Button size="sm" variant="ghost" onClick={() => handleHide(comment)} disabled={busyId === comment.id}>
                  <EyeOff className="mr-2 h-4 w-4" aria-hidden />
                  {comment.hidden ? "Mostrar" : "Ocultar"}
                </Button>
              </div>

              {replyTo === comment.id ? (
                <form
                  className="mt-3 space-y-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleReply(comment);
                  }}
                >
                  <Textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="Escreva a resposta pública..."
                    maxLength={2200}
                    rows={3}
                    aria-label="Resposta ao comentário"
                  />
                  <Button type="submit" size="sm" disabled={busyId === comment.id || !draft.trim()}>
                    {busyId === comment.id ? "Publicando..." : "Publicar resposta"}
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <IgDiagnostics tenantId={tenantId} className="mt-8" />
    </IgLayout>
  );
};

const IgCommentsPage = () => (
  <IgGuard>
    {({ me, activeTenantId, setActiveTenantId }) => {
      const tenantId = activeTenantId ?? me?.tenants[0]?.id ?? null;

      if (!tenantId) {
        return (
          <IgLayout title="Comentários">
            <IgEmpty title="Workspace não encontrado" description="Recarregue a página ou faça login novamente." />
          </IgLayout>
        );
      }

      return (
        <IgCommentsContent
          tenantId={tenantId}
          tenants={me?.tenants ?? []}
          activeTenantId={activeTenantId}
          onTenantChange={setActiveTenantId}
        />
      );
    }}
  </IgGuard>
);

export default IgCommentsPage;
