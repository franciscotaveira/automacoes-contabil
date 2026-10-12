# Plano de transformação comercial — Triagem documental por WhatsApp

**Data:** 2026-10-04
**Base técnica:** operação PLX V3.5 e auditoria atual de 2026-10-04
**Decisão:** existe oportunidade comercial concreta, mas o produto ainda precisa atravessar gates técnicos, operacionais, contratuais e econômicos antes de ser vendido como serviço confiável.

## 0. Resumo executivo

O ativo comercial não é um “workflow de n8n”. É um serviço de **recepção, triagem, organização e rastreabilidade documental a partir do WhatsApp**.

Para uma contabilidade, o resultado vendido é:

> Todo documento recebido no grupo é identificado, preservado, classificado por empresa, setor e data, encaminhado para a pasta correta e convertido em uma pendência explícita quando a máquina não consegue decidir com segurança.

Esse recorte é valioso porque remove trabalho repetitivo sem prometer substituir o sistema contábil, o lançamento no Questor ou a decisão humana. A solução fica entre o WhatsApp desorganizado e o sistema oficial da contabilidade.

### Parecer comercial atual

- **Oportunidade:** alta.
- **Produto demonstrável:** sim, em laboratório.
- **Piloto assistido pago:** possível depois dos bloqueadores críticos e de uma homologação real com a PLX.
- **Venda em escala:** ainda não.
- **Modelo recomendado:** implantação + mensalidade gerenciada + franquia de documentos/IA.
- **Posicionamento:** serviço operacional especializado, não software genérico nem “robô de IA”.

## 1. Problema econômico resolvido

### Antes

1. cliente envia fotos, PDFs, boletos, atestados e comprovantes no grupo;
2. alguém abre cada arquivo;
3. tenta entender empresa, setor e data;
4. baixa e renomeia;
5. cria ou procura pastas;
6. encaminha para outra pessoa lançar no sistema;
7. repete o processo para arquivos duplicados;
8. não possui uma lista confiável do que ficou ilegível ou pendente.

### Depois

1. o grupo continua sendo usado normalmente;
2. a automação registra a ocorrência;
3. preserva o original;
4. identifica o documento e extrai evidências;
5. organiza no Drive;
6. marca o que precisa de atenção;
7. consolida o fechamento diário;
8. mantém rastreabilidade entre mensagem, arquivo, decisão e destino.

### Unidade de valor

O valor deve ser demonstrado em **minutos administrativos economizados e redução de documentos esquecidos**, e não em quantidade de nós do n8n.

Fórmula de ROI para cada cliente:

```text
economia mensal estimada =
  documentos por mês
  × minutos manuais médios por documento
  × custo por minuto do operador
  × percentual automatizado sem revisão

valor protegido =
  retrabalho evitado
  + prazos não perdidos
  + redução de procura por documentos
  + rastreabilidade para conferência
```

Os valores precisam ser medidos no piloto. Não há evidência atual suficiente para prometer um percentual específico de economia.

## 2. Produto inicial recomendado

### Nome funcional

**Inbox Documental para Contabilidades**

Nome comercial pode mudar. A descrição precisa continuar concreta:

> Triagem automática dos documentos que seus clientes enviam pelo WhatsApp, com organização no Drive e fila de atenção para sua equipe.

### Escopo V1 vendável

- um escritório contábil;
- número dedicado do WhatsApp;
- grupos previamente autorizados;
- empresas atendidas previamente cadastradas;
- imagens, PDF e XML dentro dos limites contratados;
- setores Fiscal, Contábil e Pessoal;
- identificação de categoria, emitente, empresa atendida e data;
- hierarquia de pastas configurável;
- deduplicação por conteúdo dentro do cliente correto;
- fila de documentos que precisam de revisão;
- relatório diário com recebidos, organizados, pendentes e falhas;
- suporte e monitoramento definidos em contrato;
- exportação ou integração posterior com o sistema contábil.

### Fora do escopo V1

- lançar automaticamente no Questor;
- pagar boletos;
- garantir validade fiscal ou contábil;
- decidir sozinho sobre documentos ambíguos;
- aceitar PDFs com vários documentos sem revisão;
- substituir backup legal ou gestão documental oficial;
- funcionar sem supervisão durante o piloto;
- prometer disponibilidade de canal não oficial como se fosse uma API da Meta.

