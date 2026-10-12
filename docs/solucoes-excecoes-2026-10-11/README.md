# PLX — soluções para exceções da triagem documental

Data: 11/10/2026. Status: **diagnóstico concluído; P0-A validado em staging; produção ainda não alterada**.
Escopo: WhatsApp → preservação → leitura → empresa/departamento/data → Drive → confirmação → relatório.
Sem lançamento no Questor, pagamentos, cálculo de imposto/lucro ou decisão contábil automática.

## Resultado da análise

A prioridade é corrigir a autorização do destino e provar a persistência. A IA pode extrair partes e sugerir categoria; a política cadastrada deve autorizar empresa, pasta e destinatário da notificação.

Esta entrega contém:
- [Diagnóstico e plano](README.md), este arquivo.
- [Decisões de arquitetura](decisoes.md), com alternativas e consequências.
- [Matriz de aceitação](matriz-aceitacao.csv), cenários planejados, não executados.
- [Runbook de validação P0](runbook-validacao-p0.md), testes offline e canário controlado.
- [Contrato proposto](contrato-proposto.json), exemplo deliberadamente desativado.
- [Evidências sanitizadas](evidencias.json) e [reprodução local](reproduzir-diagnostico.cjs).
- [Fontes primárias](fontes.md), limitações dos produtos e capacidades verificadas.

### Execução P0-A em staging — 11/10/2026

