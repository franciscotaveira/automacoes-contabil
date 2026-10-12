# Plano de execução comercial e roadmap modular

**Data-base:** 10/10/2026
**Produto inicial:** Inbox Documental para Contabilidades
**Cliente de homologação:** PLX Contabilidade
**Regra:** vender resultado operacional; n8n, WAHA, Drive e modelos são componentes internos.

## 1. Estado verificável

| Ativo | Estado | Uso permitido agora |
|---|---|---|
| PLX · Processo documental unificado V3.5 | ativo na VPS | piloto comercial assistido |
| Gateway documental híbrido | saudável na VPS; XML e reforço sintéticos comprovados | leitura local primeiro, reforço NVIDIA apenas quando há pendência |
| Assistente n8n · Operações | ativo | apoio interno |
| OC-00, OC-01, OC-02 e OC-03 | válidos e inativos em homologação | testes sintéticos; sem dados de cliente |
| OC-11 | publicado como handler global de falhas | registra envelope sanitizado no ledger interno; sem mensagens externas |
| Checklist recorrente e backlog | API na VPS, 30 testes locais; OC-03 a OC-09 homologados e execuções 3134, 3136, 3163, 3165, 3167, 3169 e 3171 | homologação; ainda sem workflow produtivo |
| Módulos M01 e M03–M10 | planejamento ou demonstração | descoberta; não vender como implantado |

O produto ainda não deve ser apresentado como operação autônoma com SLA. Antes disso, concluir o teste de um documento real inédito na versão atual e executar o piloto acompanhado. O handler global já foi recuperado em ensaio isolado, sem dados ou mensagens de cliente.

## 2. Oferta inicial

### Promessa delimitada

> Receber documentos enviados nos grupos autorizados do WhatsApp, preservar o original, classificar por empresa, setor, tipo e data, organizar no armazenamento contratado, identificar duplicidades e transformar dúvidas ou falhas em pendências explícitas.

### Escopo-base

- um escritório contábil;
- empresas e grupos contratados;
- imagens, PDFs e XMLs dentro dos limites;
- setores Fiscal, Contábil e Pessoal;
- armazenamento configurado por cliente;
- confirmação de organizado, duplicado ou atenção;
- relatório diário;
- operação assistida e revisão humana das exceções.

### Exclusões da V1

- lançamento automático no ERP;
- pagamento de boletos;
- validação fiscal definitiva;
- afirmação de completude sem lista esperada;
- decisão automática sobre documento ambíguo;
- promessa de disponibilidade irrestrita do canal WAHA.

## 3. Modelo comercial

### A. Implantação

Descoberta, taxonomia, empresas, grupos, credenciais, armazenamento, testes, treinamento, documentação e aceite. Cobrança única por complexidade e integrações.

### B. Operação gerenciada

Hospedagem, monitoramento, backup, manutenção, franquia de documentos, relatório e suporte. Cobrança mensal base + faixa de volume + excedente.

### C. Módulos adicionais

Checklist recorrente, lembretes aprovados, alertas de vencimento, outro armazenamento, outro sistema, novo tipo documental, painel ou regra especial. Cada módulo possui implantação e impacto recorrente próprios.

As faixas registradas no plano comercial são hipóteses para teste, não tabela pública: implantação simples de R$ 2.500 a R$ 5.000; implantação avançada de R$ 6.000 a R$ 15.000 ou mais; mensalidade assistida de R$ 600 a R$ 1.500; mensalidade gerenciada de R$ 1.500 a R$ 4.000 ou mais.

## 4. Processo comercial replicável

1. **Diagnóstico:** observar uma execução real, volume, tempo, erros, responsáveis e sistemas.
2. **Qualificação:** aceitar apenas processo frequente, entrada acessível, decisão repetível e responsável por exceções.
3. **Proposta:** definir empresas, grupos, formatos, volume, horário, revisão e exclusões.
4. **Implantação:** configurar por parâmetros e credenciais, sem copiar o núcleo.
5. **Ensaio:** usar documentos autorizados e casos de erro.
6. **Piloto acompanhado:** comparar a operação por dez dias úteis ou período contratado.
7. **Aceite:** aprovar caminho normal, duplicidade, concorrência, falha, restauração e revisão.
8. **Operação:** monitorar backlog, qualidade, consumo, suporte e margem.
9. **Expansão:** ativar um módulo adicional somente quando o núcleo estiver estável.

### Artefatos obrigatórios por cliente

- briefing aprovado;
- ficha da solução e versão;
- configuração sem segredos;
- workflow/export versionado;
- matriz de testes;
- runbook e recuperação;
- proposta e limites de volume;
- termo de aceite;
- relatório mensal de operação e margem.

Os modelos existentes em `outputs/estudo-chat-sales-n8n/modelos/` cobrem briefing, ficha da solução, piloto, proposta e aceite.

## 5. Catálogo e ordem de construção