Essa fronteira reduz risco e acelera a primeira venda.

## 3. Cliente ideal inicial

### Perfil prioritário

- escritório com 5 a 50 colaboradores;
- recebe documentos por vários grupos de WhatsApp;
- possui pessoa dedicada a abrir, baixar e separar arquivos;
- usa Drive, OneDrive ou estrutura semelhante antes de lançar no ERP contábil;
- sente retrabalho com documentos repetidos, ilegíveis e fora de contexto;
- consegue indicar um responsável por revisar exceções;
- aceita iniciar com um conjunto delimitado de grupos e empresas.

### Sinais de alta urgência

- mais de uma hora diária gasta em triagem;
- documento perdido no histórico do grupo;
- equipe pergunta repetidamente “isso já foi salvo?”;
- fechamento depende da memória de uma pessoa;
- cliente envia boletos, comprovantes e documentos trabalhistas no mesmo canal;
- crescimento da carteira exige contratar alguém apenas para organização.

### Mau cliente inicial

- exige lançamento contábil totalmente automático no primeiro dia;
- não aceita revisar exceções;
- usa número pessoal crítico que não pode correr risco de bloqueio;
- não consegue definir empresa, grupos, taxonomia ou responsável;
- quer misturar documentos de várias organizações sem isolamento de dados;
- exige SLA empresarial antes de infraestrutura, backup e suporte compatíveis.

## 4. Arquitetura do produto replicável

```text
Canal de entrada
  -> adaptador WAHA/grupo ou outro canal
  -> registro durável da ocorrência
  -> armazenamento do original
  -> fila e retries
  -> leitor documental substituível
  -> classificador e regras determinísticas
  -> decisão: organizado | atenção | falha
  -> destino do cliente (Drive/OneDrive/S3)
  -> manifesto operacional
  -> revisão humana
  -> relatório e observabilidade
```

### Núcleo compartilhável

- schemas de documento;
- fila e idempotência;
- extração híbrida;
- validações de CNPJ, chave fiscal, data e tipo;
- construção de caminho e nome;
- fechamento e métricas;
- suíte de testes e runbook.

### Configuração isolada por cliente

- identificador do ambiente e cliente;
- grupos autorizados;
- empresas e CNPJs atendidos;
- pasta raiz e credenciais;
- setores e tipos aceitos;
- regra de data por tipo;
- limiar de confiança;
- modelo/provedor de IA;
- responsáveis e SLA de revisão;
- mensagens e horários;
- limites de volume, páginas e tamanho.

Nenhum novo cliente deve ser criado copiando segredos, IDs fixos ou tabelas da PLX.

## 5. O que falta para comercializar

### Gate A — Integridade documental

- separar completamente produção e benchmark;
- escopar idempotência e SHA por ambiente + cliente + empresa/grupo;
- persistir o recebimento antes de confirmar o webhook;
- impedir retries sobrepostos;
- garantir finalização recuperável entre Drive e manifesto;
- validar o canônico antes de declarar duplicidade;
- tornar exclusão de temporário segura;
- sinalizar truncamento e múltiplos documentos.

**Saída exigida:** cada documento aceito termina localizado, recuperável e classificado ou em uma pendência explícita.

### Gate B — Operação humana

- fila única de atenção;
- responsável, prazo e resolução registrados;
- estados diferentes para erro técnico, baixa confiança e decisão operacional;
- fechamento que inclua recebidos, processados, pendentes, retries e falhas;
- procedimento para corrigir tipo, empresa, data e destino;
- procedimento de reprocessamento sem duplicar arquivos.

**Saída exigida:** a equipe sabe exatamente o que fazer quando a automação não conclui.

### Gate C — Infraestrutura e continuidade

- VPS ou servidor aprovado para produção;
- serviços com restart policy, healthchecks e alertas;
- backup off-host de configuração, fila e manifesto;
- teste de restauração;
- retenção definida;
- monitoramento do WhatsApp, IA, n8n, fila e armazenamento;
- inventário de credenciais e rotação.

**Saída exigida:** uma queda não transforma documentos em perdas invisíveis.

