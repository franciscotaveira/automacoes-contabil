# Runbook — validação P0 de triagem documental

Status: **planejado; nenhum cenário deste runbook foi executado no VPS**.
Data: 11/10/2026. Escopo: validar P0-A e P0-B sem alterar documentos reais nem enviar mensagens a clientes.

Este runbook transforma a [matriz de aceitação](matriz-aceitacao.csv) em uma sequência operável. Ele não autoriza ativação, migração de pastas, alteração de workflow, reprocessamento de backlog ou disparo no grupo PLX.

## Regra de aprovação

Um cenário só é aprovado quando houver evidência persistida de entrada, decisão, destino e estado final. Uma execução verde do n8n não basta. Falha esperada e corretamente contida também é aprovação.

Use uma política de **teste** com `tenant_id`, grupo WAHA, raiz Drive, responsáveis e destinatário de notificação exclusivos do canário. Nunca copie IDs, links, telefones, nomes ou arquivos da PLX para o corpus de teste.

## Preparação comum

1. Exportar as versões atuais de workflow e políticas, sem alterar a versão publicada.
2. Criar corpus sintético rotulado e uma raiz Drive de teste vazia. Cada arquivo recebe um `case_id`; identificadores fiscais e pessoas são fictícios.
3. Registrar início com: versão do workflow, política, hash do corpus, horário BRT, operador e ambiente.
4. Desabilitar mensagens para grupos ou números reais; o canário aceita só notificações de laboratório.
5. Definir a correlação: evento WAHA, `message_id`, job/fila, execução n8n, `canonical_file_id`, caso de revisão, arquivo Drive e outbox.
6. Critério de parada: se um arquivo de teste for salvo fora da raiz de teste, encerrar o ensaio e preservar a evidência. Não apagar para ocultar a divergência.

## P0-A — política, identidade e destino

Objetivo: provar que a origem autenticada resolve uma política explícita e que nenhuma inferência de nome cria ou escolhe pasta de cliente.

### Testes offline obrigatórios

Executar regras puras, sem webhook, WAHA, Drive ou NVIDIA. O adaptador de decisão recebe um envelope sintético e devolve contrato estruturado.

| Caso | Entrada mínima | Resultado obrigatório |
|---|---|---|
| A01 / E27 | Grupo permitido sem política ativa | `POLICY_NOT_CONFIGURED`; retenção de laboratório; zero pasta de cliente |
| A02 / E28 | `Empresa` versus `Empresa Distinta Ltda` | `REVIEW_REQUIRED`; similaridade não autoriza destino |
| A03 / E29 | Política com CNPJ fictício, documento com outro | `IDENTITY_CONFLICT`; nenhum destino operacional |
| A04 / E30 | Modo inexistente, nulo ou incompleto | Política rejeitada; sem padrão implícito `received` |
| A05 / E02 | NF recebida e emitida, ambas rotuladas | Direção pelo papel fiscal autorizado; evidência por campo |
| A06 / E05 | Boleto com banco, pagador e beneficiário | Banco não é proprietário; relação aprovada determina a empresa |
| A07 / E03–E04 | Nome fantasia, matriz e filial | Alias aprovado funciona; filial sem vínculo explícito fica em revisão |
| A08 / E35–E36 | CNPJ alfanumérico válido/inválido e duas empresas elegíveis | Conservar caracteres; validar; operação interna exige regra ou revisão |

Para cada caso, guardar request sanitizado, resposta integral, `policy_version`, `owner_id`, `direction`, razões, evidência de papel e resultado esperado. Adicionar regressões antes de conectar o código ao workflow.

**Gate P0-A:** 100% dos casos A01–A08 passam; nenhum retorno contém pasta final de cliente em caso sem política, conflito ou ambiguidade. Revisão humana deve ter motivo legível e responsável configurável.

## P0-B — durabilidade, idempotência e Drive

Objetivo: provar que cada ocorrência é recuperável e que uma tentativa incerta não cria arquivo nem confirmação duplicada.

### Testes offline/integrados em laboratório