| Ordem | Módulo | Estado | Condição para avançar |
|---:|---|---|---|
| 1 | M02 · Triagem documental | piloto assistido | fechar gates restantes da PLX |
| 2 | M02B · Checklist recorrente e pendências | OC-03 a OC-09 homologados com dados sintéticos | testar WAHA válido em destino autorizado e operar modo sombra |
| 3 | M02C · Lembretes aprovados | fundação de outbox testada | revisão humana, calendário e política de canal |
| 4 | M02D · Alertas de vencimento | planejado | campos e fonte de verdade aprovados |
| 5 | M02E · Exportação para ERP | planejado | contrato de integração do ERP |
| 6 | Painel de revisão e operação | planejado | estados e ciclo de correção estabilizados |

Radar, agenda, venda para entrega, faturamento, compromissos, orçamento, SLA de leads, pós-venda e pedido versus entrega permanecem no portfólio geral. Não entram no sprint contábil inicial.

## 6. Especificação do próximo módulo

### M02B · Checklist recorrente e pendências

**Problema:** o escritório sabe que certos documentos devem chegar semanal ou mensalmente, mas precisa procurar no grupo e cobrar manualmente.

**Entrada:** empresa, período, relação de documentos esperados, vencimentos, canal, responsável e regra de comparação.

**Processo:**

```text
agenda
  -> materializar checklist sem duplicar
  -> reconciliar documentos recebidos
  -> separar recebido | faltante | atenção | acesso desconhecido
  -> gerar revisão consolidada
  -> aprovação humana
  -> preparar lembrete no outbox
  -> revalidar antes de enviar
  -> registrar resultado
```

**Saída:** checklist por empresa e competência, backlog, pendências com responsável e lembrete consolidado quando aprovado.

**Regras obrigatórias:**

- não declarar documento faltante sem fonte esperada;
- não enviar cobrança sem aprovação durante o piloto;
- cancelar ação se o documento chegar antes do envio;
- não duplicar checklist na reexecução;
- distinguir ausência no acervo de falha de acesso;
- preservar tenant, empresa, período e versão da configuração;
- permitir desligar o módulo sem afetar a triagem documental.

### Componentes técnicos mínimos

| Código | Responsabilidade | Limite sugerido |
|---|---|---:|
| OC-03 | materializar checklist por calendário | até 12 nós |
| OC-04 | reconciliar recebimentos e itens esperados | homologado com API interna, n8n e dados sintéticos |
| OC-05 | gerar revisão e relatório de pendências | homologado somente em leitura, com dados sintéticos |
| OC-06 | preparar rascunho de lembrete para aprovação humana | homologado; não tem envio de canal |
| OC-07 | revalidar e assumir despacho aprovado | homologado; claim controlado antes do canal |
| OC-08 | entregar lembrete aprovado e registrar resultado | homologado com falha WAHA controlada; nenhuma mensagem real enviada |
| OC-09 | revisar pendências consolidadas do outbox | homologado em leitura; encaminha estados para revisão humana |

Não unir tudo em um canvas gigante. Cada workflow tem entrada, saída, idempotência e erro explícitos. A IA não é necessária para materialização, calendário, comparação ou envio; entra apenas quando a classificação documental não fornece evidência suficiente.

## 7. Gates do próximo sprint

### Gate 1 — Produto PLX

- documento real inédito percorre WhatsApp, fila, leitura, Drive, manifesto e confirmação;
- handler global de erro publicado, conectado e comprovado por ensaio de falha controlada sem efeito externo;
- falha controlada recuperada sem perda ou duplicação;
- responsável da PLX aprova amostra de classificação.

### Gate 2 — Checklist em laboratório

- mesma competência executada duas vezes gera um checklist lógico;
- recebimento reconcilia o item correto;
- material ambíguo permanece em atenção;
- backlog aparece separado de falha técnica;
- alteração de watermark cancela lembrete vencido;
- teste sem token retorna 403;
- nenhum envio real é realizado.

### Gate 3 — Modo sombra PLX

- checklist real é produzido sem cobrança externa;
- contador compara resultado por dez dias úteis;
- falsos faltantes e falsos recebidos são medidos;
- tempo de revisão e suporte cabem no preço;
- somente depois disso o envio de lembrete pode ser homologado.

## 8. Métricas e decisão de escala

- documentos por mês e por pico;
- percentual organizado sem revisão;
- pendências válidas e tempo de resolução;
- falsos organizados e falsos faltantes;
- p50 e p95 de processamento;
- horas administrativas antes e depois;
- custo de infraestrutura e IA por cliente;
- horas de suporte;
- margem bruta por instalação;
- esforço para implantar o segundo escritório.

O segundo cliente deve exigir menos horas e alterar principalmente configuração, credenciais e taxonomia. Se exigir cópia manual do workflow ou mudanças extensas no núcleo, o produto ainda não é replicável.

## 9. Sequência executiva

1. fechar os dois gates técnicos restantes da PLX;
2. obter o aceite do piloto assistido;
3. preencher a linha de base econômica;
4. montar demonstração anonimizada e proposta;
5. testar OC-08 com sessão WAHA e destino de homologação explicitamente autorizados;
6. executar checklist em modo sombra na PLX;
7. contratar o primeiro adicional;
8. implantar um segundo escritório;
9. revisar licença n8n, canal, IA, privacidade e capacidade antes de hospedagem multiempresa em escala.