### Gate D — Canal WhatsApp

- número dedicado por operação ou estratégia de sessões isoladas;
- risco do WAHA aceito formalmente pelo cliente;
- contingência para desconexão, QR, bloqueio ou mudança de protocolo;
- API protegida, nunca exposta diretamente;
- avaliar canal alternativo de envio, como e-mail ou portal, para continuidade.

WAHA é gratuito e aberto, mas não é o canal oficial da Meta. A própria documentação informa que automação de grupos não deve ser considerada totalmente segura. A vantagem é o acesso aos grupos; o risco é a dependência de um cliente não oficial.

### Gate E — IA e licenciamento

- provedor de produção contratado;
- custo e limite por documento medidos;
- fallback configurado;
- modelo intercambiável;
- política de envio de dados a terceiros;
- avaliação humana de acurácia por tipo documental.

As APIs gratuitas da NVIDIA são adequadas à prototipagem. A documentação atual da NVIDIA informa que produção requer NVIDIA AI Enterprise ou outro acordo comercial. Portanto, a chave gratuita atual não pode sustentar a promessa comercial.

### Gate F — Segurança, privacidade e contrato

- contrato definindo finalidade, controlador, operador e suboperadores;
- autorização para NVIDIA, Google e outros fornecedores usados;
- política de acesso, retenção, incidente e exclusão;
- pasta e credenciais pertencentes ou dedicadas ao cliente;
- termo claro de que a classificação é assistência operacional;
- limites de responsabilidade e do SLA;
- procedimento de término do contrato e exportação dos dados.

Em regra, a contabilidade decide a finalidade e atua como controladora; o prestador que processa em seu nome tende a atuar como operador. A definição jurídica final deve ser feita no contrato com orientação adequada.

### Gate G — Evidência comercial

- piloto real da PLX com amostra aprovada;
- medição antes/depois;
- taxa de automação sem revisão;
- tempo médio economizado;
- taxa de falha e duplicidade;
- depoimento ou aceite formal;
- demonstração com documentos sintéticos ou anonimizados.

**Saída exigida:** um estudo de caso que venda resultado, sem expor documentos do cliente.

## 6. Caminho de liberação

### Fase 1 — Homologar a PLX

1. corrigir bloqueadores críticos da auditoria;
2. testar em ambiente isolado os cenários de falha;
3. processar 10–20 documentos reais variados com supervisão;
4. obter avaliação humana de tipo, setor, data, empresa e destino;
5. medir tempo manual anterior e tempo de revisão atual;
6. manter mensagens automáticas não essenciais desligadas;
7. documentar aceite e pendências.

**Gate:** nenhuma perda, duplicação incorreta ou cruzamento de dados; toda exceção visível.

### Fase 2 — Piloto comercial assistido

1. implantar em infraestrutura de produção;
2. definir janela de suporte;
3. operar um ou poucos grupos;
4. revisar diariamente métricas e pendências;
5. cobrar implantação e mensalidade piloto;
6. limitar volume e tipos no contrato.

**Gate:** 30 dias de operação com relatório e aceite da PLX.

### Fase 3 — Produto replicável

1. retirar IDs e regras específicas dos Code nodes;
2. criar cadastro/configuração por cliente;
3. automatizar onboarding, healthcheck e backup;
4. versionar templates;
5. criar painel de revisão e operação;
6. implantar um segundo escritório sem duplicar workflow manualmente.

**Gate:** segundo cliente configurado sem alterar o núcleo.

### Fase 4 — Escala

1. separar dev, homologação e produção;
2. substituir Data Tables por armazenamento com integridade e auditoria adequadas;
3. fila e workers dimensionáveis;
4. billing por franquia/consumo;
5. suporte, incidentes e atualização de conectores;
6. canal oficial quando o caso de uso permitir.

## 7. Oferta comercial sugerida

### Produto 1 — Diagnóstico e implantação

Inclui:

- mapeamento do processo;
- cadastro de empresas, grupos e setores;
- desenho da taxonomia;
- conexão do WhatsApp e Drive;
- configuração da leitura e classificação;
- testes assistidos;
- treinamento da equipe;
- documentação e aceite.

Cobrança: valor único de implantação, calculado por complexidade, quantidade de empresas/grupos, integrações e migração.

