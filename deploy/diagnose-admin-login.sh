#!/usr/bin/env bash
# Diagnóstico seguro do login administrativo na VPS.
# Não imprime .env, tokens, senhas, corpos de login ou cabeçalhos Authorization.
set -uo pipefail

APP_DIR="${APP_DIR:-/var/www/ia-mro}"
API_URL="${PUBLIC_API_URL:-https://api.maisresultadosonline.com.br}"
SITE_ORIGIN="${SITE_ORIGIN:-https://maisresultadosonline.com.br}"
PORT_LOCAL="${PORT:-8787}"

cd "$APP_DIR" || { echo "ERRO: diretório $APP_DIR não existe"; exit 1; }
echo "=== Diagnóstico do login admin ==="
echo "data_utc: $(date -u +%FT%TZ)"
echo "commit: $(git rev-parse --short HEAD 2>/dev/null || echo desconhecido)"
echo "origin: $(git remote get-url origin 2>/dev/null || echo desconhecido)"

echo "--- PM2 ---"
pm2 describe mro-api 2>/dev/null \
  | grep -E "status|script path|exec cwd|restarts|uptime" \
  || echo "mro-api não localizado no PM2"

echo "--- Portas ---"
ss -lntp 2>/dev/null | grep -E ":(${PORT_LOCAL}|91[0-9]{2})\b" || echo "nenhuma porta esperada localizada"

request() {
  local label="$1" url="$2" method="${3:-GET}" body="${4:-}"
  local headers response status cors content_type
  headers="$(mktemp)"; response="$(mktemp)"
  if [ "$method" = "POST" ]; then
    status="$(curl -sS --max-time 75 -D "$headers" -o "$response" -w '%{http_code}' \
      -X POST -H "Origin: $SITE_ORIGIN" -H "Content-Type: application/json" \
      --data "$body" "$url" 2>/dev/null || true)"
  else
    status="$(curl -sS --max-time 15 -D "$headers" -o "$response" -w '%{http_code}' \
      -H "Origin: $SITE_ORIGIN" "$url" 2>/dev/null || true)"
  fi
  cors="$(grep -i '^access-control-allow-origin:' "$headers" | head -1 | tr -d '\r' | cut -d: -f2- | xargs || true)"
  content_type="$(grep -i '^content-type:' "$headers" | head -1 | tr -d '\r' | cut -d: -f2- | xargs || true)"
  echo "$label: http=${status:-sem_status} cors=${cors:-ausente} tipo=${content_type:-ausente} bytes=$(wc -c < "$response")"
  rm -f "$headers" "$response"
}

INVALID_LOGIN='{"action":"admin_login","email":"deploy-check@invalid.local","password":"deploy-check-invalid"}'
echo "--- Requisições ---"
request "health_local" "http://127.0.0.1:${PORT_LOCAL}/health"
request "login_local" "http://127.0.0.1:${PORT_LOCAL}/functions/v1/lovablack-api" POST "$INVALID_LOGIN"
request "health_publico" "${API_URL%/}/health"
request "login_publico" "${API_URL%/}/functions/v1/lovablack-api" POST "$INVALID_LOGIN"

echo "--- Nginx efetivo ---"
sudo nginx -T 2>/dev/null \
  | grep -nE "server_name .*api\.maisresultadosonline\.com\.br|location /functions/v1|proxy_pass http://127\.0\.0\.1" \
  | tail -n 40 || true

echo "--- Logs recentes (valores sensíveis ocultados) ---"
for log in /var/log/mro/api-error.log /var/log/mro/api-out.log /var/log/nginx/error.log; do
  [ -f "$log" ] || continue
  echo "[$log]"
  tail -n 120 "$log" 2>/dev/null \
    | sed -E \
      -e 's/(authorization|apikey|token|password|secret)([=: ]+)[^ ,;]+/\1\2[OCULTO]/Ig' \
      -e 's/Bearer [A-Za-z0-9._-]+/Bearer [OCULTO]/g'
done