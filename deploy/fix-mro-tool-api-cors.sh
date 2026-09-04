#!/usr/bin/env bash
# Corrige e comprova o CORS da mro-tool-api em todas as camadas da VPS:
# código Deno -> host Express -> Nginx -> domínio público.
#
# Não altera server/.env, banco, uploads, tokens, credenciais ou certificados.
# Uso (na raiz do projeto):
#   sudo bash deploy/fix-mro-tool-api-cors.sh
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/var/www/ia-mro}"
API_DOMAIN="${API_DOMAIN:-api.maisresultadosonline.com.br}"
BACKEND_PORT="${BACKEND_PORT:-8787}"
SITE_ORIGIN="${SITE_ORIGIN:-https://maisresultadosonline.com.br}"
FUNCTION_PATH="/functions/v1/mro-tool-api"
CANONICAL_REPO_URL="https://github.com/gabrielmaisresultadosonline/mro-projeto-17-35-02-09.git"

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m  ✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m  ! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m  ✗ %s\033[0m\n' "$*" >&2; exit 1; }

[[ "$(id -u)" == "0" ]] || die "Rode como root: sudo bash deploy/fix-mro-tool-api-cors.sh"
[[ -d "$PROJECT_DIR/.git" ]] || die "Projeto Git não encontrado em $PROJECT_DIR."
for binary in git curl nginx python3 pm2; do
  command -v "$binary" >/dev/null 2>&1 || die "$binary não encontrado na VPS."
done

cd "$PROJECT_DIR"

log "1/6 Sincronizando o repositório oficial"
CURRENT_REMOTE="$(git remote get-url origin 2>/dev/null || true)"
if [[ "$CURRENT_REMOTE" != "$CANONICAL_REPO_URL" ]]; then
  warn "origin anterior: ${CURRENT_REMOTE:-não configurado}"
  if [[ -n "$CURRENT_REMOTE" ]]; then
    git remote set-url origin "$CANONICAL_REPO_URL"
  else
    git remote add origin "$CANONICAL_REPO_URL"
  fi
fi
git fetch --prune --force origin main
git checkout -B main origin/main --quiet
git reset --hard origin/main --quiet
ok "Código oficial em $(git rev-parse --short HEAD)"

log "2/6 Confirmando CORS dentro da Edge Function"
FUNCTION_FILE="supabase/functions/mro-tool-api/index.ts"
[[ -f "$FUNCTION_FILE" ]] || die "$FUNCTION_FILE não existe nesta revisão."
grep -q 'Access-Control-Allow-Origin' "$FUNCTION_FILE" || die "Allow-Origin ausente da função."
grep -q 'Access-Control-Allow-Methods' "$FUNCTION_FILE" || die "Allow-Methods ausente da função."
grep -q 'Access-Control-Allow-Headers' "$FUNCTION_FILE" || die "Allow-Headers ausente da função."
grep -q 'req.method === "OPTIONS"' "$FUNCTION_FILE" || die "Handler OPTIONS ausente da função."
grep -q 'headers: { ...corsHeaders' "$FUNCTION_FILE" || die "Helper de respostas com CORS ausente."
ok "OPTIONS e respostas JSON da função incluem CORS."

log "3/6 Executando deploy completo preservando dados e credenciais"
chmod +x deploy.sh
env -u REPO_URL ./deploy.sh --cutover
ok "Build, banco, frontend, backend e funções atualizados."

log "4/6 Conferindo o proxy correto do Nginx"
NGINX_DUMP="$(mktemp)"
trap 'rm -f "$NGINX_DUMP"' EXIT
nginx -T >"$NGINX_DUMP" 2>&1 || die "nginx -T falhou."
python3 - "$NGINX_DUMP" "$API_DOMAIN" "$BACKEND_PORT" <<'PY'
import re, sys

text = open(sys.argv[1], encoding="utf-8").read()
domain, port = sys.argv[2], sys.argv[3]
servers = re.findall(r"server\s*\{.*?\n\}", text, flags=re.S)
server = next((block for block in servers if re.search(r"server_name[^;]*\b" + re.escape(domain) + r"\b", block)), "")
if not server:
    raise SystemExit("vhost da API não encontrado no nginx -T")
match = re.search(r"location\s+/functions/v1/?\s*\{([^{}]*)\}", server, flags=re.S)
if not match:
    raise SystemExit("location /functions/v1/ ausente do vhost")
block = match.group(1)
if not re.search(r"proxy_pass\s+http://127\.0\.0\.1:" + re.escape(port) + r"\s*;", block):
    raise SystemExit("/functions/v1/ não aponta para o backend Express em 127.0.0.1:" + port)
if re.search(r"add_header\s+['\"]?Access-Control-", block, flags=re.I):
    raise SystemExit("CORS duplicado no Nginx; os headers devem vir do backend/função")
PY
ok "Nginx encaminha funções ao Express em 127.0.0.1:${BACKEND_PORT}, sem CORS duplicado."

log "5/6 Reiniciando o runtime e aguardando saúde"
pm2 restart mro-api --update-env >/dev/null || die "PM2 não conseguiu reiniciar mro-api."
READY=false
for _ in $(seq 1 30); do
  if curl -fsS --max-time 3 "http://127.0.0.1:${BACKEND_PORT}/health" >/dev/null; then
    READY=true
    break
  fi
  sleep 1
done
[[ "$READY" == "true" ]] || {
  pm2 describe mro-api || true
  tail -n 120 /var/log/mro/api-error.log 2>/dev/null || true
  die "Backend não ficou saudável após o reinício."
}
ok "Backend saudável."

check_cors() {
  local label="$1" url="$2" method="$3" expected_status="$4"
  local headers body status count origin methods allowed
  headers="$(mktemp)"; body="$(mktemp)"

  if [[ "$method" == "OPTIONS" ]]; then
    status="$(curl -sS --max-time 75 -D "$headers" -o "$body" -w '%{http_code}' -X OPTIONS \
      -H "Origin: $SITE_ORIGIN" \
      -H 'Access-Control-Request-Method: POST' \
      -H 'Access-Control-Request-Headers: apikey,authorization,content-type' \
      "$url" || true)"
  else
    status="$(curl -sS --max-time 75 -D "$headers" -o "$body" -w '%{http_code}' -X POST \
      -H "Origin: $SITE_ORIGIN" \
      -H 'Content-Type: application/json' \
      --data '{"action":"verify_user","username":"__cors_healthcheck__"}' \
      "$url" || true)"
  fi

  count="$(grep -ci '^access-control-allow-origin:' "$headers" || true)"
  origin="$(grep -i '^access-control-allow-origin:' "$headers" | head -1 | tr -d '\r' | cut -d: -f2- | xargs || true)"
  methods="$(grep -i '^access-control-allow-methods:' "$headers" | head -1 | tr -d '\r' || true)"
  allowed="$(grep -i '^access-control-allow-headers:' "$headers" | head -1 | tr -d '\r' || true)"
  printf '  %-18s HTTP %-3s CORS=%s\n' "$label" "${status:-000}" "${origin:-ausente}"

  if [[ "$status" != "$expected_status" || "$count" != "1" || ( "$origin" != "*" && "$origin" != "$SITE_ORIGIN" ) ]]; then
    echo "  allow-methods: ${methods:-ausente}"
    echo "  allow-headers: ${allowed:-ausente}"
    head -c 1500 "$body" 2>/dev/null || true; echo
    rm -f "$headers" "$body"
    return 1
  fi
  if [[ "$method" == "OPTIONS" ]] && { [[ "$methods" != *"POST"* ]] || [[ "${allowed,,}" != *"authorization"* ]] || [[ "${allowed,,}" != *"apikey"* ]] || [[ "${allowed,,}" != *"content-type"* ]]; }; then
    rm -f "$headers" "$body"
    return 1
  fi
  rm -f "$headers" "$body"
}

log "6/6 Testando preflight e POST, local e público"
FAILED=0
check_cors "OPTIONS local" "http://127.0.0.1:${BACKEND_PORT}${FUNCTION_PATH}" OPTIONS 204 || FAILED=1
check_cors "POST local"    "http://127.0.0.1:${BACKEND_PORT}${FUNCTION_PATH}" POST 200 || FAILED=1
check_cors "OPTIONS público" "https://${API_DOMAIN}${FUNCTION_PATH}" OPTIONS 204 || FAILED=1
check_cors "POST público"    "https://${API_DOMAIN}${FUNCTION_PATH}" POST 200 || FAILED=1

if [[ "$FAILED" != "0" ]]; then
  echo
  warn "Diagnóstico automático (sem exibir segredos):"
  pm2 describe mro-api 2>/dev/null | grep -E 'status|script path|exec cwd|restarts|uptime' || true
  tail -n 150 /var/log/mro/api-out.log 2>/dev/null || true
  tail -n 150 /var/log/mro/api-error.log 2>/dev/null || true
  nginx -T 2>/dev/null | grep -nE "server_name .*${API_DOMAIN}|location /functions/v1|proxy_pass http://127.0.0.1" | tail -n 40 || true
  die "CORS ainda inválido em alguma camada; os logs acima identificam onde parou."
fi

ok "CORS da mro-tool-api validado de ponta a ponta."
echo
echo "CONCLUÍDO: extensão -> domínio -> Nginx -> Express -> Deno funcionando sem proxy público."