| Caso | Falha controlada | Resultado obrigatório |
|---|---|---|
| B01 / E31 | Queda antes e depois da transação de evento | ACK somente após evento+tarefa persistidos; reinício recupera o job |
| B02 / E32 | Worker antigo retorna após lease expirar | Token antigo não conclui, move nem notifica |
| B03 / E11 | Mesmo binário, duas ocorrências | Uma cópia canônica por escopo autorizado; duas ocorrências auditáveis |
| B04 / E17 | Drive confirmado; envio WhatsApp falha | Repete somente outbox; sem novo OCR, upload ou arquivo |
| B05 / E18 | Upload falha ou parent não confere | Sem confirmação de sucesso; fonte e intenção recuperáveis |
| B06 / E19 | Dois jobs criam a mesma árvore | Uma chave lógica/pasta final; Drive IDs persistidos |
| B07 / E20 | Token revogado, permissão negada e quota | Causa específica; retry limitado; alerta e fonte preservada |
| B08 / E33–E34 | Upload ou envio com timeout ambíguo | Reconcilia antes de repetir; `UNKNOWN` sem recibo |
| B09 / E21 | Lote com duplicados e dois tenants de teste | Todas as ocorrências reconciliadas; nenhum link/arquivo entre tenants |

Capturar: ID de ocorrência, hash, tenant, job, tentativa, lease/fencing token, intenção de upload, Drive ID, parent ID, tamanho, outbox ID e estado final. B09 mede também fila, p50 e p95; esses números não são capacidade comercial até repetir com volume contratado.

**Gate P0-B:** nenhum ACK órfão, perda silenciosa, arquivo em raiz errada, sobrescrita por worker antigo, duplicação por timeout ou confirmação de arquivo não verificado. Toda falha encerra em estado consultável com próxima ação.

### Resultado parcial de laboratório — 11/10/2026

O componente de fila recebeu chave de ocorrência com escopo completo (`tenant_id + operation_id + session_id + group_id + message_id`) e token de posse temporária. A suíte local executou 17 testes com sucesso, incluindo: 20 duplicatas concorrentes, 20 documentos distintos, isolamento de mesmo `message_id` entre tenants, reinício, retries, endpoint protegido e bloqueio de conclusão por worker com lease vencido.

Os itens B04–B09 ainda dependem da intenção de arquivamento, verificação Drive, outbox e uma fila implantada em laboratório. Este resultado não libera o canário nem autoriza alteração no workflow ativo.

## Canário controlado após aprovação offline

Somente iniciar após P0-A e P0-B aprovados por engenharia e responsável da operação. O canário usa entradas novas de laboratório; não é reprocessamento do grupo PLX.

1. Publicar política de teste e verificar sessão, grupo, Drive e notificações exclusivos de laboratório.
2. Enviar um arquivo sintético legível de empresa autorizada; reconciliar WhatsApp → evento → fila → n8n → Drive → manifesto → outbox antes do próximo.
3. Repetir com ocorrência duplicada, empresa não autorizada e falha de Drive simulada. Nenhum pode alcançar pasta final nem gerar aviso falso.
4. Enviar lote de até 10 arquivos sintéticos rotulados, com horários distintos e duas empresas de teste. Não reenviar manualmente enquanto houver job vivo.
5. Interromper somente o laboratório, recuperar o serviço e reconciliar `case_id` contra manifesto e Drive.
6. Registrar esperados, recebidos, arquivados, em revisão, falhos, duplicados, notificações confirmadas/desconhecidas e divergências. Qualquer divergência bloqueia expansão.

## Critério para piloto assistido

O primeiro grupo real só inicia após política aprovada por escrito pelo escritório, responsável e prazo de revisão definidos, canário aprovado, export/rollback disponível e autorização explícita do cliente para a janela. O piloto começa com tipos e volume declarados, confirmação monitorada e reconciliação diária. Ele não valida autonomia comercial por si só.

## Modelo de evidência de encerramento

| Campo | Registro |
|---|---|
| Identificação | `run_id`, ambiente, workflow/policy version, hash do corpus |
| Janela | início/fim BRT, operador e responsáveis técnico/operacional |
| Resultado | esperados, aprovados, bloqueados corretamente, falhos e divergências |
| Decisão | `APROVADO` ou `BLOQUEADO`, com links sanitizados às evidências |

## Saída e rollback

Ao falhar, interromper somente o canário, manter fontes e logs, marcar os casos como `BLOCKED` e registrar a causa. Reverter política/versão de laboratório conforme export prévio; não apagar arquivos para ocultar divergência. Movimento de arquivo já confirmado exige reconciliação e manifesto próprio.
