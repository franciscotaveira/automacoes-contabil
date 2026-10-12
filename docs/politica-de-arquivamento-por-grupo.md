# Política de arquivamento por grupo

> Revisão de 2026-10-11: este documento registra a intenção anterior, não comprova implementação. A inspeção do workflow ativo encontrou lacunas no transporte da política, autorização por nome e manifesto. A especificação revisada está em [Soluções para exceções](solucoes-excecoes-2026-10-11/README.md), com [decisões propostas](solucoes-excecoes-2026-10-11/decisoes.md). As afirmações operacionais abaixo são históricas e não devem ser usadas como garantia de funcionamento.
>
> Pontos substituídos pela proposta revisada: substring de razão social não autoriza identidade; revisão de empresa incerta fica em área restrita da operação; a pasta Tipo passa a ser opcional; falta de cadastro nunca autoriza adotar automaticamente a empresa extraída.

## Proposta anterior preservada para histórico

Cada grupo WhatsApp representa uma operação documental e possui uma política explícita. A identidade encontrada no arquivo (`issuer` e `recipient`) descreve o documento; ela não define por si só quem é o dono do arquivo no Drive.

## Cadastro obrigatório

- `group_id`: identificador exato do grupo WAHA.
- `archive_owner_name`: razão social da empresa para a qual o acervo é organizado.
- `archive_owner_cnpj`: CNPJ da empresa arquivista quando disponível.
- `archive_mode`: `received`, `issued` ou `mixed`.
- `drive_root_id`: pasta raiz exclusiva da empresa.
- `review_destination`: destino de exceções.

## Decisão

| Modo | Documento arquivado como |
| --- | --- |
| `received` | Recebido pela empresa arquivista |
| `issued` | Emitido pela empresa arquivista |
| `mixed` | Determinado pela comparação do CNPJ/razão social da empresa arquivista com emissor e destinatário |

No modo `mixed`, se a direção não puder ser comprovada, o documento continua guardado sob a empresa arquivista com `review_required=true` e motivo `ARCHIVE_DIRECTION_NOT_EVIDENCED`.

## Estrutura de Drive

`Empresa arquivista > Ano > Departamento > Tipo > Mês > Dia`

O sentido do documento aparece no nome e no manifesto, evitando uma nova camada de pastas:

- `RECEBIDO - <emissor> - <tipo> - <data> - <número>`
- `EMITIDO - <destinatário> - <tipo> - <data> - <número>`

## Regra de segurança

1. Nunca trocar a empresa arquivista com base em apenas um arquivo.
2. Nunca usar emissor ou destinatário como fallback silencioso quando há política `mixed` e a direção é ambígua.
3. Toda alteração de política deve ser auditável e só valer para novos eventos; migrações precisam ser registradas separadamente.

## Proteção contra documento de outra empresa

Antes de organizar, o fluxo compara a empresa arquivista cadastrada com a parte esperada pelo modo:

- `received`: a empresa arquivista precisa ser a destinatária/pagadora;
- `issued`: a empresa arquivista precisa ser a emissora/beneficiária;
- `mixed`: a direção é inferida por CNPJ e razão social.

Se CNPJ conflitante, razão social incompatível ou direção sem evidência, o arquivo é enviado para `99 - Revisar`, com `review_required=true` e `ARCHIVE_OWNER_NOT_A_DOCUMENT_PARTY`. O arquivo não é salvo na pasta operacional da empresa e deve gerar aviso de atenção.
