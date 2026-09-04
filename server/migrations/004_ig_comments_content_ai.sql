-- MRO INSTAGRAM (/IG) — Comentários, conteúdo (publicações) e Agente de IA.
-- Migração ADITIVA e idempotente: não altera nem remove nada existente.

-- ---------------- Mídias já publicadas (importadas da Graph API) ----------------
CREATE TABLE IF NOT EXISTS public.ig_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  ig_account_id uuid NOT NULL,
  media_id text NOT NULL UNIQUE,
  media_type text,
  media_product_type text,
  caption text,
  media_url text,
  thumbnail_url text,
  permalink text,
  like_count integer,
  comments_count integer,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ig_media_tenant_idx ON public.ig_media (tenant_id, published_at DESC);

-- ---------------- Comentários recebidos ----------------
CREATE TABLE IF NOT EXISTS public.ig_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  ig_account_id uuid NOT NULL,
  comment_id text NOT NULL UNIQUE,
  media_id text,
  parent_comment_id text,
  from_id text,
  from_username text,
  text text,
  is_own boolean NOT NULL DEFAULT false,
  replied boolean NOT NULL DEFAULT false,
  hidden boolean NOT NULL DEFAULT false,
  commented_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ig_comments_tenant_idx ON public.ig_comments (tenant_id, commented_at DESC);
CREATE INDEX IF NOT EXISTS ig_comments_media_idx ON public.ig_comments (media_id);

-- ---------------- Publicações criadas pelo painel ----------------
CREATE TABLE IF NOT EXISTS public.ig_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  ig_account_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'publishing', 'published', 'failed')),
  media_type text NOT NULL DEFAULT 'IMAGE' CHECK (media_type IN ('IMAGE', 'REELS', 'STORIES')),
  caption text,
  media_url text,
  container_id text,
  published_media_id text,
  permalink text,
  last_error text,
  created_by uuid,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ig_publications_tenant_idx ON public.ig_publications (tenant_id, created_at DESC);

-- ---------------- Configuração do Agente de IA ----------------
CREATE TABLE IF NOT EXISTS public.ig_ai_settings (
  tenant_id uuid PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  auto_reply_dm boolean NOT NULL DEFAULT false,
  auto_reply_comments boolean NOT NULL DEFAULT false,
  tone text NOT NULL DEFAULT 'profissional e acolhedor',
  business_context text,
  faq text,
  signature text,
  model text NOT NULL DEFAULT 'google/gemini-2.5-flash',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------- Grants da Data API ----------------
GRANT SELECT ON public.ig_media TO authenticated;
GRANT SELECT ON public.ig_comments TO authenticated;
GRANT SELECT ON public.ig_publications TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.ig_ai_settings TO authenticated;
GRANT ALL ON public.ig_media TO service_role;
GRANT ALL ON public.ig_comments TO service_role;
GRANT ALL ON public.ig_publications TO service_role;
GRANT ALL ON public.ig_ai_settings TO service_role;

-- ---------------- RLS: somente membros do workspace ----------------
ALTER TABLE public.ig_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ig_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ig_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ig_ai_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ig_media' AND policyname = 'ig_media_member_read') THEN
    CREATE POLICY ig_media_member_read ON public.ig_media FOR SELECT TO authenticated
      USING (public.ig_is_tenant_member(tenant_id));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ig_comments' AND policyname = 'ig_comments_member_read') THEN
    CREATE POLICY ig_comments_member_read ON public.ig_comments FOR SELECT TO authenticated
      USING (public.ig_is_tenant_member(tenant_id));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ig_publications' AND policyname = 'ig_publications_member_read') THEN
    CREATE POLICY ig_publications_member_read ON public.ig_publications FOR SELECT TO authenticated
      USING (public.ig_is_tenant_member(tenant_id));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ig_ai_settings' AND policyname = 'ig_ai_settings_member_read') THEN
    CREATE POLICY ig_ai_settings_member_read ON public.ig_ai_settings FOR SELECT TO authenticated
      USING (public.ig_is_tenant_member(tenant_id));
  END IF;
END;
$$;