### Produto 2 — Operação gerenciada mensal

Inclui:

- hospedagem;
- monitoramento;
- backups;
- atualizações;
- franquia de documentos;
- suporte;
- relatório mensal;
- ajustes pequenos de regras.

Cobrança: mensalidade base + faixa de volume + excedente.

### Produto 3 — Integrações adicionais

- OneDrive/SharePoint;
- ERP ou sistema contábil;
- e-mail e portal de contingência;
- aprovação de documentos;
- alertas de vencimento;
- conciliação de comprovantes;
- painel gerencial.

Cobrança: implantação adicional e possível aumento de mensalidade.

## 8. Precificação sem chute

Ainda não há dados para fixar preço definitivo. O primeiro piloto deve produzir a planilha de custo e valor.

### Custo mensal mínimo

```text
VPS e backups
+ domínio/monitoramento
+ provedor de IA/OCR
+ armazenamento
+ suporte humano esperado
+ reserva de manutenção do WAHA e n8n
+ impostos e meios de pagamento
= custo total da conta
```

### Preço mínimo sustentável

```text
preço mensal =
  custo total direto
  + margem de suporte e evolução
  + prêmio pelo valor econômico gerado
```

### Faixas para testar, não publicar ainda

| Oferta | Hipótese inicial | Uso |
|---|---:|---|
| Implantação simples | R$ 2.500–5.000 | um cliente, poucos grupos, Drive, taxonomia padrão |
| Implantação avançada | R$ 6.000–15.000+ | várias empresas, migração e integrações |
| Mensalidade assistida | R$ 600–1.500 | volume baixo, suporte limitado |
| Mensalidade gerenciada | R$ 1.500–4.000+ | monitoramento, backup, SLA e maior volume |

Essas faixas são hipóteses de teste. O preço deve ser comparado ao custo atual da triagem e validado nas entrevistas, nunca apresentado como tabela definitiva antes de medir volume, IA e suporte.

## 9. Contrato operacional mínimo

O contrato deve registrar:

1. grupos, empresas, formatos e volumes incluídos;
2. horário de operação e suporte;
3. prazo de processamento e revisão;
4. responsabilidades do escritório;
5. responsabilidade pela conferência antes do lançamento;
6. limites para arquivos ilegíveis, múltiplos ou fora do escopo;
7. uso de WAHA e risco do canal;
8. fornecedores de IA e armazenamento;
9. retenção e backup;
10. incidente, indisponibilidade e força maior;
11. propriedade e exportação dos dados;
12. reajuste por volume e custo de fornecedor;
13. encerramento e remoção de acessos;
14. proibição de usar a automação como validação fiscal definitiva.

## 10. Métricas que tornam o produto vendável

### Operacionais

- documentos recebidos;
- documentos organizados sem revisão;
- documentos em atenção;
- falhas técnicas;
- duplicatas detectadas;
- tempo p50 e p95;
- backlog atual;
- tempo até resolução humana;
- arquivos órfãos;
- disponibilidade de cada componente.

### Econômicas

- minutos manuais antes e depois;
- custo humano evitado;
- custo de IA por documento;
- custo total por cliente;
- margem bruta;
- excedente por volume;
- chamados de suporte por cliente.

### Qualidade

- acerto de tipo;
- acerto de setor;
- acerto de empresa/emitente;
- acerto de data;
- acerto de destino;
- falsos “organizado”;
- falsos duplicados;
- documentos perdidos, cuja meta deve ser zero.

## 11. Soluções adjacentes reutilizando o núcleo

Depois de homologar a triagem, o mesmo núcleo pode originar produtos específicos:

| Segmento | Entrada | Classificação/destino | Resultado vendido |
|---|---|---|---|
| Departamento pessoal | atestados, admissões, férias | colaborador, empresa, tipo, competência | documentos prontos para processamento da folha |
| Financeiro | boletos e comprovantes | fornecedor, vencimento, centro de custo | caixa de entrada financeira organizada |
| Transportadoras | CT-e, MDF-e, canhotos | viagem, placa, cliente, data | dossiê operacional por viagem |
| Imobiliárias | contratos, vistorias, comprovantes | imóvel, locatário, competência | pasta documental por imóvel |
| Clínicas | guias, pedidos, laudos administrativos | paciente, convênio, tipo, data | pré-triagem administrativa com controles adicionais |
| Jurídico | contratos, procurações, intimações | cliente, processo, prazo | entrada documental e alerta de prazo |
| Construção | notas, medições, recibos | obra, fornecedor, competência | dossiê financeiro por obra |
| Condomínios | notas, boletos, atas | condomínio, categoria, período | prestação de contas organizada |

