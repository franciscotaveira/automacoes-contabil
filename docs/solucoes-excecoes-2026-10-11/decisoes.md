# Decisões propostas — PLX
Data: 2026-10-11. Todas **PROPOSTAS**, não implantadas nem homologadas.
Aplicação da skill architecture-decision-records. Revisão junto com [plano](README.md) e [matriz](matriz-aceitacao.csv).

## ADR-01 — Destino autorizado por cadastro e papéis

**Contexto:** o workflow aceita fallback de nome e compara substring; grupo de teste não equivale a cadastro de todas as empresas.

**Alternativas:** IA decide tudo (flexível, não garante isolamento); empresa fixa no código (simples, não replica); política versionada por grupo e papéis por categoria (mais cadastro inicial, decisão auditável).

**Decisão proposta:** terceira opção. Identificador exato, alias aprovado e vínculo explícito; ausência/conflito resulta em retenção restrita. Documento de terceiro nunca cria autorização de acesso.

**Consequências:** exige onboarding mínimo, tratamento de filiais/pessoas e preservação da evidência; reduz risco de arquivo no cliente errado sem pedir organização manual a cada envio.

**Aceitação:** E01–E05, E13, E26–E30, E35–E36. Schema exemplificado em contrato-proposto.json não substitui implementação de validação.

## ADR-02 — Estado durável e efeitos reconciliáveis

**Contexto:** Drive, banco e WhatsApp não compartilham transação. Repetir toda a execução pode criar cópias e mensagens.

**Alternativas:** retry do workflow inteiro (barato, efeitos duplicados); prometer transação distribuída/exactly-once (não sustentado pelos provedores); ledger de intenções, operações idempotentes e outbox (mais estados, recuperação auditável).

**Decisão proposta:** ledger/outbox, separando ocorrência, conteúdo, documento lógico, arquivo final, revisão e mensagem. ACK somente após evento/tarefa persistidos. Timeout incerto exige reconciliação.

**Consequências:** transações locais e índices únicos; consulta posterior ao Drive; UNKNOWN de notificação. Não garante entrega única em todos os casos do provedor.

**Reuso:** avaliar job_runtime.py e notification_actions locais do módulo OC; não assumir compatibilidade ou publicação PLX. Escolher banco após verificar runtime; não escrever nas tabelas internas do n8n por fora de suas interfaces.

**Aceitação:** E16–E21, E24, E31–E34, E37. Referências: Google Drive e WAHA em fontes.md.

## ADR-03 — IA por exceção e validação por campo

**Contexto:** documento ilegível, papel ambíguo e indisponibilidade de serviço são problemas diferentes.

**Alternativas:** tudo em grande agente com MCP (flexibilidade, custo e efeitos menos previsíveis); somente OCR (barato, insuficiente para layout/semântica); extração determinística + visão e raciocínio sob demanda (contratos adicionais, custo controlado).

**Decisão proposta:** rota híbrida com evidência por campo e orçamento; modelo sem autorização para escolher raiz, credencial ou destinatário. Nemotron Parse é candidato, não vencedor de benchmark.

**Consequências:** manter adaptadores intercambiáveis, corpus autorizado/rotulado e métricas de qualidade/latência/custo. Não instalar GPU no VPS sem justificativa.

**Aceitação:** E06–E10, E13, E38–E40. Referências: NVIDIA, pypdf e OWASP.

## ADR-04 — Original preservado e derivados rastreáveis

**Contexto:** arquivo pode ter vários documentos; novas fotos podem ser outra representação do mesmo documento.

**Alternativas:** substituir por PDF convertido (perde fidelidade); guardar tudo como independente (duplica organização); original imutável + filhos/revisões/representações (mais metadados, auditável).

**Decisão proposta:** terceira opção. SHA por conteúdo dentro do acervo; vínculo semântico separado. Similaridade sugere revisão, nunca exclusão automática.

**Consequências:** relatório distingue ocorrências, arquivos e documentos. Cancelamento/revisão não apaga histórico. Políticas de retenção são configuradas com o escritório.

**Aceitação:** E06–E12, E24–E25, E39–E40.

## ADR-05 — Fluxo enxuto por responsabilidades

**Contexto:** 87 nós incluem repetição de criação de pastas; reduzir quantidade sem preservar observabilidade pode esconder falhas.

**Alternativas:** adicionar um nó/ramificação por exceção (difícil manter); monolito de IA (pouca previsibilidade); etapas estáveis com regras puras versionadas (contratos e testes necessários).

**Decisão proposta:** manter etapas visíveis no n8n; regras de identidade, data e nome em módulos puros; efeitos externos com retomada explícita. Uma política por cliente, não uma cópia de código por cliente.

**Consequências:** componentes OC podem ser reutilizados após revisão. Não introduzir Redis/queue mode só por expectativa de escala: medir carga e verificar suporte da edição.

**Aceitação:** nenhum ganho de desempenho invalida testes P0. Medir p95 e custo antes/depois.

## ADR-06 — Pendência continua no processo

**Contexto:** mover para “Revisar” sem responsável pode apenas esconder documentos.

**Alternativas:** exigir reenvio sempre (transfere trabalho ao cliente); arquivar como resolvido (omite risco); preservar no dia apropriado com caso atribuído (exige operação de revisão).

**Decisão proposta:** terceira opção quando dono comprovado; identidade incerta fica em retenção restrita por data de recebimento. Mensagem mínima no grupo e detalhe apenas para responsáveis.

**Consequências:** checklist não é quitado por qualquer anexo; fechamento mostra pendências e itens ainda em processamento. Cobrança automática depende de regras e autorização específicas.

**Aceitação:** E14, E22–E25; usuário valida política de datas, responsável e prazo antes da ativação.
