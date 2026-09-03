import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Normaliza o token: remove espaços, quebras de linha e aspas acidentais.
 * Um token colado com "\n" ou aspas gera OAuthException 190
 * ("Cannot parse access token") na Graph API.
 */
function sanitizeToken(raw: string | null | undefined): string {
  return String(raw ?? "")
    .replace(/\s+/g, "")
    .replace(/^["']|["']$/g, "")
    .trim();
}

/**
 * Resolve o token do CAPI: tokens salvos no /admin (`api_tokens`) primeiro,
 * ambiente como fallback.
 */
async function resolveMetaToken(): Promise<{ token: string; source: string } | null> {
  const candidates = [
    "meta_conversions_api_token",
    "meta_capi",
    "meta",
    "facebook_capi",
    "facebook",
  ];

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (url && serviceKey) {
      const db = createClient(url, serviceKey, { auth: { persistSession: false } });
      const { data } = await db.from("api_tokens").select("key, value").in("key", candidates);
      if (Array.isArray(data)) {
        for (const wanted of candidates) {
          const row = data.find((r: { key: string; value: string }) => r.key === wanted);
          const token = sanitizeToken(row?.value);
          if (token) return { token, source: `admin:${wanted}` };
        }
      }
    }
  } catch (error) {
    console.error("[META-CONVERSIONS] Falha ao ler api_tokens:", (error as Error).message);
  }

  const envToken = sanitizeToken(Deno.env.get("META_CONVERSIONS_API_TOKEN"));
  if (envToken) return { token: envToken, source: "env:META_CONVERSIONS_API_TOKEN" };

  return null;
}


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DEFAULT_PIXEL_ID = '569414052132145';
const META_API_VERSION = 'v18.0';

interface ConversionEvent {
  event_name: string;
  event_time: number;
  event_id?: string;
  action_source: string;
  event_source_url: string;
  user_data: {
    client_ip_address?: string;
    client_user_agent?: string;
    fbc?: string;
    fbp?: string;
    em?: string; // hashed email
    ph?: string; // hashed phone
    fn?: string; // hashed first name
    ln?: string; // hashed last name
    ct?: string; // hashed city
    st?: string; // hashed state
    zp?: string; // hashed zip
    country?: string; // hashed country
  };
  custom_data?: {
    content_name?: string;
    content_category?: string;
    value?: number;
    currency?: string;
  };
}

interface RequestBody {
  pixel_id?: string;
  event_name: string;
  event_id?: string;
  event_source_url: string;
  user_agent?: string;
  client_ip?: string;
  fbc?: string;
  fbp?: string;
  email?: string;
  phone?: string;
  first_name?: string;
  last_name?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  content_name?: string;
  content_category?: string;
  value?: number;
  currency?: string;
  test_event_code?: string;
}

// Simple hash function for user data (SHA256)
async function hashData(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data.toLowerCase().trim());
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const resolved = await resolveMetaToken();

    if (!resolved) {
      // Sem token não há como enviar: respondemos 200 com skipped para que o
      // tracking do site nunca quebre a experiência do usuário.
      console.error('[META-CONVERSIONS] Access token not configured');
      return new Response(
        JSON.stringify({ success: false, skipped: true, error: 'Access token not configured' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const accessToken = resolved.token;
    console.log('[META-CONVERSIONS] Token source:', resolved.source);


    const body: RequestBody = await req.json();
    console.log('[META-CONVERSIONS] Received event:', body.event_name, body.event_id);

    // Build user_data object
    const userData: ConversionEvent['user_data'] = {
      client_user_agent: body.user_agent || req.headers.get('user-agent') || undefined,
      client_ip_address: body.client_ip || req.headers.get('x-forwarded-for')?.split(',')[0] || undefined,
    };

    // Add Facebook click ID and browser ID if available
    // Ensure fbc is not truncated or modified by the server
    if (body.fbc) userData.fbc = body.fbc;
    if (body.fbp) userData.fbp = body.fbp;

    // Hash and add email if provided
    if (body.email) {
      userData.em = await hashData(body.email);
    }

    // Hash and add phone if provided
    if (body.phone) {
      userData.ph = await hashData(body.phone);
    }

    // Add other user data fields if available
    if (body.first_name) userData.fn = await hashData(body.first_name);
    if (body.last_name) userData.ln = await hashData(body.last_name);
    if (body.city) userData.ct = await hashData(body.city);
    if (body.state) userData.st = await hashData(body.state);
    if (body.zip) userData.zp = await hashData(body.zip);
    if (body.country) userData.country = await hashData(body.country);

    // Build event payload
    const event: ConversionEvent = {
      event_name: body.event_name,
      event_time: Math.floor(Date.now() / 1000),
      event_id: body.event_id, // CRITICAL for deduplication
      action_source: 'website',
      event_source_url: body.event_source_url,
      user_data: userData,
    };

    // Add custom data if provided
    // Always include currency if available, especially for Lead events
    if (body.content_name || body.content_category || body.value || body.currency) {
      event.custom_data = {};
      if (body.content_name) event.custom_data.content_name = body.content_name;
      if (body.content_category) event.custom_data.content_category = body.content_category;
      if (body.value) event.custom_data.value = body.value;
      
      // Default to BRL if any custom data is sent but no currency
      event.custom_data.currency = body.currency || 'BRL';
    }

    // Send to Meta Conversions API
    const activePixelId = body.pixel_id || DEFAULT_PIXEL_ID;
    const metaUrl = `https://graph.facebook.com/${META_API_VERSION}/${activePixelId}/events`;
    
    const metaPayload: Record<string, any> = {
      data: [event],
      access_token: accessToken,
    };

    // Add test_event_code if provided (for Facebook Events Manager testing)
    if (body.test_event_code) {
      metaPayload.test_event_code = body.test_event_code;
      console.log('[META-CONVERSIONS] Using test_event_code:', body.test_event_code);
    }

    // Nunca logamos o access_token.
    console.log('[META-CONVERSIONS] Sending to Meta API:', JSON.stringify({ ...metaPayload, access_token: '***' }));


    const metaResponse = await fetch(metaUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(metaPayload),
    });

    const metaResult = await metaResponse.json();
    
    if (!metaResponse.ok) {
      // Erros da Graph API (ex.: OAuthException 190 token inválido) são
      // registrados mas devolvidos com 200 para não derrubar a página.
      console.error('[META-CONVERSIONS] Meta API error:', JSON.stringify(metaResult));
      return new Response(
        JSON.stringify({
          success: false,
          skipped: true,
          token_source: resolved.source,
          error: metaResult,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }


    console.log('[META-CONVERSIONS] Meta API response:', metaResult);

    return new Response(
      JSON.stringify({ success: true, result: metaResult }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[META-CONVERSIONS] Error:', errorMessage);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
