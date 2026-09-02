import { Strategy } from '@/types/instagram';
import { Zap, Calendar, MessageSquare, ChevronDown, ChevronUp, Clock, Info, User, Copy, Check, AlertTriangle, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';

interface StrategyDisplayProps {
  strategy: Strategy;
}

/**
 * Helpers defensivos.
 *
 * Estratégias antigas (salvas antes da normalização no backend) e respostas
 * variadas da IA podem trazer strings onde o componente espera arrays, ou
 * objetos incompletos. Antes isso derrubava a árvore React inteira ("tela
 * preta") ao expandir a estratégia. Aqui tudo é convertido antes de renderizar.
 */
const asArray = <T,>(value: unknown): T[] => {
  if (Array.isArray(value)) return value.filter((item) => item !== null && item !== undefined) as T[];
  if (value === null || value === undefined || value === '') return [];
  return [value as T];
};

const asTextArray = (value: unknown): string[] =>
  asArray<unknown>(value).map((item) =>
    typeof item === 'string' ? item : typeof item === 'number' ? String(item) : JSON.stringify(item),
  );

const asText = (value: unknown): string =>
  value === null || value === undefined
    ? ''
    : typeof value === 'string' || typeof value === 'number'
      ? String(value)
      : JSON.stringify(value);

/** Campos já renderizados por seções dedicadas — o resto vai para "Informações adicionais". */
const KNOWN_FIELDS = new Set([
  'id', 'title', 'description', 'type', 'createdAt', 'steps', 'scripts', 'storiesCalendar',
  'postsCalendar', 'mroTutorial', 'metaSchedulingTutorial', 'bioAnalysis', 'suggestedBios', 'tips',
]);

export const StrategyDisplay = ({ strategy }: StrategyDisplayProps) => {
  const { toast } = useToast();
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    steps: true,
    mroTutorial: true,
    scripts: false,
    stories: false,
    posts: false,
    metaTutorial: false,
    bioAnalysis: true,
    suggestedBios: true,
    bioTips: false,
    extras: false,
  });
  const [copiedBio, setCopiedBio] = useState<number | null>(null);

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const copyBio = async (bio: string, index: number) => {
    await navigator.clipboard.writeText(bio);
    setCopiedBio(index);
    toast({ title: "Bio copiada!", description: "Cole no Instagram" });
    setTimeout(() => setCopiedBio(null), 2000);
  };

  const typeIcons: Record<string, React.ReactNode> = {
    mro: <Zap className="w-5 h-5" />,
    content: <Calendar className="w-5 h-5" />,
    engagement: <MessageSquare className="w-5 h-5" />,
    sales: <MessageSquare className="w-5 h-5" />,
    bio: <User className="w-5 h-5" />,
  };

  const typeColors: Record<string, string> = {
    mro: 'bg-primary/20 text-primary',
    content: 'bg-mro-cyan/20 text-mro-cyan',
    engagement: 'bg-mro-purple/20 text-mro-purple',
    sales: 'bg-mro-green/20 text-mro-green',
    bio: 'bg-amber-500/20 text-amber-500',
  };

  const raw = strategy as unknown as Record<string, unknown>;

  const steps = asTextArray(raw.steps);
  const tips = asTextArray(raw.tips);
  const metaTutorial = asTextArray(raw.metaSchedulingTutorial);
  const scripts = asArray<Record<string, unknown>>(raw.scripts);
  const postsCalendar = asArray<Record<string, unknown>>(raw.postsCalendar);
  const storiesCalendar = asArray<Record<string, unknown>>(raw.storiesCalendar);
  const suggestedBios = asArray<Record<string, unknown>>(raw.suggestedBios);
  const bioAnalysisRaw = (raw.bioAnalysis && typeof raw.bioAnalysis === 'object'
    ? raw.bioAnalysis
    : null) as Record<string, unknown> | null;
  const mroRaw = (raw.mroTutorial && typeof raw.mroTutorial === 'object'
    ? raw.mroTutorial
    : null) as Record<string, unknown> | null;

  const mroDailyActions = asArray<Record<string, unknown>>(mroRaw?.dailyActions);
  const mroUnfollow = asTextArray(mroRaw?.unfollowStrategy);
  const mroCompetitor = asText(mroRaw?.competitorReference);
  const mroTemplates = asTextArray(mroRaw?.messageTemplates);
  const hasMro =
    mroDailyActions.length > 0 || mroUnfollow.length > 0 || !!mroCompetitor || mroTemplates.length > 0;

  // Qualquer campo extra que a IA tenha devolvido continua visível aqui.
  const extras = Object.entries(raw).filter(
    ([key, value]) =>
      !KNOWN_FIELDS.has(key) &&
      value !== null &&
      value !== undefined &&
      value !== '' &&
      !(Array.isArray(value) && value.length === 0),
  );

  return (
    <div className="glass-card p-6 animate-slide-up">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <span className={`p-2 rounded-lg ${typeColors[strategy.type] || 'bg-primary/20 text-primary'}`}>
              {typeIcons[strategy.type] || <Zap className="w-5 h-5" />}
            </span>
            <h3 className="text-xl font-display font-bold">{asText(raw.title) || 'Estratégia'}</h3>
          </div>
          <p className="text-muted-foreground text-sm">{asText(raw.description)}</p>
        </div>
        <span className="text-xs text-muted-foreground">
          {strategy.createdAt ? new Date(strategy.createdAt).toLocaleDateString('pt-BR') : ''}
        </span>
      </div>

      {/* Steps */}
      {steps.length > 0 && (
        <CollapsibleSection
          title="Passos da Estratégia"
          isExpanded={expandedSections.steps}
          onToggle={() => toggleSection('steps')}
        >
          <ul className="space-y-2">
            {steps.map((step, i) => (
              <li key={i} className="text-sm p-3 rounded-lg bg-secondary/50 flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold flex-shrink-0">
                  {i + 1}
                </span>
                <span className="whitespace-pre-wrap">{step}</span>
              </li>
            ))}
          </ul>
        </CollapsibleSection>
      )}

      {/* Bio Analysis */}
      {bioAnalysisRaw && (
        <CollapsibleSection
          title="📊 Análise da Bio Atual"
          isExpanded={expandedSections.bioAnalysis}
          onToggle={() => toggleSection('bioAnalysis')}
        >
          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-secondary/50 border border-border">
              <p className="text-xs text-muted-foreground mb-1">Bio Atual:</p>
              <p className="text-sm italic">"{asText(bioAnalysisRaw.currentBio)}"</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                <p className="text-sm font-semibold text-destructive mb-2">❌ Problemas Identificados</p>
                <ul className="space-y-1">
                  {asTextArray(bioAnalysisRaw.problems).map((problem, i) => (
                    <li key={i} className="text-xs text-muted-foreground">• {problem}</li>
                  ))}
                </ul>
              </div>

              <div className="p-3 rounded-lg bg-mro-green/10 border border-mro-green/20">
                <p className="text-sm font-semibold text-mro-green mb-2">✅ Pontos Fortes</p>
                <ul className="space-y-1">
                  {asTextArray(bioAnalysisRaw.strengths).map((strength, i) => (
                    <li key={i} className="text-xs text-muted-foreground">• {strength}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </CollapsibleSection>
      )}

      {/* Suggested Bios */}
      {suggestedBios.length > 0 && (
        <CollapsibleSection
          title="✨ Bios Sugeridas (Clique para copiar)"
          isExpanded={expandedSections.suggestedBios}
          onToggle={() => toggleSection('suggestedBios')}
        >
          <div className="space-y-3">
            {suggestedBios.map((item, i) => {
              const bio = typeof item === 'string' ? item : asText(item.bio);
              const focus = typeof item === 'string' ? '' : asText(item.focus);
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => copyBio(bio, i)}
                  className="w-full p-4 rounded-lg bg-primary/10 border border-primary/30 hover:bg-primary/20 transition-all text-left cursor-pointer group"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <p className="text-sm font-medium mb-2">{bio}</p>
                      {focus && <p className="text-xs text-muted-foreground">{focus}</p>}
                    </div>
                    <div className="flex-shrink-0">
                      {copiedBio === i ? (
                        <Check className="w-5 h-5 text-mro-green" />
                      ) : (
                        <Copy className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </CollapsibleSection>
      )}

      {/* Tips */}
      {tips.length > 0 && (
        <CollapsibleSection
          title="💡 Dicas"
          isExpanded={expandedSections.bioTips}
          onToggle={() => toggleSection('bioTips')}
        >
          <ul className="space-y-2">
            {tips.map((tip, i) => (
              <li key={i} className="text-sm p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                {tip}
              </li>
            ))}
          </ul>
        </CollapsibleSection>
      )}

      {/* MRO Warning */}
      {(strategy.type === 'mro' || hasMro) && (
        <div className="mb-4 p-4 rounded-lg bg-amber-500/10 border border-amber-500/30">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-500 mb-1">⚠️ Aviso Importante — Interações com a MRO</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Quando iniciar a ferramenta MRO, <strong className="text-foreground">evite fazer interações manualmente pelo celular</strong>.
                Você pode publicar stories, feed posts normalmente, mas <strong className="text-foreground">não siga ninguém, não curta ninguém e não curta nenhum story</strong> enquanto a ferramenta estiver ativa.
                A MRO funciona em dias alternados (1 dia sim, 1 dia não) com uma tarefa por dia: seguir + curtir em um dia, curtir stories em outro, enviar mensagens em outro.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* MRO Tutorial */}
      {hasMro && (
        <CollapsibleSection
          title="🤖 Tutorial MRO Inteligente"
          isExpanded={expandedSections.mroTutorial}
          onToggle={() => toggleSection('mroTutorial')}
        >
          <div className="space-y-4">
            {mroDailyActions.length > 0 && (
              <div>
                <h5 className="font-semibold text-sm mb-2 text-primary">Ações Diárias</h5>
                <div className="space-y-2">
                  {mroDailyActions.map((action, i) => (
                    <div key={i} className="p-3 rounded-lg bg-primary/10 border border-primary/20">
                      <div className="flex items-center justify-between mb-1 gap-2">
                        <span className="font-medium text-sm">{asText(action.action)}</span>
                        {!!asText(action.quantity) && (
                          <span className="text-xs bg-primary/20 px-2 py-1 rounded flex-shrink-0">{asText(action.quantity)}</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground whitespace-pre-wrap">{asText(action.description)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {mroUnfollow.length > 0 && (
              <div>
                <h5 className="font-semibold text-sm mb-2 text-mro-purple">Estratégia de Unfollow</h5>
                <ul className="space-y-1">
                  {mroUnfollow.map((step, i) => (
                    <li key={i} className="text-sm p-2 rounded bg-mro-purple/10">{step}</li>
                  ))}
                </ul>
              </div>
            )}

            {mroTemplates.length > 0 && (
              <div>
                <h5 className="font-semibold text-sm mb-2 text-mro-green">Modelos de Mensagem</h5>
                <ul className="space-y-1">
                  {mroTemplates.map((template, i) => (
                    <li key={i} className="text-sm p-2 rounded bg-mro-green/10 whitespace-pre-wrap">{template}</li>
                  ))}
                </ul>
              </div>
            )}

            {!!mroCompetitor && (
              <div className="p-3 rounded-lg bg-mro-cyan/10 border border-mro-cyan/20">
                <p className="text-sm font-medium text-mro-cyan">📌 Conta de Referência</p>
                <p className="text-xs text-muted-foreground mt-1">{mroCompetitor}</p>
              </div>
            )}
          </div>
        </CollapsibleSection>
      )}

      {/* Posts Calendar */}
      {postsCalendar.length > 0 && (
        <CollapsibleSection
          title="📅 Calendário de Posts (3 em 3 dias)"
          isExpanded={expandedSections.posts}
          onToggle={() => toggleSection('posts')}
        >
          <div className="overflow-x-auto">
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {postsCalendar.map((post, i) => (
                <div key={i} className="p-3 rounded-lg bg-secondary/30 border border-border">
                  <div className="flex items-center justify-between mb-2 gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold bg-primary/20 text-primary px-2 py-1 rounded">
                        {asText(post.date)}
                      </span>
                      <span className="text-xs text-muted-foreground">{asText(post.dayOfWeek)}</span>
                    </div>
                    {!!asText(post.bestTime) && (
                      <div className="flex items-center gap-2">
                        <Clock className="w-3 h-3 text-muted-foreground" />
                        <span className="text-xs">{asText(post.bestTime)}</span>
                      </div>
                    )}
                  </div>
                  <p className="text-sm font-medium mb-1">{asText(post.postType)}</p>
                  <p className="text-xs text-muted-foreground mb-2 whitespace-pre-wrap">{asText(post.content)}</p>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {asTextArray(post.hashtags).map((tag, j) => (
                      <span key={j} className="text-xs bg-mro-cyan/10 text-mro-cyan px-2 py-0.5 rounded">
                        {tag}
                      </span>
                    ))}
                  </div>
                  {!!asText(post.cta) && <p className="text-xs text-mro-green">💡 CTA: {asText(post.cta)}</p>}
                </div>
              ))}
            </div>
          </div>
        </CollapsibleSection>
      )}

      {/* Meta Scheduling Tutorial */}
      {metaTutorial.length > 0 && (
        <CollapsibleSection
          title="📱 Como Agendar no Meta Business Suite"
          isExpanded={expandedSections.metaTutorial}
          onToggle={() => toggleSection('metaTutorial')}
        >
          <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <div className="flex items-start gap-2 mb-3">
              <Info className="w-4 h-4 text-blue-500 mt-0.5" />
              <p className="text-xs text-muted-foreground">
                Use o Meta Business Suite para agendar seus posts de 3 em 3 dias conforme o calendário acima.
              </p>
            </div>
            <ol className="space-y-2">
              {metaTutorial.map((step, i) => (
                <li key={i} className="text-sm p-2 rounded bg-secondary/30 flex items-start gap-2">
                  <span className="whitespace-pre-wrap">{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </CollapsibleSection>
      )}

      {/* Scripts */}
      {scripts.length > 0 && (
        <CollapsibleSection
          title="Scripts de Vendas"
          isExpanded={expandedSections.scripts}
          onToggle={() => toggleSection('scripts')}
        >
          <div className="space-y-4">
            {scripts.map((script, i) => (
              <div key={i} className="p-4 rounded-lg bg-secondary/30 border border-border">
                <p className="font-semibold text-sm mb-3 text-primary">{asText(script.situation)}</p>
                <div className="space-y-3 text-sm">
                  <div>
                    <span className="text-xs text-muted-foreground uppercase">Abertura:</span>
                    <p className="mt-1 whitespace-pre-wrap">{asText(script.opening)}</p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground uppercase">Desenvolvimento:</span>
                    <p className="mt-1 whitespace-pre-wrap">{asText(script.body)}</p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground uppercase">Fechamento:</span>
                    <p className="mt-1 whitespace-pre-wrap">{asText(script.closing)}</p>
                  </div>
                  {asTextArray(script.scarcityTriggers).length > 0 && (
                    <div>
                      <span className="text-xs text-muted-foreground uppercase">Gatilhos de Escassez:</span>
                      <ul className="mt-1 space-y-1">
                        {asTextArray(script.scarcityTriggers).map((trigger, j) => (
                          <li key={j} className="text-mro-green">{trigger}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Stories Calendar */}
      {storiesCalendar.length > 0 && (
        <CollapsibleSection
          title="Calendário de Stories"
          isExpanded={expandedSections.stories}
          onToggle={() => toggleSection('stories')}
        >
          <div className="overflow-x-auto">
            <div className="flex gap-4 min-w-max pb-4">
              {storiesCalendar.map((day, i) => (
                <div key={i} className="w-48 flex-shrink-0">
                  <p className="font-semibold text-sm mb-3 text-center p-2 rounded-lg bg-primary/10">
                    {asText(day.day)}
                  </p>
                  <div className="space-y-2">
                    {asArray<Record<string, unknown>>(day.stories).map((story, j) => (
                      <div
                        key={j}
                        className={`p-2 rounded-lg text-xs ${
                          story.hasButton ? 'bg-primary/20 border border-primary/30' : 'bg-secondary/50'
                        }`}
                      >
                        <span className="text-muted-foreground">{asText(story.time)}</span>
                        <p className="mt-1 whitespace-pre-wrap">{asText(story.content)}</p>
                        {!!story.hasButton && (
                          <span className="inline-block mt-2 px-2 py-1 bg-primary text-primary-foreground rounded text-xs">
                            {asText(story.buttonText) || 'Saiba mais'}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CollapsibleSection>
      )}

      {/* Campos extras devolvidos pela IA — nada fica escondido */}
      {extras.length > 0 && (
        <CollapsibleSection
          title="🧠 Informações adicionais da IA"
          isExpanded={expandedSections.extras}
          onToggle={() => toggleSection('extras')}
        >
          <div className="space-y-3">
            {extras.map(([key, value]) => (
              <div key={key} className="p-3 rounded-lg bg-secondary/30 border border-border">
                <p className="text-xs font-semibold text-primary mb-2 flex items-center gap-2">
                  <Sparkles className="w-3 h-3" />
                  {key}
                </p>
                {Array.isArray(value) ? (
                  <ul className="space-y-1">
                    {asTextArray(value).map((item, i) => (
                      <li key={i} className="text-xs text-muted-foreground whitespace-pre-wrap">• {item}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground whitespace-pre-wrap break-words">{asText(value)}</p>
                )}
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
};

const CollapsibleSection = ({
  title,
  isExpanded,
  onToggle,
  children
}: {
  title: string;
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) => (
  <div className="mb-4">
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center justify-between p-3 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors cursor-pointer"
    >
      <span className="font-semibold text-sm">{title}</span>
      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
    </button>
    {isExpanded && <div className="mt-3">{children}</div>}
  </div>
);
