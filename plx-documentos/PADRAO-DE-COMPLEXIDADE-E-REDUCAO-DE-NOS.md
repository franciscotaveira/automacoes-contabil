# Padrão de complexidade e redução de nós

## Regra

Todo workflow novo deve justificar sua complexidade antes de ser construído. A contagem de nós não é o objetivo isolado; o objetivo é reduzir pontos de falha, chamadas externas, caminhos paralelos e lógica repetida sem esconder controles necessários.

## Gate antes da construção

Cada proposta deve apresentar:

1. entrada e saída do processo;
2. caminho crítico sem exceções;
3. operações que precisam ser determinísticas;
4. ponto exato em que IA agrega valor;
5. idempotência, retry e recuperação;
6. orçamento de nós e chamadas externas;
7. alternativa mais simples considerada e motivo da rejeição.

Sem esse quadro, o workflow não entra em construção.

## Orçamento de complexidade

| Classe | Limite orientativo | Uso |
|---|---:|---|
| Microfluxo | até 12 nós executáveis | uma entrada, uma decisão principal e uma saída |
| Fluxo padrão | até 20 nós executáveis | integração de dois ou três sistemas com persistência e falha tratada |
| Orquestrador | acima de 20 nós | exige revisão de arquitetura e extração de módulos reutilizáveis |

Sticky Notes não entram na contagem. Subworkflows e serviços não apagam complexidade: devem ser contabilizados separadamente e ter contrato, teste e dono claros.

## Métricas obrigatórias

- nós no caminho crítico;
- quantidade de ramificações;
- chamadas externas sequenciais;
- chamadas de IA por documento;
- locais onde o mesmo dado é transformado novamente;
- tempo médio e percentil 95;
- taxa de retry, falha e revisão humana;
- custo por documento processado.

## Regras de desenho

1. Use código determinístico para normalização, datas, hashes, nomes e regras fiscais verificáveis.
2. Use IA somente para leitura ambígua, classificação ou extração que não pode ser resolvida com parser.
3. Antes da IA, tente XML, texto nativo do PDF, QR code, código de barras e metadados.
4. Uma etapa de IA deve produzir um contrato JSON validado; saída inválida segue para reforço ou revisão.
5. Repetições como `buscar → selecionar → verificar → criar pasta` devem virar um módulo reutilizável quando aparecerem em mais de um produto.
6. Um único workflow compartilhado deve tratar falhas de vários clientes, em vez de copiar ramos de erro para cada fluxo.
7. O fluxo principal não deve depender de um agente autônomo para decisões fixas.
8. Todo documento aceito precisa terminar em estado explícito: organizado, atenção, duplicado, retry ou falha registrada.
9. Nenhuma otimização pode remover idempotência, rastreabilidade, retry ou confirmação ao usuário.

## Gate de aceite

Um fluxo novo só é publicável depois de provar:

- arquivo único;
- reenvio idêntico;
- lote concorrente;
- documento ilegível;
- indisponibilidade temporária de uma dependência;
- retomada após restart;
- confirmação de sucesso e de erro;
- relatório agendado, quando existir;
- fila zerada e nenhum item sem estado final.

## Aplicação ao PLX atual

O PLX V3.5 possui 83 nós e recebeu alerta de 81 itens no nível superior. Essa dívida visual e estrutural é real, mas não deve ser atacada antes de fechar a homologação comercial. A refatoração posterior deve preservar os contratos já validados e priorizar três extrações: resolução de hierarquia do Drive, tratamento compartilhado de falhas e encapsulamento do processamento documental.
