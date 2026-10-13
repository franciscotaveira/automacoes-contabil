# Reconciliador local

Compara um export do manifesto com uma representação do Drive. O modo inicial é
deliberadamente local: nenhuma credencial ou API externa é necessária.

```bash
node plx-documentos/reconciler/reconcile.js \
  --manifest plx-documentos/reconciler/fixtures/sample-manifest.json \
  --drive-sim plx-documentos/reconciler/fixtures/sample-drive.json \
  --out /tmp/plx-reconciliation.json
```

O processo termina com `0` quando tudo confere, `2` quando encontra
discrepâncias e `1` para erro de entrada ou execução.
