# Triagem documental pelo WhatsApp — arquitetura canônica

Estado verificado em: 2026-10-02
Ambiente validado: Docker local `contabilidade-lab`
Caso inicial: piloto PLX

Este documento consolida o estado atual. `README.md` e `FLUXO-OPERACIONAL.md` preservam a evolução inicial e podem conter limites já superados.

## Objetivo operacional

Receber documentos em grupo autorizado, preservar o original, compreender o conteúdo, classificar por departamento, renomear, organizar no Google Drive, registrar estado e pendências e gerar um fechamento diário. O fluxo prepara o trabalho para o sistema contábil; não executa lançamento, pagamento ou decisão contábil.

## Percurso

```text
WhatsApp/WAHA
  -> webhook n8n
  -> validação de grupo, mídia e idempotência
  -> preservação do original no Drive
  -> detecção do tipo real do arquivo
  -> parser, texto interno, OCR local e códigos
  -> fallback NVIDIA quando necessário
  -> validação de saída estruturada
  -> classificação e atenção
  -> organização, manifesto e confirmação
  -> fechamento diário em CSV e WhatsApp
```

## Componentes atuais

| Componente | Estado em 2026-10-02 |
|---|---|
| n8n `2.40.7` | saudável |
| WAHA `contabilidade-lab` | autenticado, `WORKING` |
| Gateway documental `hybrid-v3.0.0` | saudável |
| Google Drive | validado no piloto |
| Task runner | registrado |
| MCP n8n | validado anteriormente |

## Workflows publicados

| Função | ID | Versão ativa |
|---|---|---|
| Fluxo principal | `documentWahaIngestV2Draft` | `62a0b85f-8005-4c5f-a360-39b7832c5ef0` |
| Leitura e classificação | `jHJyM2vhnaoe2Shq` | `7003a89a-3980-4431-a893-cf4ad41e12c3` |
| Organização no Drive | `documentOrganizeV2Draft` | `c727174d-3b7c-485a-824c-25ac0ec6f3f0` |
| Fechamento diário | `documentDailyCloseV2Draft` | `3f2e43c8-fe44-4888-a2a6-4d40fcb0c8be` |
| Registro de erros | `documentErrorsV1` | `6ea06a69-7092-4076-8c40-6a75ad9d7bf2` |

Esse quadro é um snapshot. A instância n8n é a fonte para versões publicadas.

## Estratégia de leitura

1. assinatura binária identifica o tipo real;
2. XML fiscal usa parser determinístico protegido;
3. PDF eletrônico usa extração do texto interno;
4. imagem e PDF digitalizado recebem orientação, escala, tons de cinza, contraste e nitidez;
5. OCR local usa Tesseract; QR e códigos usam ZBar;
6. CNPJ, chave, datas e valores recebem extração determinística;
7. evidência insuficiente aciona fallback cognitivo;
8. Nemotron 3.5 Lightning devolve JSON guiado e validado;
9. divergência ou falta crítica vira atenção ou revisão.

O contrato permite substituir o provedor de IA sem reescrever captura, armazenamento e organização.

## Classificação do piloto

| Departamento | Tipos principais |
|---|---|
| Fiscal | NF-e, NFC-e, NFS-e, CT-e, MDF-e, cupom fiscal |
| Contábil | boleto, extrato, comprovante, recibo, fatura, balancete, razão, diário, DRE |
| Folha | atestado, admissão, férias, rescisão, ponto, afastamento, holerite, FGTS, INSS |
| Revisar | desconhecido, ilegível, divergente ou bloqueado |

## Estrutura de armazenamento

```text
01 - ORIGINAIS/
  RAZÃO SOCIAL DO EMITENTE/
    ANO/
      DEPARTAMENTO/
        MÊS/
          DIA/
            TIPO - DESTINATÁRIO - DATA_HORA - NÚMERO - EMITENTE.ext
```

O tipo fica no nome para evitar mais um nível de pasta. Data ou hora ausente não é inventada. Quando necessário, a data de recebimento é usada como fallback explicitamente marcado e gera atenção.

## Estados e garantias

- ID da mensagem e SHA-256 sustentam deduplicação.
- O original é salvo antes da interpretação.
- Documento com atenção permanece na estrutura e no manifesto.
- Confirmação ocorre depois de persistência e organização.
- Relatório agrega categorias, departamentos e pendências.
- Valores, imposto pago e lucro não fazem parte do relatório atual.

## Evidência agregada

Reprocessamento de 2026-10-01:

| Métrica | Resultado |
|---|---:|
| Documentos reorganizados | 51 |
| Caminhos canônicos | 51 |
| Sem pendência | 36 |
| Com atenção | 15 |
| Fiscal | 29 |
| Contábil | 14 |
| Folha | 2 |
| Revisar | 6 |

O leitor híbrido executou os 51 arquivos sem falha técnica: 29 PDFs com texto, 10 PDFs digitalizados e 12 fotos. Extração bem-sucedida não significa aprovação contábil.

## Continuidade: lacuna conhecida

Na inicialização de 2026-10-02:

- n8n e gateway retornaram saudáveis;
- WAHA retornou autenticado e `WORKING`;
- workflows estavam ativos;
- não houve execução para o lote enviado durante a parada;
- o histórico consultado do grupo não mostrou o lote novo;
- containers principais estavam com `restart=no`.

Conclusão: o caminho em tempo real está validado; a recuperação após indisponibilidade ainda não está validada.

## Correção arquitetural necessária

1. configurar `restart: unless-stopped` nos serviços operacionais;
2. guardar cursor ou watermark do último evento confirmado;
3. consultar o histórico disponível ao iniciar;
4. alimentar o mesmo pipeline com backlog limitado;
5. deduplicar por ID e SHA-256;
6. registrar intervalo e contagem recuperados;
7. alertar quando a mídia histórica não estiver disponível;
8. ensaiar `desligar -> enviar -> ligar -> recuperar -> reconciliar`.

## Replicação

O núcleo é reutilizável. Cada cliente recebe configuração isolada para canal, contextos autorizados, credenciais, pasta raiz, cadastro, taxonomia, regras de destino, confiança, horário e mensagens. Não copie `.env`, volume, token ou documento de outro cliente.

## Evidências relacionadas

- `evidence/RESULTADO-REPROCESSAMENTO-SETORIAL-PLX-2026-10-01.md`
- `evidence/RESULTADO-LEITOR-HIBRIDO-V3-2026-10-01.md`
- `evidence/VALIDACAO-OCR-HIBRIDO-2026-09-30.md`
- `evidence/VALIDACAO-MCP-2026-09-30.md`
