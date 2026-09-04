/**
 * /IG/content — Publicação real via Content Publishing API + histórico de posts.
 *
 * Só usa dados reais: mídias importadas da conta conectada e publicações
 * criadas por aqui, com status e mensagem de erro devolvida pela Meta.
 */
import { useCallback, useEffect, useState } from "react";
import { CalendarDays, RefreshCcw, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import IgLayout from "@/components/ig/IgLayout";
import IgGuard from "@/components/ig/IgGuard";
import IgDiagnostics from "@/components/ig/IgDiagnostics";
import { IgEmpty, IgError, IgLoading } from "@/components/ig/IgStates";
import { igApi, type IgMedia, type IgMediaType, type IgPublication } from "@/lib/ig/api";
import { useToast } from "@/hooks/use-toast";

function formatDate(value: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_LABEL: Record<IgPublication["status"], string> = {
  draft: "Rascunho",
  publishing: "Publicando",
  published: "Publicado",
  failed: "Falhou",
};

const IgContentInner = ({
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
  const [media, setMedia] = useState<IgMedia[]>([]);
  const [publications, setPublications] = useState<IgPublication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaType, setMediaType] = useState<IgMediaType>("IMAGE");
  const [publishing, setPublishing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [suggesting, setSuggesting] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await igApi.content(tenantId);
      setMedia(result.media);
      setPublications(result.publications);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar o conteúdo.");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleImport = async () => {
    setImporting(true);
    try {
      const result = await igApi.syncComments(tenantId);
      toast({ title: "Publicações importadas", description: `${result.media} publicação(ões) atualizadas.` });
      await load();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Não foi possível importar",
        description: err instanceof Error ? err.message : "Tente novamente.",
      });
    } finally {
      setImporting(false);
    }
  };

  const handleSuggestCaption = async () => {
    setSuggesting(true);
    try {
      const result = await igApi.aiGenerate(
        tenantId,
        `Escreva uma legenda para um post no Instagram sobre: ${caption || "o meu negócio"}. Use no máximo 500 caracteres e inclua uma chamada para ação.`,
      );
      setCaption(result.reply);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Agente de IA",
        description: err instanceof Error ? err.message : "Tente novamente.",
      });
    } finally {
      setSuggesting(false);
    }
  };

  const handlePublish = async () => {
    setPublishing(true);
    try {
      await igApi.publish(tenantId, { caption, media_url: mediaUrl.trim(), media_type: mediaType });
      toast({ title: "Publicado", description: "A publicação foi enviada ao Instagram." });
      setCaption("");
      setMediaUrl("");
      await load();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Não foi possível publicar",
        description: err instanceof Error ? err.message : "Tente novamente.",
      });
      await load();
    } finally {
      setPublishing(false);
    }
  };

  return (
    <IgLayout
      title="Conteúdo"
      description="Publique na conta conectada e acompanhe as publicações reais do perfil."
      tenants={tenants}
      activeTenantId={activeTenantId}
      onTenantChange={onTenantChange}
      actions={
        <Button variant="outline" size="sm" onClick={handleImport} disabled={importing}>
          <RefreshCcw className="mr-2 h-4 w-4" aria-hidden />
          {importing ? "Importando..." : "Importar publicações"}
        </Button>
      }
    >
      <form
        className="rounded-xl border border-border bg-card p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void handlePublish();
        }}
      >
        <h2 className="text-sm font-bold">Nova publicação</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          O Instagram exige um link público (https) da imagem ou do vídeo já hospedado.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="md:col-span-2">
            <Label htmlFor="ig-media-url">Link da mídia</Label>
            <Input
              id="ig-media-url"
              value={mediaUrl}
              onChange={(event) => setMediaUrl(event.target.value)}
              placeholder="https://..."
              inputMode="url"
              required
            />
          </div>
          <div>
            <Label htmlFor="ig-media-type">Formato</Label>
            <Select value={mediaType} onValueChange={(value) => setMediaType(value as IgMediaType)}>
              <SelectTrigger id="ig-media-type">
                <SelectValue placeholder="Formato" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="IMAGE">Imagem no feed</SelectItem>
                <SelectItem value="REELS">Reels</SelectItem>
                <SelectItem value="STORIES">Stories</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-4">
          <Label htmlFor="ig-caption">Legenda</Label>
          <Textarea
            id="ig-caption"
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            rows={4}
            maxLength={2200}
            placeholder="Escreva a legenda do post..."
          />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="submit" disabled={publishing || !mediaUrl.trim()}>
            <Send className="mr-2 h-4 w-4" aria-hidden />
            {publishing ? "Publicando..." : "Publicar agora"}
          </Button>
          <Button type="button" variant="ghost" onClick={handleSuggestCaption} disabled={suggesting}>
            <Sparkles className="mr-2 h-4 w-4" aria-hidden />
            {suggesting ? "Gerando..." : "Legenda com IA"}
          </Button>
        </div>
      </form>

      <section className="mt-8" aria-label="Publicações enviadas pelo painel">
        <h2 className="mb-3 text-sm font-bold">Envios feitos por aqui</h2>
        {publications.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum envio registrado ainda.</p>
        ) : (
          <ul className="space-y-2">
            {publications.map((publication) => (
              <li key={publication.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={publication.status === "failed" ? "destructive" : "secondary"}>
                    {STATUS_LABEL[publication.status]}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(publication.published_at ?? publication.created_at)}
                  </span>
                  <span className="text-xs text-muted-foreground">{publication.media_type}</span>
                </div>
                {publication.caption ? (
                  <p className="mt-2 line-clamp-2 text-sm">{publication.caption}</p>
                ) : null}
                {publication.last_error ? (
                  <p className="mt-2 text-sm text-destructive">{publication.last_error}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8" aria-label="Publicações do perfil">
        <h2 className="mb-3 text-sm font-bold">Publicações do perfil</h2>
        {error ? (
          <IgError message={error} onRetry={load} />
        ) : loading ? (
          <IgLoading label="Carregando publicações..." />
        ) : media.length === 0 ? (
          <IgEmpty
            title="Nenhuma publicação importada"
            description="Clique em Importar publicações para trazer os posts e Reels da conta conectada."
            icon={<CalendarDays className="h-6 w-6" aria-hidden />}
          />
        ) : (
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {media.map((item) => (
              <li key={item.id} className="overflow-hidden rounded-xl border border-border bg-card">
                {item.thumbnail_url || item.media_url ? (
                  <img
                    src={item.thumbnail_url ?? item.media_url ?? ""}
                    alt={item.caption ? item.caption.slice(0, 80) : "Publicação do Instagram"}
                    loading="lazy"
                    width={480}
                    height={480}
                    className="h-48 w-full object-cover"
                  />
                ) : null}
                <div className="p-4">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{item.media_type ?? "POST"}</span>
                    <span>{formatDate(item.published_at)}</span>
                  </div>
                  {item.caption ? <p className="mt-2 line-clamp-3 text-sm">{item.caption}</p> : null}
                  <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
                    <span>{item.like_count ?? 0} curtidas</span>
                    <span>{item.comments_count ?? 0} comentários</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <IgDiagnostics tenantId={tenantId} className="mt-8" />
    </IgLayout>
  );
};

const IgContentPage = () => (
  <IgGuard>
    {({ me, activeTenantId, setActiveTenantId }) => {
      const tenantId = activeTenantId ?? me?.tenants[0]?.id ?? null;

      if (!tenantId) {
        return (
          <IgLayout title="Conteúdo">
            <IgEmpty title="Workspace não encontrado" description="Recarregue a página ou faça login novamente." />
          </IgLayout>
        );
      }

      return (
        <IgContentInner
          tenantId={tenantId}
          tenants={me?.tenants ?? []}
          activeTenantId={activeTenantId}
          onTenantChange={setActiveTenantId}
        />
      );
    }}
  </IgGuard>
);

export default IgContentPage;