Cada vertical exige taxonomia, regras, validações e contrato próprios. O núcleo é reutilizável; a promessa comercial não deve ser genérica.

## 12. Estratégia de venda

### Demonstração

Usar documentos sintéticos/anonimizados e mostrar:

1. envio no WhatsApp;
2. entrada registrada;
3. leitura e classificação;
4. pasta e nome criados;
5. duplicata reconhecida;
6. documento ilegível indo para atenção;
7. relatório do dia;
8. trilha de auditoria.

### Perguntas de diagnóstico comercial

1. Quantos grupos recebem documentos diariamente?
2. Quantos documentos chegam por mês?
3. Quem abre e organiza hoje?
4. Quanto tempo essa pessoa gasta?
5. Quais documentos mais confundem?
6. Quantos precisam ser procurados novamente?
7. Qual sistema recebe os dados depois?
8. Quem revisará as exceções?
9. Quais prazos não podem ser perdidos?
10. O número pode ser dedicado à operação?

### Prova de valor

Executar uma semana de medição do processo atual e uma semana assistida. Apresentar:

- horas economizadas;
- documentos processados;
- percentual sem intervenção;
- exceções corretamente detectadas;
- falhas e correções;
- custo mensal projetado;
- retorno esperado.

## 13. Decisões firmes

1. Não vender “IA que entende qualquer documento”. Vender uma triagem delimitada e auditável.
2. Não vender o workflow; vender implantação, operação e resultado.
3. Não colocar vários clientes na mesma tabela, credencial ou pasta raiz.
4. Não usar crédito gratuito da NVIDIA como base do preço de produção.
5. Não esconder o risco do WAHA; usar número dedicado, contingência e aceite.
6. Não automatizar pagamentos ou lançamentos antes de dominar recepção e classificação.
7. Não escalar antes de a PLX validar a taxonomia e a qualidade real.
8. Não construir um SaaS completo agora. Primeiro provar o serviço gerenciado replicável.

## 14. Próximo movimento recomendado

Executar um **Sprint de Liberação Comercial PLX** com quatro entregáveis:

1. correções dos bloqueadores críticos descritos na auditoria;
2. homologação real supervisionada e matriz de acurácia;
3. infraestrutura de produção, backup e runbook;
4. pacote comercial com contrato, onboarding, limites, precificação por volume e estudo de caso anonimizado.

O primeiro marco não é “vender para várias contabilidades”. É transformar a PLX em uma referência comprovada, com números reais e uma operação que sobreviva a falha, duplicata, documento ilegível e revisão humana.

## 15. Fontes externas atuais consideradas

- n8n mantém Community Edition self-hosted e oferece planos comerciais com recursos adicionais de governança; preço da solução não deve depender apenas do custo da ferramenta: <https://n8n.io/pricing/>.
- NVIDIA informa que endpoints gratuitos são para desenvolvimento/teste e que produção requer licenciamento empresarial: <https://docs.api.nvidia.com/nim/docs/product>.
- WAHA informa que automação de grupos usa cliente não oficial e não deve ser considerada totalmente segura: <https://waha.devlike.pro/whatsapp-groups/>.
- WAHA recomenda não expor sua API publicamente e exige proteção por chave/firewall: <https://waha.devlike.pro/docs/how-to/security/>.
- Google Drive exige atenção a escopos OAuth e políticas aplicáveis: <https://developers.google.com/workspace/drive/api/terms>.
- A ANPD distingue controlador e operador; o contrato deve registrar instruções, responsabilidades e suboperadores: <https://www.gov.br/anpd/pt-br/assuntos/titular-de-dados>.

Este documento é planejamento técnico-comercial e não substitui revisão jurídica, contábil ou de licenciamento.
