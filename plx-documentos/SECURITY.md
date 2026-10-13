# Segurança e privacidade

Este projeto processa documentos que podem conter dados pessoais, fiscais e bancários. O operador é responsável por definir base legal, consentimento, retenção e acesso por cliente antes do cutover.

## Controles obrigatórios

- Guarde credenciais em cofre ou arquivo `.env` no servidor com permissão `0600`. Nunca coloque chaves em workflows, commits ou capturas de tela.
- Isole cada escritório por `tenant_id`, sessão WAHA, raiz do Drive e credenciais próprias.
- Envie ao modelo externo somente o texto e os sinais mínimos necessários. Imagens completas exigem necessidade documentada e autorização do cliente.
- Não registre conteúdo integral, token, CPF, CNPJ, telefone ou e-mail nos logs. Use `node plx-documentos/tools/mask-logs.js arquivo.log` antes de compartilhar evidências.
- Faça rotação imediata de qualquer chave exposta e preserve trilha de auditoria da rotação.
- Trate OCR e IA como entrada não confiável. CNPJ e chave fiscal exigem validação determinística; baixa confiança segue para revisão humana.
- Restrinja `/metrics` e a fila de revisão com chaves diferentes e TLS no proxy.

## Verificação local

```bash
node plx-documentos/tools/scan-secrets.js
```

O scanner informa apenas arquivo e classe do achado para não repetir um segredo no log. Ele é uma barreira básica; revisão humana e secret scanning do provedor continuam necessários.
