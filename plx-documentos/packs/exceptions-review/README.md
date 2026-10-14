# Pack 03 — Exceptions & Review

Fila humana para documentos cuja evidência local e o reforço de IA não permitem decisão segura. O workflow envia apenas os casos `REVIEW_REQUIRED`; um operador autorizado assume, registra a decisão e encerra o item.

## Entrega

- serviço e interface em `../../ops-review/`;
- instalador `install.sh` deste diretório;
- fixtures documentais compartilhadas em `../../fixtures/`;
- checklist de publicação em `../../RUNBOOK_CUTOVER.md`.

## Smoke

```bash
REVIEW_SHARED_KEY=CHANGE_ME REVIEW_DB_PATH=/tmp/review.sqlite3 \
  python -m unittest -v plx-documentos/ops-review/test_app.py
```

## Sugestão comercial

Cobrar implantação pela definição de motivos, papéis e SLA, mais recorrência por volume da fila e quantidade de operadores. A revisão humana deve ser medida separadamente do processamento automático.
