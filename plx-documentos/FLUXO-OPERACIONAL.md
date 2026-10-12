# Fluxo operacional do piloto PLX

> **Documento histórico:** o fluxo vigente está consolidado em [ARQUITETURA-CANONICA.md](ARQUITETURA-CANONICA.md). A versão abaixo registra a primeira implantação e não deve ser usada sozinha para reconstruir o estado atual.

## Entrada

- canal: grupo autorizado `Plx teste`;
- identificador interno: `{{WHATSAPP_GROUP_ID}}@g.us`;
- sessão: `contabilidade-lab`;
- formatos analisados no piloto: JPEG e PNG;
- PDF e XML permanecem arquivados e seguem para revisão até existir parser próprio.

## Percurso por documento

1. O WAHA entrega o evento ao webhook autenticado do n8n.
2. O workflow valida grupo, presença de mídia e idempotência pelo ID da mensagem.
3. O original é preservado em `01 - ORIGINAIS`.
4. A camada NVIDIA extrai e normaliza:
   - emitente e CNPJ;
   - destinatário e CNPJ;
   - tipo, número e série;
   - data e hora de emissão;
   - chave de acesso;
   - valor total;
   - tributos explicitamente identificados;
   - confiança, evidências e alertas.
5. Documento incompleto, inválido ou abaixo do limiar de confiança recebe `REVIEW_REQUIRED` e não é reorganizado automaticamente.
6. Documento validado entra no workflow `02B`.
7. O workflow procura antes de criar:

```text
01 - ORIGINAIS/
└── <EMPRESA EMITENTE> - <CNPJ>/
    └── AAAA-MM/
        └── DD/
```

8. O nome final segue o padrão:

```text
<DESTINATÁRIO> - AAAA-MM-DD_HH-mm - NF-<NÚMERO> - <EMITENTE>.<extensão>
```

9. Se a hora não estiver presente no documento, o arquivo usa `hora-nao-informada`; nenhuma hora é inventada.
10. Depois que renomear, mover e atualizar o manifesto forem concluídos, o WAHA confirma no grupo e informa o acumulado do dia.

## Fechamento das 18h

O workflow `DOCUMENTOS · 03 · Fechamento diário`:

1. seleciona somente registros `ORGANIZED` do dia em `America/Sao_Paulo`;
2. gera CSV detalhado em `02 - FECHAMENTOS`;
3. soma quantidade, valor total, tributos identificados e resultado fiscal estimado;
4. agrupa a quantidade por emitente;
5. envia uma única mensagem ao grupo.

## Definições financeiras

| Campo | Significado |
|---|---|
| Valor total emitido | Soma dos valores totais das notas organizadas |
| Tributos identificados | Total destacado ou soma de componentes explícitos |
| Resultado fiscal estimado | Valor total menos tributos identificados |
| Lucro líquido real | Não calculado sem custos, despesas e demais dados financeiros |

O fluxo nunca informa `imposto pago` apenas com base na nota. A nota mostra tributos destacados ou estimados, não a liquidação do imposto.

## Estado de validação

- análise estruturada: execução sintética `66`, sucesso;
- organização, nome, caminho e resumo parcial: execução sintética `62`, sucesso;
- fechamento, CSV e resumo: execução sintética `65`, sucesso;
- percurso externo completo: ingestão `76`, análise `77` e organização/confirmação `78`, sucesso;
- arquivo fictício efetivamente renomeado e organizado no Drive;
- manifesto efetivamente atualizado para `ORGANIZED`;
- confirmação efetivamente enviada pelo WAHA ao grupo `Plx teste`;
- a primeira tentativa externa (`74`) detectou perda do binário antes do upload; o fluxo foi corrigido e o segundo ensaio comprovou a correção;
- próxima validação: amostra anonimizada semelhante às fotos reais e ensaio com múltiplos documentos antes do piloto assistido.
