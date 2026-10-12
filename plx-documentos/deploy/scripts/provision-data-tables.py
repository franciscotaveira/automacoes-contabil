#!/usr/bin/env python3
"""Idempotently provision the three PLX Data Tables through n8n's public API."""
import json
import os
import urllib.parse
import urllib.request

BASE = os.environ.get("N8N_API_BASE", "http://127.0.0.1:5679/api/v1")
KEY = os.environ["N8N_API_KEY"]

manifest = [
    ("idempotency_key","string"),("message_id","string"),("sha256","string"),("group_id","string"),
    ("sender_id","string"),("source_file_id","string"),("original_filename","string"),("mime_type","string"),
    ("status","string"),("document_type","string"),("department","string"),("issuer_cnpj","string"),
    ("issuer_name_raw","string"),("issuer_name_canonical","string"),("identity_status","string"),
    ("issuer_name","string"),("recipient_name","string"),
    ("reference_date","string"),("document_number","string"),("confidence","number"),
    ("review_required","boolean"),("review_reason","string"),("drive_file_id","string"),("drive_path","string"),
    ("organized_filename","string"),("organized_path","string"),("drive_web_url","string"),
    ("extract_ms","number"),("classify_ms","number"),("drive_ms","number"),("total_ms","number"),
    ("attempt_count","number"),("last_error","string"),("received_at","date"),("organized_at","date"),("updated_at","date"),
]
issuers = [("issuer_cnpj","string"),("canonical_name","string"),("verified","boolean"),("notes","string")]
benchmark = [
    ("benchmark_id","string"),("source_file_id","string"),("source_filename","string"),("mime_type","string"),
    ("status","string"),("document_type","string"),("department","string"),("issuer_name","string"),
    ("reference_date","string"),("confidence","number"),("review_required","boolean"),("review_reason","string"),
    ("extraction_route","string"),("model","string"),("drive_file_id","string"),("drive_path","string"),
    ("extract_ms","number"),("classify_ms","number"),("drive_ms","number"),("total_ms","number"),
    ("started_at","date"),("finished_at","date"),
]
specs = {
    "PLX_MANIFEST_TABLE_ID": ("plx_v3_documentos", manifest),
    "PLX_ISSUERS_TABLE_ID": ("plx_v3_emitentes_canonicos", issuers),
    "PLX_BENCHMARK_TABLE_ID": ("plx_benchmark_v3_execucoes", benchmark),
}

def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
        headers={"X-N8N-API-KEY": KEY, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as response:
        raw = response.read()
        return json.loads(raw) if raw else {}

existing = call("GET", "/data-tables?limit=100").get("data", [])
by_name = {table["name"]: table for table in existing}
result = {}
for env_name, (name, columns) in specs.items():
    table = by_name.get(name)
    if table is None:
        table = call("POST", "/data-tables", {"name": name, "columns": [{"name": n, "type": t} for n,t in columns]})
    actual = {c["name"]: c["type"] for c in table.get("columns", [])}
    expected = dict(columns)
    for column_name, column_type in columns:
        if column_name not in actual:
            call("POST", f"/data-tables/{table['id']}/columns", {"name": column_name, "type": column_type})
    if set(expected) - set(actual):
        table = next(t for t in call("GET", "/data-tables?limit=100").get("data", []) if t["id"] == table["id"])
        actual = {c["name"]: c["type"] for c in table.get("columns", [])}
    if actual != expected:
        missing = sorted(set(expected) - set(actual))
        wrong = sorted(n for n in set(expected) & set(actual) if expected[n] != actual[n])
        raise SystemExit(f"SCHEMA_MISMATCH:{name}:missing={missing}:wrong={wrong}")
    result[env_name] = table["id"]

for key, value in result.items():
    print(f"{key}={value}")
