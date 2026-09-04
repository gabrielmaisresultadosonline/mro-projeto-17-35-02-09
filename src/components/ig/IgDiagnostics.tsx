/**
 * Painel de diagnóstico do workspace /IG: últimos registros de auditoria,
 * eventos recebidos da Meta e jobs com erro. Nenhum segredo é exibido.
 */
import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { igApi } from "@/lib/ig/api";

interface IgDiagnosticsData {
  logs: Array<{ id: string; action: string; actor_type: string; result: string; created_at: string }>;
  jobs: Array<{ id: string; type: string; status: string; attempts: number; last_error: string | null; created_at: string }>;
  events: Array<{ id: string; field: string; status: string; error: string | null; received_at: string }>;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export interface IgDiagnosticsProps {
  tenantId: string;
  className?: string;
}

export function IgDiagnostics({ tenantId, className }: IgDiagnosticsProps) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<IgDiagnosticsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await igApi.logs(tenantId);
      setData({ logs: result.logs, jobs: result.jobs, events: result.events });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar os registros.");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (open && !data) void load();
  }, [open, data, load]);

  return (
    <section className={cn("rounded-xl border border-border bg-card", className)} aria-label="Registros técnicos">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          <ScrollText className="h-4 w-4 text-primary" aria-hidden />
          Registros e diagnóstico
        </span>
        {open ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
      </button>

      {open ? (
        <div className="space-y-5 border-t border-border px-4 py-4">
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={load} disabled={loading}>
              {loading ? "Atualizando..." : "Atualizar"}
            </Button>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          {data ? (
            <>
              <div>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  Eventos recebidos do Instagram
                </h3>
                {data.events.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum evento recebido até agora.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {data.events.map((event) => (
                      <li key={event.id} className="flex flex-wrap items-center gap-2">
                        <span className="text-muted-foreground">{formatDate(event.received_at)}</span>
                        <Badge variant="secondary">{event.field}</Badge>
                        <span>{event.status}</span>
                        {event.error ? <span className="text-destructive">{event.error}</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  Processamentos em fila
                </h3>
                {data.jobs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum processamento registrado.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {data.jobs.map((job) => (
                      <li key={job.id} className="flex flex-wrap items-center gap-2">
                        <span className="text-muted-foreground">{formatDate(job.created_at)}</span>
                        <Badge variant="outline">{job.type}</Badge>
                        <span>{job.status}</span>
                        <span className="text-muted-foreground">tentativas: {job.attempts}</span>
                        {job.last_error ? <span className="text-destructive">{job.last_error}</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  Ações do workspace
                </h3>
                {data.logs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma ação registrada.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {data.logs.map((log) => (
                      <li key={log.id} className="flex flex-wrap items-center gap-2">
                        <span className="text-muted-foreground">{formatDate(log.created_at)}</span>
                        <Badge variant="secondary">{log.action}</Badge>
                        <span className="text-muted-foreground">{log.actor_type}</span>
                        <span>{log.result}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export default IgDiagnostics;
