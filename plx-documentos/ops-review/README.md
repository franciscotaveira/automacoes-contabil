# Pack 03 — Exceptions & Review Panel

Fila SQLite isolada por tenant para documentos `REVIEW_REQUIRED`. A interface
exibe apenas metadados e permite assumir e resolver uma pendência. O original
permanece no Drive restrito.

```bash
python -m pip install -r requirements.txt
REVIEW_SHARED_KEY=troque-isto REVIEW_DB_PATH=/data/review.sqlite3 python app.py
```

O n8n envia `POST /api/items` com `X-Review-Key` e `X-Tenant-ID`. Publique atrás
de TLS e autenticação adicional. Sugestão comercial: recorrência por caixa de
revisão/tenant, com franquia de operadores e SLA de atendimento definido.
