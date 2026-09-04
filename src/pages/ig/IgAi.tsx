/**
 * /IG/ai — Agente de IA: contexto do negócio, tom, respostas automáticas e teste.
 */
import { useCallback, useEffect, useState } from "react";
import { Bot, Save, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import IgLayout from "@/components/ig/IgLayout";
import IgGuard from "@/components/ig/IgGuard";
import IgDiagnostics from "@/components/ig/IgDiagnostics";
import { IgEmpty, IgError, IgLoading } from "@/components/ig/IgStates";
import { igApi, type IgAiSettings } from "@/lib/ig/api";
import { useToast } from "@/hooks/use-toast";

const IgAiInner = ({
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
  const [settings, setSettings] = useState<IgAiSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [reply, setReply] = useState("");
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await igApi.aiSettings(tenantId);
      setSettings(result.settings);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar as configurações da IA.");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const update = (patch: Partial<IgAiSettings>) => {
    setSettings((current) => (current ? { ...current, ...patch } : current));
  };

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      await igApi.saveAiSettings(tenantId, {
        enabled: settings.enabled,
        auto_reply_dm: settings.auto_reply_dm,
        auto_reply_comments: settings.auto_reply_comments,
        tone: settings.tone,
        business_context: settings.business_context,
        faq: settings.faq,
        signature: settings.signature,
      });
      toast({ title: "Configurações salvas", description: "O agente já usa essas informações." });
      await load();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Não foi possível salvar",
        description: err instanceof Error ? err.message : "Tente novamente.",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const result = await igApi.aiGenerate(tenantId, prompt.trim() || "Olá, vocês entregam hoje?");
      setReply(result.reply);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Agente de IA",
        description: err instanceof Error ? err.message : "Tente novamente.",
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <IgLayout
      title="Agente de IA"
      description="Ensine o agente sobre o seu negócio e teste as respostas antes de ativar."
      tenants={tenants}
      activeTenantId={activeTenantId}
      onTenantChange={onTenantChange}
    >
      {error ? (
        <IgError message={error} onRetry={load} />
      ) : loading ? (
        <IgLoading label="Carregando configurações..." />
      ) : !settings ? (
        <IgEmpty title="Sem configurações" description="Recarregue a página." icon={<Bot className="h-6 w-6" aria-hidden />} />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <form
            className="rounded-xl border border-border bg-card p-5"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSave();
            }}
          >
            <h2 className="text-sm font-bold">Configuração</h2>

            <div className="mt-4 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="ig-ai-enabled">Agente ativo</Label>
                <Switch
                  id="ig-ai-enabled"
                  checked={settings.enabled}
                  onCheckedChange={(checked) => update({ enabled: checked })}
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="ig-ai-dm">Responder mensagens automaticamente</Label>
                <Switch
                  id="ig-ai-dm"
                  checked={settings.auto_reply_dm}
                  onCheckedChange={(checked) => update({ auto_reply_dm: checked })}
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="ig-ai-comments">Responder comentários automaticamente</Label>
                <Switch
                  id="ig-ai-comments"
                  checked={settings.auto_reply_comments}
                  onCheckedChange={(checked) => update({ auto_reply_comments: checked })}
                />
              </div>

              <div>
                <Label htmlFor="ig-ai-tone">Tom das respostas</Label>
                <Input
                  id="ig-ai-tone"
                  value={settings.tone}
                  onChange={(event) => update({ tone: event.target.value })}
                  maxLength={120}
                  placeholder="Ex.: simpático e direto"
                />
              </div>

              <div>
                <Label htmlFor="ig-ai-context">Sobre o seu negócio</Label>
                <Textarea
                  id="ig-ai-context"
                  rows={5}
                  maxLength={4000}
                  value={settings.business_context ?? ""}
                  onChange={(event) => update({ business_context: event.target.value })}
                  placeholder="O que você vende, preços, horários, formas de pagamento e entrega..."
                />
              </div>

              <div>
                <Label htmlFor="ig-ai-faq">Perguntas frequentes</Label>
                <Textarea
                  id="ig-ai-faq"
                  rows={5}
                  maxLength={4000}
                  value={settings.faq ?? ""}
                  onChange={(event) => update({ faq: event.target.value })}
                  placeholder="Pergunta: ... Resposta: ..."
                />
              </div>

              <div>
                <Label htmlFor="ig-ai-signature">Assinatura no final</Label>
                <Input
                  id="ig-ai-signature"
                  value={settings.signature ?? ""}
                  onChange={(event) => update({ signature: event.target.value })}
                  maxLength={120}
                  placeholder="Ex.: Equipe da loja"
                />
              </div>
            </div>

            <Button type="submit" className="mt-5" disabled={saving}>
              <Save className="mr-2 h-4 w-4" aria-hidden />
              {saving ? "Salvando..." : "Salvar configurações"}
            </Button>
          </form>

          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-bold">Testar resposta</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Escreva uma pergunta como um seguidor faria e veja o que o agente responderia.
            </p>

            <form
              className="mt-4 space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void handleTest();
              }}
            >
              <Textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="Ex.: Qual o preço e vocês entregam hoje?"
                aria-label="Pergunta de teste"
              />
              <Button type="submit" disabled={testing}>
                <Sparkles className="mr-2 h-4 w-4" aria-hidden />
                {testing ? "Gerando..." : "Gerar resposta"}
              </Button>
            </form>

            {reply ? (
              <div className="mt-4 rounded-lg bg-muted p-4">
                <p className="whitespace-pre-wrap text-sm">{reply}</p>
              </div>
            ) : null}
          </div>
        </div>
      )}

      <IgDiagnostics tenantId={tenantId} className="mt-8" />
    </IgLayout>
  );
};

const IgAiPage = () => (
  <IgGuard>
    {({ me, activeTenantId, setActiveTenantId }) => {
      const tenantId = activeTenantId ?? me?.tenants[0]?.id ?? null;

      if (!tenantId) {
        return (
          <IgLayout title="Agente de IA">
            <IgEmpty title="Workspace não encontrado" description="Recarregue a página ou faça login novamente." />
          </IgLayout>
        );
      }

      return (
        <IgAiInner
          tenantId={tenantId}
          tenants={me?.tenants ?? []}
          activeTenantId={activeTenantId}
          onTenantChange={setActiveTenantId}
        />
      );
    }}
  </IgGuard>
);

export default IgAiPage;
