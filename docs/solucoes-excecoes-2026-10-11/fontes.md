# Fontes e limites da pesquisa
Consulta em 2026-10-11. Fontes primárias; os desenhos de contrato, política e fila são propostas específicas para PLX, não configurações fornecidas prontas por esses fornecedores.

| Fonte | Fato usado | Limite |
|---|---|---|
| [Google Drive — upload](https://developers.google.com/workspace/drive/api/guides/manage-uploads) | Upload retomável e IDs pré-gerados nas operações suportadas ajudam a recuperar repetição após timeout | Não criam transação com nosso manifesto; validar recurso e permissões após resposta |
| [n8n — queue mode](https://docs.n8n.io/hosting/scaling/queue-mode/) | Workers/Redis e restrições de binários devem ser considerados antes de migrar modo de execução | Fila própria de entrada não é queue mode; verificar edição e armazenamento disponível |
| [n8n — task runners](https://docs.n8n.io/hosting/configuration/task-runners/) | Runners têm configuração própria de execução de tarefas | Saúde do editor não valida Code nodes; configuração do VPS não foi reinspecionada nesta pesquisa |
| [NVIDIA — contratos e troubleshooting](https://docs.nvidia.com/nemo/retriever/latest/extraction/troubleshoot/) | Contratos de entrada e modelos hospedados/self-hosted diferem | Chave existente não comprova acesso, quota, qualidade ou latência |
| [pypdf — extração](https://github.com/py-pdf/pypdf/blob/main/docs/user/extract-text.md) | Extração de texto não substitui OCR de imagens | Separar por página e medir texto útil; não garante entendimento de layout |
| [WAHA — configuração](https://waha.devlike.pro/docs/how-to/config/) | Existem parâmetros de retry de webhooks | Verificar versão/engine instalada; não garante mídia histórica disponível |
| [OWASP — upload](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html) | Validar conteúdo, limites e processamento de arquivos | Não representa auditoria de segurança do ambiente atual |
| [OWASP — prompt injection](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html) | Conteúdo externo pode conter instruções hostis | Separação de dados e permissões continua necessária mesmo com modelo maior |
| [Receita Federal — CNPJ alfanumérico](https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/programas-e-atividades/cnpj-alfanumerico) | Identificador empresarial não pode ser limitado a dígitos | Implementar pela especificação e vetores oficiais; não inferir formato de todos os documentos fiscais |
| [Receita Federal — primeira inscrição alfanumérica](https://www.gov.br/receitafederal/pt-br/assuntos/noticias/2026/julho/receita-federal-gera-o-primeiro-cnpj-em-formato-alfanumerico) | Mudança já tem uso real informado pela Receita | Não implica migração dos CNPJs numéricos existentes |

A página dedicada de webhooks WAHA retornou erro na consulta; por isso a referência utilizada é a documentação oficial de configuração. Não foram usadas promessas de velocidade de posts ou avaliações de terceiros.

## Evidência do projeto

- MCP get_workflow_details: workflow ativo e rascunho coincidentes na versão registrada em evidencias.json.
- Snapshot limitado ao nó de hierarquia, sem credenciais/documentos reais; script reproduz quatro lacunas e um controle.
- Leitura local de plx-ingress-queue/queue_service.py: fila persistente e timeout HTTP de 300s nessa cópia. Não comprova versão instalada.
- Leitura local de oc-queue/job_runtime.py e migrations/003_notification_outbox.sql: peças reutilizáveis, não integração PLX confirmada.
- Memória histórica foi usada para orientar perguntas de recuperação/idempotência; não para certificar runtime atual.

## Como reproduzir o diagnóstico

Na pasta deste pacote:
```sh
node reproduzir-diagnostico.cjs
```

As cinco verificações aprovadas significam que o comportamento problemático foi reproduzido no snapshot. Não significam que as soluções passaram. Todos os testes de aceitação permanecem NAO_EXECUTADO até evidência anexada.
