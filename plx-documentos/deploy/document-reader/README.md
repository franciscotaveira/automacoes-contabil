# Leitor documental híbrido V3.1

Serviço portátil para o laboratório local e para o futuro VPS Linux. O contrato HTTP permanece compatível com o workflow ativo do n8n.

## Ordem de leitura

1. valida a assinatura real do arquivo e corrige MIME incorreto;
2. extrai campos fiscais determinísticos de XML;
3. usa texto interno em PDF eletrônico;
4. em imagens e PDFs digitalizados, normaliza orientação, tamanho, contraste e nitidez;
5. executa OCR local com Tesseract e leitura de QR/códigos com ZBar;
6. usa Nemotron OCR v2 somente quando a evidência local não atinge o limiar;
7. anexa sinais determinísticos de CNPJ, chave de acesso, datas e valores para a classificação posterior.

Na V3.1, chaves fiscais de 44 dígitos também passam pela validação do dígito verificador. O modelo documental é derivado da posição oficial da chave (`55 = NF-e`, `65 = NFC-e`, `57 = CT-e`, `58 = MDF-e`) e exposto em `signals.access_key_models`. Essa evidência determinística deve prevalecer sobre o subtipo sugerido pelo modelo de linguagem.

O Nemotron 3.5 Lightning continua responsável por classificar e estruturar o texto. Arquivos temporários são removidos depois de cada requisição.

## Testes

```bash
node --test server.test.mjs
docker build -t plx-document-reader:test .
```

Variáveis principais: `LOCAL_OCR_MIN_SCORE`, `NVIDIA_OCR_ENABLED`, `MAX_PDF_PAGES`, `MAX_PDF_IMAGE_DIMENSION`, `UPSTREAM_TIMEOUT_MS` e `MAX_BODY_BYTES`.
