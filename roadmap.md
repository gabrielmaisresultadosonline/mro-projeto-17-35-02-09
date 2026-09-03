# Roadmap

## Concluído
- [x] Login administrativo unificado em `/admin`, `/adminusuario` e `/instagram-nova-admin` validado no backend
- [x] `manage-user-access` protegido por sessão administrativa (era acessível sem login)
- [x] Credenciais administrativas removidas do hub `/admin` e de `adminConfig`
- [x] `deploy.sh` apontando para o repositório atual + verificações de login no deploy

## Pendente
- [ ] Remover senha administrativa hardcoded dos painéis secundários (IAVendeMais, Empresas, ZapMRO Vendas, Instagram Nova Email/Euro, TokensPanel, EstruturaTutoriais, UserHeader, DescontoAlunos, documentação Ads News)

## Login CORS incident
- [ ] Serve admin_login natively in the VPS backend to avoid Deno cold-start/502
- [ ] Validate OPTIONS and POST responses always include CORS
- [ ] Keep existing environment/database credentials unchanged
