import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callTextAi, recordAiGeneration, resolveTextAiKey } from "../_shared/ai-text.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CaptionRequest {
  niche: string;
  product: string;
  objective?: string;
  username?: string;
  accountUsername?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as Partial<CaptionRequest>;
    const niche = String(body.niche ?? '').trim();
    const product = String(body.product ?? '').trim();
    const objective = String(body.objective ?? '').trim() || 'engajamento e vendas';
    const username = body.username ? String(body.username).trim() : '';
    const accountUsername = body.accountUsername ? String(body.accountUsername).trim() : '';

    if (!niche || !product) {
      return new Response(
        JSON.stringify({ error: 'Informe o nicho e o que está sendo vendido' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Chave vinda do /admin (aba Tokens) ou do ambiente — nesta ordem.
    const auth = await resolveTextAiKey();
    if (!auth) {
      return new Response(
        JSON.stringify({
          error: 'Nenhum token de IA configurado. Salve a chave da OpenAI (ChatGPT) ou DeepSeek em /admin → Tokens.',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    console.log(`Gerando legenda via ${auth.provider} (${auth.source})`, { niche, product, objective, username });

    const prompt = `Você é um especialista em copywriting para Instagram. Crie uma legenda profissional e persuasiva para uma publicação no Instagram.

DADOS DO PERFIL:
- Nicho: ${niche}
- Produto/Serviço: ${product}
- Objetivo: ${objective}
${username ? `- Perfil: @${username}` : ''}

REQUISITOS DA LEGENDA:
1. Comece com um GANCHO forte que prenda atenção nos primeiros 2 segundos
2. Use gatilhos mentais (urgência, escassez, autoridade, prova social)
3. Conte uma mini-história ou faça uma conexão emocional
4. Inclua benefícios claros do produto/serviço
5. Termine com um CTA (chamada para ação) poderoso
6. Adicione 5-10 hashtags estratégicas relevantes ao nicho
7. Use emojis de forma estratégica para destacar pontos importantes
8. Mantenha parágrafos curtos e espaçados para facilitar leitura no celular

FORMATO:
- Máximo 2200 caracteres (limite do Instagram)
- Use quebras de linha para facilitar leitura
- Separe as hashtags no final

Gere APENAS a legenda pronta para copiar e colar, sem explicações adicionais.`;

    const caption = await callTextAi({
      auth,
      systemPrompt:
        'Você é um copywriter expert em Instagram Marketing. Crie legendas persuasivas e envolventes em português brasileiro.',
      userPrompt: prompt,
      maxTokens: 1500,
    });

    // Persistência durável: a legenda fica salva no banco por conta/perfil.
    await recordAiGeneration({
      accountUsername: accountUsername || null,
      profileUsername: username || null,
      kind: 'caption',
      type: 'caption',
      title: `Legenda — ${niche}`,
      payload: { niche, product, objective, caption },
      provider: auth.provider,
    });

    return new Response(
      JSON.stringify({ caption, provider: auth.provider }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error: unknown) {
    console.error('Erro ao gerar legenda:', error);
    const errorMessage = error instanceof Error ? error.message : 'Erro interno';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
