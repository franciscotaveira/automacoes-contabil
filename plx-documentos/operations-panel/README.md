# Painel interno da operação documental

Publicado em https://automacao.iaparavendas.tech/operacao/.

[Estado e evidências](ENTREGA-2026-10-11.md).

## Componentes
- `collector.py`: executado pelo timer no host; lê fila com SQLite `mode=ro`, metadados de execuções em transação PostgreSQL READ ONLY e saúde dos serviços; somente campos permitidos saem para snapshot.
- `server.py`: processo não privilegiado; recebe somente snapshot e hashes de autenticação em volumes read-only. Não tem socket Docker nem tokens de provedores.
- `data/observations.sqlite3` no VPS: observações desde ativação; não reconstitui eventos ausentes anteriores.
- `static/`: UI sem dependências externas; conteúdo tratado como texto, não HTML.

## Cockpit
- A linha operacional mostra, em ordem, entrada persistida, fila, resultado técnico, referência retornada pelo Drive e confirmação WhatsApp.
- Verde significa que a fonte atual sustenta aquele dado; amarelo pede ação; cinza significa que a etapa ainda não foi reconciliada. Não transforma uma referência do Drive ou o estado `done` em prova de entrega.
- Cada escritório aparece como um cartão clicável. O agrupamento é por `tenant_id`; hoje a fonte legada contém somente `plx`. O próximo escritório deverá entrar por uma fila com `tenant_id` próprio e vínculo explícito de grupo, nunca por inferência de nome.
- A ficha de um arquivo mostra a mesma linha do tempo, os campos registrados e as observações feitas pelo painel. Erros recentes do n8n são deliberadamente globais: o painel não os atribui a um documento sem uma chave de correlação persistida.

## Acesso
Credencial individual do operador interno em `ACESSO-PRIVADO.txt` local, modo 0600. NÃO copiar a senha para Brain, evidências ou repositórios. Autenticação Basic sobre HTTPS; provisória para o painel interno. Gestão de identidades/convites e revogação de sessões deverá preceder portal comercial. Hash scrypt em `config/users.json`; futuras contas recebem tenants explícitos, nunca por parâmetro de URL.

## Testes
`python3 -m unittest -v test_panel.py`
`node --check static/app.js`

## Operação
`systemctl status plx-panel-collector.timer`
`systemctl start plx-panel-collector.service`
`docker compose -f /opt/plx-operations-panel/compose.yaml ps`
Coleta roda 15 segundos após a anterior terminar; painel consulta a cada 15 segundos. Atraso superior a 90 segundos fica sinalizado. Falha de fonte não vira contagem zero confirmada.

## Rollback delimitado
1. Remover apenas redir `/operacao` e handle_path `/operacao/*` do host automacao, restaurando o reverse_proxy n8n nesse host; comparar com Caddyfile do backup. NÃO restaurar o arquivo inteiro sobre mudanças de outros projetos.
2. Validar e recarregar Caddy.
3. Parar timer `plx-panel-collector.timer` e serviço `plx-panel-collector.service`; parar apenas o compose `/opt/plx-operations-panel/compose.yaml`.
4. Preservar data, configurações e backups para auditoria. Não restaurar banco n8n ou fila como parte do rollback do painel; o painel não os alterou.
5. Verificar readiness público n8n e versão ativa do workflow.
