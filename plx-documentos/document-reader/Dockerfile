FROM node:22-alpine

RUN apk add --no-cache \
    imagemagick \
    poppler-utils \
    tesseract-ocr \
    tesseract-ocr-data-eng \
    tesseract-ocr-data-por \
    zbar

WORKDIR /app
COPY server.mjs /app/server.mjs

USER node
EXPOSE 8080
CMD ["node", "/app/server.mjs"]
