# Pack 02 — Extract & Route

Leitura determinística primeiro, OCR NVIDIA somente quando necessário, decisão
de política central e roteamento para Drive ou ERP.

Inclui o container `document-reader`, o template WAHA V2, o reconciliador e os
adaptadores em `../../integrations/erp/`. O modo estrito deve ser habilitado em
canário antes da expansão.

## Sugestão comercial

Implantação por política documental e mapeamento do destino, recorrência por
volume processado e faixa separada para documentos que exigem revisão humana.
