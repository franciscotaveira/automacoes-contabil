FROM python:3.13-alpine@sha256:2d9aefe2fef018a7eb2c13064c89c71929800fd2e5dccdbf52ea5da5bb8d929a
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
WORKDIR /app
COPY queue_service.py /app/queue_service.py
RUN addgroup -S app && adduser -S -G app app && mkdir -p /data && chown app:app /data
USER app
EXPOSE 8090
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:8090/health >/dev/null || exit 1
CMD ["python", "/app/queue_service.py"]
