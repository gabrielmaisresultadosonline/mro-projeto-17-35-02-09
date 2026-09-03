#!/usr/bin/env bash
# ============================================================
# Corrige de forma DEFINITIVA o CORS das leituras públicas do Storage
# (/storage/v1/object/public/...), usadas pelas extensões (Ferramenta MRO
# e ZAP MRO) para buscar os avisos em JSON.
#
# Por que existe: quando o Nginx serve esses arquivos como estáticos, a
# resposta sai SEM 'Access-Control-Allow-Origin'. O navegador bloqueia a
# leitura na extensão e o desenvolvedor acaba usando proxies públicos
# (api.allorigins.win, corsproxy.io) que caem toda hora. O backend Express
# já responde o CORS correto — basta o Nginx encaminhar essa rota para ele.
#
# O script NÃO toca em: server/.env, banco de dados, uploads, tokens,
# credenciais, certificados ou qualquer dado existente. Apenas o arquivo
# de vhost do Nginx é ajustado (com backup datado antes).
#
# Uso:
#   sudo bash deploy/fix-storage-cors.sh
#   sudo bash deploy/fix-storage-cors.sh --domain api.exemplo.com --port 8787
# ============================================================
set -euo pipefail

API_DOMAIN="${API_DOMAIN:-api.maisresultadosonline.com.br}"
BACKEND_PORT="${BACKEND_PORT:-8787}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) API_DOMAIN="$2"; shift 2 ;;
    --port)   BACKEND_PORT="$2"; shift 2 ;;
    *) echo "Parâmetro desconhecido: $1" >&2; exit 2 ;;
  esac