[KNOWN] Foi criada a pasta n8n `PLX Contabilidade / Testes isolados`, uma tabela vazia de políticas `plx_p0_politicas_grupo_staging` e o workflow manual inativo [PLX · P0 · Validador de política (staging)](https://automacao.iaparavendas.tech/workflow/FCJaC3PHcJLVIJhs). Ele não possui credenciais, gatilhos publicados, WAHA, Drive ou nós de escrita.

O workflow foi validado estruturalmente e a execução manual `3500` concluiu com sucesso. Os oito casos sintéticos A01–A08 passaram: política ausente, CNPJ exato, CNPJ conflitante, nome parcial, direção incompatível, escopo divergente, política duplicada e CNPJ alfanumérico. A implementação reutilizável correspondente está em `../../policy-resolver.cjs` e `../../policy-resolver.test.cjs`.

Isso valida a regra de decisão em laboratório. Não valida ingestão WAHA, fila, OCR/NVIDIA, Drive, manifesto, notificação ou documentos reais. O workflow produtivo `plxUnifiedV35Draft` permanece ativo e sem mudança nesta etapa.

### P0-B — fila durável em laboratório — 11/10/2026

[KNOWN] O adaptador local `plx-ingress-queue` foi endurecido antes de qualquer publicação: a chave de ocorrência agora exige `tenant_id + operation_id + session_id + group_id + message_id`, e cada execução possui `lease_token` com expiração. Um worker vencido não pode concluir ou alterar uma tarefa reclamada por outro worker.

Foram executados 17 testes locais com sucesso: deduplicação concorrente, isolamento entre tenants, retomada após reinício, retry governado, serialização, autenticação HTTP e bloqueio de conclusão por token de posse vencido. Isso é prova do código em laboratório; não é prova de que a fila em VPS já recebeu essa versão ou que o Drive/WAHA se comportam dessa forma.

### O que foi efetivamente verificado

[KNOWN] O MCP retornou o workflow `plxUnifiedV35Draft` ativo, 87 nós, versão `c9353d7a-6b1c-4294-a521-7752737aa7c2`; o rascunho coincide com a versão ativa. Isso comprova configuração, não processamento correto dos documentos.

| Achado | Evidência | Consequência e solução |
|---|---|---|
| Sem proprietário cadastrado, o nome extraído vira pasta | Reprodução local da hierarquia | Exigir política ativa resolvida no servidor; sem política, retenção restrita por grupo/data |
| Comparação de nomes aceita substring | Reprodução: “Empresa” aceita “Empresa Distinta Ltda” | Identificador exato e aliases aprovados; semelhança serve só como sugestão |
| CNPJ cadastrado sem nome não impede conflito | Reprodução com identificadores fictícios diferentes | Validar identidade independentemente da presença de nome |
| Modo inválido vira received | Reprodução com modo “typo” | Rejeitar configuração inválida; não aplicar padrão silencioso |
| Envelope fixa uma empresa | Nó “Fila · Montar envelope durável” | Carregar cadastro por sessão/grupo e transportar versão imutável da política |
| Nome do destinatário ausente pode receber company_name | Nó “Validar classificação e evidências” | Nunca transformar cadastro em evidência extraída; manter null e procedência |
| Consulta SHA-256 sem escopo explícito | Nó “Consultar documento pelo SHA-256” | Deduplicar dentro do tenant/acervo autorizado; nenhuma referência cruzada entre clientes |
| Confirmação técnica precede download e enfileiramento | Conexões WAHA | Persistir evento autenticado antes do ACK; baixar mídia em tarefa recuperável |
| Manifesto não mapeia direção, proprietário, política e CNPJ destinatário | Mapeamento explícito do nó final | Adicionar campos auditáveis, com migração versionada |
| Normalização remove letras de CNPJ | Código do validador e da hierarquia | Suportar formato numérico e alfanumérico sem destruir caracteres |

Quatro lacunas foram reproduzidas com entradas fictícias no **nó isolado**. Um quinto caso confirmou o bloqueio já existente de CNPJs conflitantes quando o nome também é cadastrado. Isso não demonstra exploração real nem perda de arquivos. Código de teste não corrige nada.

[NOT VERIFIED] Não foram testados neste trabalho o backlog real, as permissões do Drive, o webhook efetivo do WAHA, os últimos documentos, a entrega de mensagens nem restauração do VPS. Os riscos históricos de timeout e recuperação precisam de nova inspeção do serviço em execução.

### Sinal recente do ambiente ativo

[KNOWN] A consulta de execuções em 11/10/2026 mostrou dois webhooks recentes com erro (`3415` e `3417`). Ambos pararam no nó `WAHA · Validar e normalizar` com `Task request timed out`, antes do enfileiramento. O nó contém apenas normalização de JSON; a causa no executor/tarefa não foi confirmada. Não aplicar retry ou ampliar timeout em produção sem diagnosticar a capacidade do runner e o comportamento sob carga.

### Divergência da documentação anterior

`../politica-de-arquivamento-por-grupo.md` descrevia uma política como se toda ela estivesse aplicada. A leitura atual mostra que o envelope não transporta a política, o nome não recebe prefixo EMITIDO/RECEBIDO e a árvore possui Departamento, mas não um nível Tipo. Tratar aquele documento como intenção de arquitetura. Não anunciar proteção integral por empresa antes da homologação.

## 1. Empresa, partes e autorização do destino

Cadastrar no servidor: tenant/escritório, sessão WAHA, grupo, empresas permitidas, raízes Drive, responsáveis, modo e versão da política. Nome do grupo, legenda, áudio e saída da IA não podem modificar esse cadastro.

Modos de grupo:
- **Empresa única:** uma empresa arquivista; arquivo incompatível fica em retenção restrita da operação.
- **Caixa de entrada multiempresa:** somente empresas previamente autorizadas; escolher automaticamente apenas quando existir uma candidata inequívoca e relação comprovada.
- **Teste:** destino de teste isolado, sem criar cadastro real ao encontrar empresa nova.

PLX é o escritório operador, não necessariamente o emissor/destinatário nem o dono econômico do documento. Suzana/Francisco não se tornam clientes do grupo apenas porque aparecem numa nota. A associação precisa estar cadastrada.

### Decisão determinística

1. Autenticar origem e resolver `tenant_id + session_id + group_id`.
2. Exigir política ativa e válida; capturar sua versão no evento.
3. Extrair partes com papel, identificador e trecho/página de evidência.
4. Comparar identificadores completos válidos. CNPJ conflitante prevalece sobre nomes parecidos.
5. Sem identificador, consultar aliases explicitamente aprovados e válidos para aquela empresa e contexto. Homônimos ou evidência fraca exigem revisão.
6. Matriz e filial são estabelecimentos distintos. Raiz comum não autoriza compartilhamento; usar lista explícita.
7. Em received/issued, exigir a parte adequada ao tipo. Em mixed, se ambas as partes forem empresas permitidas, registrar operação interna/ambígua segundo regra cadastrada; nunca escolher a primeira.
8. Nenhuma parte elegível ou mais de uma sem regra: guardar restrito e abrir caso de revisão. Não encaminhar para outro cliente automaticamente.

CNPJ alfanumérico já faz parte do modelo oficial: preservar letras, remover apenas pontuação permitida e implementar o algoritmo oficial com vetores de teste. Não adaptar a chave fiscal de 44 posições por suposição; manter validadores separados por tipo e versão do leiaute. [Receita Federal](https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/programas-e-atividades/cnpj-alfanumerico).

### Relação depende do documento

| Tipo | Partes a extrair | Como decidir acervo e setor |
|---|---|---|
| NF-e/NFS-e | Emitente/prestador e destinatário/tomador | Empresa cadastrada no papel adequado; Fiscal |
| CT-e/MDF-e | Emitente, tomador e demais participantes pertinentes ao leiaute | Matriz de papéis aprovada pelo escritório; não usar qualquer CNPJ encontrado; Fiscal |
| Boleto | Beneficiário, pagador, banco intermediário | Empresa pagadora em recebidos; beneficiária em emitidos; Contábil. Banco não é dono por aparecer primeiro |
| Comprovante | Pagador, recebedor e instituição | Relação explícita com empresa; Contábil; “comprovante” não autoriza baixa/pagamento |
| Extrato | Titular e conta | Titular cadastrado; Contábil; banco é prestador, não proprietário |
| Folha/holerite/admissão | Empregador e funcionário | Vínculo cadastrado e vigência; Folha; acesso restrito |
| Atestado | Pessoa atendida e emissor de saúde | Vínculo autorizado da pessoa com empresa; Folha. Clínica não define destino |
| Recibo/cupom/outro | Partes disponíveis e contexto comprovado | Regra específica; sem evidência suficiente, revisão sem inferir identidade pelo grupo |

## 2. Preservação, datas e pastas

Preservar o binário original, SHA-256 e ocorrência WhatsApp. OCR, recortes e PDFs derivados são artefatos vinculados, nunca substitutos silenciosos.

Registrar separadamente emissão, competência, vencimento, pagamento, recebimento WhatsApp e armazenamento. Cada valor guarda fonte e evidência. Arquivamento usa a data prevista para o tipo; se ausente, usar recebimento no fuso cadastrado, marcado como fallback. Não inventar horário de emissão nem usar UTC truncado para definir o dia local.

Proposta de padrão enxuto, a homologar com o escritório:
`Empresa arquivista / Ano / Departamento / Mês / Dia / arquivo`.
Tipo e direção no nome e manifesto; Tipo como pasta é opção de política, desativada por padrão para não aumentar profundidade.

Nome proposto:
`TIPO - CONTRAPARTE - DATA - NUMERO-ou-ID-CURTO.ext`.
Para emitidos a contraparte é destinatário/tomador; para recebidos, emissor/beneficiário. Identificação pessoal sensível deve ser minimizada. Direção pode receber prefixo quando houver necessidade operacional.

Se empresa é comprovada e falta dado secundário: arquivo permanece no dia/departamento adequado, marcado com atenção e caso de revisão.
Se empresa não é comprovada: retenção restrita `Operação / A revisar / Ano / Mês / Dia de recebimento`, fora das pastas compartilhadas de clientes. Não colocar documento estranho na pasta da empresa do grupo. Após decisão autorizada, mover com registro de antes/depois e reconciliar o manifesto.

Datas, revisão e dono do acervo são dimensões diferentes; um documento nunca deve desaparecer da listagem do dia em que foi recebido.

## 3. Leitura e reforço de IA sem custo em todas as entradas

Rota proposta:
1. XML reconhecido: parser seguro, sem entidades externas/DTD, schema e regras do leiaute.
2. PDF com texto útil: extrair texto e estrutura local; avaliar cobertura de **todas** as páginas.
3. Página digitalizada: renderizar apenas páginas necessárias; rotação/contraste em cópia; OCR.
4. Texto/layout ainda insuficiente: adaptador de visão documental NVIDIA, condicionado a qualidade e orçamento.
5. Texto legível mas classificação ambígua: segunda opinião estruturada; confronto com evidência.
6. Ausência de conteúdo recuperável, conflito de partes ou discordância não resolvida: revisão humana.

PDFs híbridos exigem decisão por página. Converter todo PDF em JPEG degrada texto nativo e aumenta trabalho. pypdf extrai texto, mas não lê caracteres dentro de imagens; por isso a rota de OCR continua necessária. [Documentação pypdf](https://github.com/py-pdf/pypdf/blob/main/docs/user/extract-text.md).

Avaliar Nemotron Parse como candidato de percepção. A NVIDIA documenta diferenças de contrato entre Build hospedado e NIM próprio; suporte de formato no SDK não implica suporte idêntico no endpoint. Validar modelo, entrada, tamanho, timeout e acesso real antes de configurar. Não é necessário instalar GPU no VPS só para chamar uma API. [NVIDIA](https://docs.nvidia.com/nemo/retriever/latest/extraction/troubleshoot/).

Benchmark proposto: amostra autorizada e rotulada pelo escritório com NF, boleto, extrato, atestado, imagem ruim e PDF multipágina. Medir acerto de empresa/papel/tipo/data, evidência por campo, taxa de revisão, p50/p95 por página e documento e custo por arquivo concluído. Selecionar modelo por esses resultados, não pelo tamanho. Confiança declarada pela IA não é probabilidade calibrada.

Limites iniciais são parâmetros a definir no piloto: bytes, páginas, tempo, tentativas e orçamento por documento/cliente. Ao exceder, preservar e abrir pendência; não truncar silenciosamente. Conteúdo do arquivo não pode fornecer instruções ao agente, URLs de saída, credenciais ou destino Drive. [OWASP — prompt injection](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html).

## 4. Arquivos compostos e versões

- PDF com várias notas: detectar fronteiras, produzir documentos filhos com páginas de origem. Preservar o pai e conferir cobertura; incerteza mantém revisão do lote.
- Foto com vários documentos: recortes identificados; texto cortado precisa de reenvio, não de “completar” por IA.
- ZIP: só habilitar após limites de expansão/quantidade, prevenção de path traversal e verificação dos filhos. Hoje não aparece na lista MIME aceita.
- Planilhas: leitura sem macros/fórmulas externas executáveis; mapear abas/linhas; não tratar cada linha como documento automaticamente.
- Áudio/legenda: contexto auxiliar com procedência, nunca prova superior ao documento nem autorização para trocar empresa.
- PDF protegido/corrompido: registrar motivo; solicitar versão legível ou tratamento autorizado em canal apropriado. Não expor senha no grupo ou logs.
- Cancelamento, substituição e segunda via: vincular revisões e eventos ao documento, sem apagar original. Comprovar cancelamento pela evidência disponível; não inferir status fiscal externo.
- SHA igual: reaproveitar arquivo final **no mesmo acervo autorizado**, mantendo nova ocorrência/data.
- Bytes diferentes mas mesma chave fiscal: vincular representações. Hash perceptual/texto similar são candidatos, não autorização para eliminar arquivo.
- Mesmo nome não significa mesmo conteúdo; nome diferente não significa documento novo.

Extensão e MIME declarado não bastam. Validar assinatura, limites de recursos e descompressão, tratar parser como processo isolado e guardar conteúdo suspeito com acesso restrito. [OWASP — arquivos](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html).

## 5. Continuidade e confirmação confiável

### Estados independentes

Recebimento: `ACCEPTED → SOURCE_STORED → EXTRACTED → CLASSIFIED → ROUTED → ARCHIVE_VERIFIED`.
Exceções: `RETRY_WAIT`, `REVIEW_REQUIRED`, `REJECTED_UNSUPPORTED`, `SOURCE_UNAVAILABLE`.
Notificação: `PENDING → DISPATCHING → SENT`, ou `UNKNOWN/FAILED`.
Revisão: `OPEN → ASSIGNED → RESOLVED`, ou `WAITING_CUSTOMER`.

Nenhum estado “done” deve significar simultaneamente extraído, salvo, notificado e revisado. Salvo com atenção é sucesso de preservação e pendência de qualidade.

### Persistência e retomada

- Persistir evento e tarefa em transação antes de ACK 2xx. Evento persistido não significa mídia preservada; baixar prontamente e acompanhar essa lacuna.
- Histórico WAHA/catch-up é reforço, não garantia de recuperar mídia expirada. Registrar cursor, janela, eventos recuperados e impossíveis.
- Workers usam posse temporária renovável e token de execução; resultado de worker antigo não pode sobrescrever execução mais nova.
- Timeout HTTP não prova que tarefa remota parou. Consultar estado pelo job antes de disparar outro processamento.
- Retries limitados e backoff por falha transitória; credencial inválida, ausência de permissão ou arquivo incompatível pedem ação específica.
- Um cliente não pode ocupar toda fila: limite global, limite por tenant e escalonamento justo.
- Não aumentar paralelismo antes de testar concorrência sobre pastas e documentos.

A configuração WAHA oferece políticas de retry; é preciso verificar os parâmetros e o comportamento da versão/engine instalada. Retry não substitui persistência da aplicação. [WAHA](https://waha.devlike.pro/docs/how-to/config/).

### Drive e manifesto sem transação compartilhada

Criar uma intenção persistida de arquivamento, reservar ID quando suportado e gravar correlação. Fazer upload, consultar arquivo por ID e confirmar parent esperado, nome, tamanho/integridade e escopo; só então persistir `ARCHIVE_VERIFIED` e a intenção de notificação numa transação local.

Se o Drive salvou e a resposta se perdeu, reconciliar antes de repetir. IDs pré-gerados permitem repetição sem outra cópia nas operações compatíveis; uploads retomáveis ajudam em interrupções. HTTP 409 exige conferir o objeto, não assumir sucesso cego. [Google Drive](https://developers.google.com/workspace/drive/api/guides/manage-uploads).

Pastas: índice único lógico `tenant + parent_id + chave_do_segmento`, reserva e bloqueio por chave; guardar Drive ID, não depender só do nome. Duplicata existente precisa de reconciliação reversível, sem exclusão automática.

### Outbox de mensagens

A confirmação deve derivar de `ARCHIVE_VERIFIED`. Chave única por ocorrência/tipo/revisão evita reenvio pelo nosso sistema. Timeout depois de enviar pode deixar estado UNKNOWN: consultar recibo quando possível, sem prometer “exactly once” do provedor.

Exemplos propostos:
- “Documento X salvo em Empresa / 2026 / Fiscal / Outubro / 11. [link autorizado]”
- “Documento X salvo com atenção: data de emissão não identificada. Protocolo DOC-123.”
- “Documento X já estava arquivado. Reenvio registrado, sem nova cópia.”
- “Documento X preservado para revisão de vínculo. Protocolo DOC-123.”

Dados de outra empresa, CPF e informação de saúde não entram no aviso público do grupo. Aviso de retenção não diz que foi salvo na pasta final. Falha de notificação não refaz OCR/upload.

## 6. Revisão, checklist e relatório

Toda pendência tem motivo legível, responsável, prazo definido pelo escritório, próxima ação, histórico e arquivo recuperável. Revisão de identidade tem prioridade sobre estética do nome.

Correção no WhatsApp exige remetente autorizado, referência inequívoca do documento, escopo de empresa e confirmação quando mudar destino. Registrar valor anterior/novo, autor e evidência. Uma correção não altera aliases/regras globais automaticamente.

Checklist recorrente é módulo separado: obrigações esperadas por cliente, competência, categoria e prazo. “Arquivo recebido” não quita exigência se empresa/período não conferem. Documento cancelado, duplicado ou insuficiente não deve mascarar falta. Cobranças só para pessoas autorizadas, respeitando janelas e suspensão em erro do próprio sistema.

Relatório às 18h usa fuso do cliente, watermark e período explícitos. Não espera indefinidamente documentos em andamento nem os omite:
- ocorrências recebidas;
- arquivos únicos novos e reenvios;
- documentos lógicos por categoria;
- guardados com atenção, retidos, em processamento e falhos;
- pendências atribuídas e notificações ainda não confirmadas.

Sem valores, impostos ou lucro, conforme escopo decidido. Pai com três notas pode representar 1 arquivo recebido e 3 documentos; mostrar unidades separadas. Fechamento é snapshot versionado; atrasados geram complemento auditável. Conferir IDs do manifesto com Drive; não contar apenas execuções verdes.

## 7. Isolamento, recuperação e encerramento

Identidade do tenant vem da configuração autenticada do canal; nunca do corpo fornecido por usuário/modelo. Aplicar escopo nas consultas, chaves únicas, caches, logs, hash, revisão, links e notificações. Validar que a raiz Drive pertence à autorização daquela operação.

Documentos de Folha ficam disponíveis apenas aos responsáveis desse setor; não herdar compartilhamento amplo sem validação. Para uso de IA externa, definir no contrato quais documentos podem sair, acesso e retenção. Prazo de guarda deve ser acordado com o escritório por categoria; este plano não cria prazo legal universal.

Offboarding: suspender novas entradas daquele cliente, exportar arquivos/manifesto/pendências, conferir contagens e integridade, revogar acessos específicos e aplicar retenção acordada. Não derrubar WAHA compartilhado ou remover dados de outros tenants.

Backup recuperável inclui banco operacional, políticas, workflow, referências de arquivos, configuração e chaves de criptografia sob proteção. Drive sozinho não recompõe o histórico. Exercício de restauração em ambiente isolado deve medir perda máxima de dados e tempo de recuperação; valores contratuais só depois de medir.

## 8. Implementação em ordem e gate comercial

| Etapa | Entrega | Responsável proposto | Aceitação |
|---|---|---|---|
| P0-A | Política por grupo; papéis por tipo; identidade sem substring; CNPJ moderno | Engenharia + escritório valida cadastros | Casos E01–E05, E13, E26–E30, E35–E36 sem destino incorreto |
| P0-B | Persistência antes do ACK, idempotência por escopo, posse da tarefa, reconciliação Drive | Backend/operação | Falhas E16–E21, E31–E33 recuperadas sem perda silenciosa |
| P0-C | Confirmação após verificação, outbox, revisão atribuída, fechamento reconciliado | Backend + operação contábil | E17–E18, E22–E24 e E34 com rastreabilidade |
| P0-D | Isolamento, permissões e ensaio de restauração | Infra + responsável pelo cliente | E14–E15, E25–E26 e E37–E38 aprovados |
| P1 | PDF composto, versões, CPF/vínculos e reforço visual medido | Leitura documental + escritório | E06–E13 e E39–E40 aprovados no corpus rotulado |
| P2 | Aumentar throughput e habilitar formatos adicionais | Engenharia | Ganho medido sem degradar P0; custo por cliente visível |

Para piloto pago assistido: escopo de formatos declarado, todas as entradas contabilizadas, destinos corretos, pendências com dono, recuperação provada, confirmação verdadeira e aceitação do escritório. Cenários não suportados devem ser explicitamente tratados, não ignorados. Para operação autônoma ampliar cobertura e medir estabilidade no volume contratado. Nada neste documento garante ausência absoluta de quebra.

Preservar versão/export seguro antes de implementar, aplicar primeiro em teste com política inativa, rodar matriz, depois canário de uma operação autorizada e reconciliar. Rollback precisa abranger política e efeitos externos, não somente versão n8n. Mudanças de pasta antigas são migração separada com simulação e manifesto de movimentos.

## 9. Redução de complexidade

Manter no n8n etapas observáveis: receber, preservar, ler, decidir, arquivar, notificar e reconciliar. Concentrar regras puras em módulos versionados e testáveis; evitar copiar lógica por empresa. Não fundir efeitos externos numa caixa opaca só para reduzir a contagem de nós.

Já existem localmente peças reutilizáveis em `outputs/operacoes-conversacionais-v1/oc-queue/`: `job_runtime.py` tem posse temporária e `migrations/003_notification_outbox.sql` tem unicidade por tenant/operação/ação. **Presença local não comprova integração na PLX nem publicação no VPS.** Avaliar contratos e testes antes de reaproveitar.

Não instalar outra pilha de filas como primeiro passo. Fila de entrada própria, fila de execução do n8n e fila de notificações têm finalidades distintas. Queue mode n8n envolve Redis/workers e restrições de armazenamento binário; só adotar se carga e edição disponível justificarem. [n8n](https://docs.n8n.io/hosting/scaling/queue-mode/).

Próxima ação concreta: corrigir e homologar P0-A usando os casos reproduzidos, mantendo a operação existente preservada até o novo caminho passar pelos gates.
