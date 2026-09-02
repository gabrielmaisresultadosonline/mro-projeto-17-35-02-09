import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { getCurrentUser } from '@/lib/userStorage';
import { Sparkles, Copy, Check, Loader2, RefreshCw, Type } from 'lucide-react';

interface CaptionGeneratorProps {
  profileUsername?: string;
  niche?: string;
}

export const CaptionGenerator = ({ profileUsername, niche: defaultNiche }: CaptionGeneratorProps) => {
  const { toast } = useToast();
  const [niche, setNiche] = useState(defaultNiche || '');
  const [product, setProduct] = useState('');
  const [objective, setObjective] = useState('');
  const [generatedCaption, setGeneratedCaption] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleGenerate = async () => {
    if (!niche.trim() || !product.trim()) {
      toast({
        title: "Campos obrigatórios",
        description: "Preencha o nicho e o que você está vendendo",
        variant: "destructive"
      });
      return;
    }

    setIsLoading(true);
    setGeneratedCaption('');

    try {
      const { data, error } = await supabase.functions.invoke('generate-caption', {
        body: {
          niche: niche.trim(),
          product: product.trim(),
          objective: objective.trim() || 'engajamento e vendas',
          username: profileUsername,
          accountUsername: getLoggedInUsername() || undefined,
        }
      });

      // O backend devolve `error` no corpo quando falta token de IA ou o
      // provedor recusa. Sem repassar essa mensagem, o usuário só via
      // "tente novamente" e não sabia que precisava salvar o token no /admin.
      const backendError = (data as { error?: string } | null)?.error;
      if (error || backendError) {
        throw new Error(backendError || error?.message || 'Falha ao gerar legenda');
      }

      if (!data?.caption) {
        throw new Error('A IA não retornou nenhuma legenda. Verifique o token em /admin → Tokens.');
      }

      setGeneratedCaption(data.caption);
      toast({
        title: "Legenda gerada!",
        description: "Sua legenda copy está pronta para uso"
      });
    } catch (error) {
      console.error('Erro ao gerar legenda:', error);
      toast({
        title: "Erro ao gerar legenda",
        description: error instanceof Error ? error.message : "Tente novamente em alguns instantes",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(generatedCaption);
    setCopied(true);
    toast({
      title: "Copiado!",
      description: "Legenda copiada para a área de transferência"
    });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="glass-card glow-border p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-3 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5">
            <Type className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-display font-bold">Gerador de Legendas</h2>
            <p className="text-sm text-muted-foreground">
              Crie legendas copy profissionais para suas publicações
            </p>
          </div>
        </div>

        {/* Form */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">
              Qual é o seu nicho? *
            </label>
            <Input
              placeholder="Ex: Moda feminina, Nutrição, Imóveis, Advocacia..."
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              className="bg-secondary/50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              O que você está vendendo/divulgando? *
            </label>
            <Textarea
              placeholder="Ex: Curso de emagrecimento saudável, Consultoria jurídica online, Apartamentos de alto padrão..."
              value={product}
              onChange={(e) => setProduct(e.target.value)}
              className="bg-secondary/50 min-h-[80px]"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Objetivo da publicação (opcional)
            </label>
            <Input
              placeholder="Ex: Gerar leads, Vender, Engajar, Educar..."
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              className="bg-secondary/50"
            />
          </div>

          <Button
            onClick={handleGenerate}
            disabled={isLoading || !niche.trim() || !product.trim()}
            className="w-full bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Gerando legenda...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                Gerar Legenda Copy
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Generated Caption */}
      {generatedCaption && (
        <div className="glass-card glow-border p-6 animate-slide-up">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-display font-bold flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              Sua Legenda Copy
            </h3>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleGenerate}
                disabled={isLoading}
              >
                <RefreshCw className={`w-4 h-4 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
                Nova
              </Button>
              <Button
                variant="gradient"
                size="sm"
                onClick={copyToClipboard}
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 mr-1" />
                    Copiado!
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 mr-1" />
                    Copiar
                  </>
                )}
              </Button>
            </div>
          </div>

          <div className="bg-secondary/30 rounded-lg p-4 border border-border">
            <pre className="whitespace-pre-wrap text-sm font-sans leading-relaxed">
              {generatedCaption}
            </pre>
          </div>

          <p className="text-xs text-muted-foreground mt-3">
            💡 Dica: Personalize a legenda com suas palavras e adicione emojis que combinam com sua marca!
          </p>
        </div>
      )}

      {/* Tips */}
      {!generatedCaption && (
        <div className="glass-card p-6">
          <h3 className="text-lg font-display font-semibold mb-4">💡 Dicas para Legendas que Convertem</h3>
          <ul className="space-y-3 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="text-primary">✓</span>
              Comece com uma frase de impacto que prenda a atenção
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary">✓</span>
              Use gatilhos mentais como urgência e escassez
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary">✓</span>
              Termine sempre com um CTA (chamada para ação) claro
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary">✓</span>
              Hashtags estratégicas aumentam o alcance
            </li>
          </ul>
        </div>
      )}
    </div>
  );
};
