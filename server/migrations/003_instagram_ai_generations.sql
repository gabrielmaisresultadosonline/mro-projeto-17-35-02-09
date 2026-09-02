-- ============================================================
-- Histórico durável de tudo que a IA gera no /instagram.
--
-- Por que existe: as estratégias e legendas viviam apenas no JSON de
-- `public.user_sessions` (profile_sessions). Se aquele JSON é sobrescrito
-- por um sync antigo do navegador, o conteúdo gerado pela IA desaparece.
-- Esta tabela guarda cada geração (estratégia, legenda, análise) com o
-- payload completo, por conta e por perfil analisado, servindo de trilha
-- de auditoria e de fonte de recuperação.
--
-- Idempotente: pode rodar em qualquer deploy sem apagar nada.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.instagram_ai_generations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_username TEXT,
  profile_username TEXT,
  kind             TEXT NOT NULL DEFAULT 'strategy',
  type             TEXT,
  title            TEXT,
  payload          JSONB NOT NULL DEFAULT '{}'::jsonb,
  provider         TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.instagram_ai_generations ADD COLUMN IF NOT EXISTS account_username TEXT;
ALTER TABLE public.instagram_ai_generations ADD COLUMN IF NOT EXISTS profile_username TEXT;
ALTER TABLE public.instagram_ai_generations ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'strategy';
ALTER TABLE public.instagram_ai_generations ADD COLUMN IF NOT EXISTS type TEXT;
ALTER TABLE public.instagram_ai_generations ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE public.instagram_ai_generations ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.instagram_ai_generations ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE public.instagram_ai_generations ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS instagram_ai_generations_account_idx
  ON public.instagram_ai_generations (account_username, created_at DESC);
CREATE INDEX IF NOT EXISTS instagram_ai_generations_profile_idx
  ON public.instagram_ai_generations (profile_username, created_at DESC);

GRANT ALL ON public.instagram_ai_generations TO service_role;
ALTER TABLE public.instagram_ai_generations ENABLE ROW LEVEL SECURITY;
