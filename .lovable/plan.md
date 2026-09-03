# Corrigir definitivamente os logins administrativos

## Objetivo
Fazer `/admin`, `/adminusuario` e `/instagram-nova-admin` autenticarem pelas credenciais já existentes na VPS/PostgreSQL, sem colocar senha no bundle do navegador e sem alterar banco, uploads ou secrets.

## Implementação
1. Corrigir o repositório oficial em `deploy.sh` para o GitHub atual, impedindo que o deploy restaure código antigo.
2. Criar autenticação administrativa nativa no backend para os endpoints usados pelos três painéis, lendo apenas as credenciais existentes no ambiente e/ou configuração do PostgreSQL.
3. Emitir sessões HMAC com expiração e validar comparações de forma segura; nenhuma senha será devolvida ao navegador ou gravada no storage.
4. Remover credenciais administrativas hardcoded dos fluxos frontend afetados e reutilizar somente o token de sessão retornado pelo backend.
5. Adicionar verificações de deploy para confirmar os dois endpoints de login sem imprimir valores sensíveis.

## Validação
- Testar login inválido e contrato de resposta dos endpoints.
- Confirmar que o build passa e que não há senha administrativa no bundle gerado.
- Confirmar que o deploy preserva `server/.env`, PostgreSQL e uploads e usa o repositório novo.

## Detalhes técnicos
- `/admin` e `/adminusuario`: sessão com escopo `mro-main-admin`.
- `/instagram-nova-admin`: sessão com escopo `instagram-admin`.
- O corpo de login continuará protegido por HTTPS; credenciais não serão hardcoded, logadas nem retornadas pelas APIs.