done

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m  ✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m  ! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m  ✗ %s\033[0m\n' "$*" >&2; exit 1; }

command -v nginx >/dev/null 2>&1 || die "Nginx não encontrado nesta máquina."
command -v python3 >/dev/null 2>&1 || die "python3 é necessário para editar o vhost com segurança."
[[ "$(id -u)" == "0" ]] || die "Rode como root (sudo)."

# ---------- 1) Backend Express está de pé? ----------
log "1/6 Backend local em 127.0.0.1:${BACKEND_PORT}"
if curl -fsS --max-time 8 "http://127.0.0.1:${BACKEND_PORT}/health" >/dev/null; then
  ok "backend respondeu /health"
else
  warn "backend não respondeu /health — o CORS só funcionará quando ele subir (pm2 status)"
fi

# ---------- 2) Localizar o vhost da API ----------
log "2/6 Localizando o vhost de ${API_DOMAIN}"
VHOST=""
for dir in /etc/nginx/sites-enabled /etc/nginx/sites-available /etc/nginx/conf.d; do
  [[ -d "$dir" ]] || continue
  while IFS= read -r file; do
    if grep -qE "server_name[^;]*(^|[[:space:]])${API_DOMAIN//./\\.}" "$file" 2>/dev/null; then
      VHOST="$(readlink -f "$file")"
      break 2
    fi
  done < <(find "$dir" -maxdepth 1 \( -type f -o -type l \) | sort)
done
[[ -n "$VHOST" ]] || die "Nenhum arquivo do Nginx contém server_name ${API_DOMAIN}."
ok "vhost: ${VHOST}"

# ---------- 3) Backup ----------
log "3/6 Backup do vhost"
BACKUP="${VHOST}.bak-$(date +%Y%m%d%H%M%S)"
cp -a "$VHOST" "$BACKUP"
ok "backup criado: ${BACKUP}"

# ---------- 4) Garantir a rota /storage/v1/object/public/ no proxy ----------
log "4/6 Ajustando a rota pública do Storage para o backend (CORS do Express)"
API_DOMAIN="$API_DOMAIN" BACKEND_PORT="$BACKEND_PORT" VHOST="$VHOST" python3 <<'PY'
import os, re, sys

path = os.environ["VHOST"]
domain = os.environ["API_DOMAIN"]
port = os.environ["BACKEND_PORT"]
text = open(path, encoding="utf-8").read()

BLOCK = """    # CORS das leituras públicas é responsabilidade do backend Express.
    # Encaminhar (e nunca servir como estático) é o que garante o header
    # Access-Control-Allow-Origin para as extensões, sem proxy público.
    location /storage/v1/object/public/ {{
        proxy_pass http://127.0.0.1:{port};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Range $http_range;
        proxy_set_header If-Range $http_if_range;
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_read_timeout 600s;
    }}
""".format(port=port)


def find_blocks(src, header_regex):
    """Devolve (inicio, fim) de cada bloco cujo cabeçalho casa com o regex."""
    out = []
    for m in re.finditer(header_regex, src):
        i = src.find("{", m.end() - 1 if src[m.end() - 1] == "{" else m.start())
        i = src.index("{", m.start())
        depth = 0
        for j in range(i, len(src)):
            if src[j] == "{":
                depth += 1
            elif src[j] == "}":
                depth -= 1
                if depth == 0:
                    out.append((m.start(), j + 1))
                    break
    return out


server_blocks = [
    (s, e) for (s, e) in find_blocks(text, r"(?m)^\s*server\s*\{")
    if re.search(r"server_name[^;]*\b" + re.escape(domain) + r"\b", text[s:e])
]
if not server_blocks:
    sys.exit("Nenhum bloco server com server_name %s." % domain)

changed = 0
# de trás para frente para não invalidar índices
for (s, e) in reversed(server_blocks):
    body = text[s:e]
    existing = find_blocks(body, r"(?m)^\s*location\s+[^{\n]*/storage/v1/object/public/[^{\n]*\{")
    if existing:
        already_proxies = any(
            "proxy_pass" in body[bs:be] and "add_header Access-Control" not in body[bs:be]
            for (bs, be) in existing
        )
        # remove todas as variações antigas e insere a canônica
        for (bs, be) in reversed(existing):
            body = body[:bs] + body[be:]
        if already_proxies:
            print("  (rota já era proxy — reescrita na forma canônica)")
    insert_at = body.rindex("}")
    body = body[:insert_at] + BLOCK + body[insert_at:]
    text = text[:s] + body + text[e:]
    changed += 1

open(path, "w", encoding="utf-8").write(text)
print("  blocos server ajustados: %d" % changed)
PY
ok "vhost reescrito"

# ---------- 5) Validar e recarregar ----------
log "5/6 nginx -t && reload"
if ! nginx -t; then
  cp -a "$BACKUP" "$VHOST"
  die "Configuração inválida — vhost restaurado do backup. Nada foi alterado."
fi
systemctl reload nginx || service nginx reload
ok "Nginx recarregado"

# ---------- 6) Provar que o CORS chegou ao navegador ----------
# Critério de sucesso: o GET (que é o que a extensão realmente faz) precisa
# devolver Access-Control-Allow-Origin. O OPTIONS só importa em requisição
# "não simples" — a extensão usa fetch sem headers customizados, portanto o
# navegador NÃO faz preflight. Um 405 no OPTIONS pelo domínio (típico de
# Cloudflare/CDN, que não repassa OPTIONS) é apenas informativo.
log "6/6 Verificação real de CORS (origem de extensão)"
TEST_PATH="/storage/v1/object/public/user-data/admin/extension-announcements.json"
FAIL=0

check() {
  local method="$1" url="$2" required="$3"
  local headers
  headers="$(curl -s -o /dev/null -D- -X "$method" \
    -H 'Origin: chrome-extension://mro-extension' \
    -H 'Access-Control-Request-Method: GET' \
    --max-time 15 "$url" || true)"
  local status acao
  status="$(printf '%s' "$headers" | awk 'NR==1{print $2}')"
  acao="$(printf '%s' "$headers" | grep -i '^access-control-allow-origin:' | head -1 | tr -d '\r' || true)"
  printf '  %-8s %-70s status=%s | %s\n' "$method" "$url" "${status:-sem-resposta}" "${acao:-sem header (não exigido)}"
  if [[ -z "$acao" && "$required" == "obrigatorio" ]]; then
    FAIL=1
  fi
}

check OPTIONS "http://127.0.0.1:${BACKEND_PORT}${TEST_PATH}" informativo
check GET     "http://127.0.0.1:${BACKEND_PORT}${TEST_PATH}" obrigatorio
check OPTIONS "https://${API_DOMAIN}${TEST_PATH}"            informativo
check GET     "https://${API_DOMAIN}${TEST_PATH}"            obrigatorio

if [[ "$FAIL" == "0" ]]; then
  log "RESULTADO: CORS liberado no GET público (local e domínio)."
  echo "  As extensões podem buscar os avisos direto — sem api.allorigins.win, sem corsproxy.io."
  echo "  Requisito nas extensões: fetch(url, { credentials: 'omit', cache: 'no-store' })"
  echo "  sem headers customizados, e host_permissions no manifest.json (Manifest V3)."
  echo "  Observação: OPTIONS pelo domínio pode responder 405 (CDN não repassa preflight)."
  echo "  Isso é inofensivo, pois requisição simples não dispara preflight."
else
  warn "O GET público ainda não devolve Access-Control-Allow-Origin. Diagnóstico:"
  echo "  - Cloudflare pode estar servindo cache antigo: purgue o cache da rota /storage/v1/object/public/*"
  echo "    e repita: curl -I -H 'Origin: chrome-extension://x' https://${API_DOMAIN}${TEST_PATH}"
  echo "  - Se o header aparece em 127.0.0.1 e não no domínio, é cache/regra do Cloudflare (não do Nginx)."
  echo "  - Se não aparece nem em 127.0.0.1, o backend não está atualizado: cd /var/www/ia-mro && ./deploy.sh --cutover"
  echo "  - Logs úteis (sem segredos): pm2 logs mro-api --lines 50 | grep -i storage"
  exit 1
fi

