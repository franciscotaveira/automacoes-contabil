"""Host-side read-only adapters. No Docker socket or provider key in the web service."""
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import time

BASE = Path(os.environ.get('PANEL_DATA', '/opt/plx-operations-panel/data'))
GROUP = '{{WHATSAPP_GROUP_ID}}@g.us'
WORKFLOW = 'plxUnifiedV35Draft'


def command(args, timeout=15):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=timeout).stdout


def object_value(value):
    try:
        result = json.loads(value or '{}')
        return result if isinstance(result, dict) else {}
    except (TypeError, ValueError):
        return {}


def project_job(row):
    p, r = object_value(row.get('payload_json')), object_value(row.get('response_json'))
    # This adapter belongs only to the existing PLX queue. No heuristic company matching.
    if p.get('group_id') != GROUP or p.get('tenant_id') not in (None, '', 'plx'):
        return None
    file_id = str(r.get('drive_file_id') or '')
    if not file_id or not all(c.isalnum() or c in '-_' for c in file_id):
        file_id = ''
    return {
        'id': str(row['id']), 'tenant_id': 'plx', 'group_id': GROUP,
        'scope_source': 'legacy_plx_queue_binding',
        'filename': str(p.get('source_filename') or 'Arquivo sem nome')[:240],
        'mime_type': str(p.get('mime_type') or '')[:80],
        'status': row['status'], 'attempts': row['attempts'],
        'received_at': str(p.get('received_at') or '')[:40],
        'created_at': row['created_at'], 'updated_at': row['updated_at'],
        'declared_outcome': str(r.get('status') or 'UNKNOWN')[:60],
        'review': 'PENDENTE' if r.get('review_required') is True else
                  ('NAO_INDICADA' if r.get('review_required') is False else 'DESCONHECIDA'),
        'document_type': str(r.get('document_type') or '')[:60],
        'department': str(r.get('department') or '')[:60],
        'drive_file_id': file_id, 'drive_path': str(r.get('drive_path') or '')[:800],
        'storage': 'REFERENCIA_REGISTRADA' if file_id else 'SEM_REFERENCIA',
        'integrity': 'NAO_VERIFICADA', 'notification': 'DESCONHECIDA',
        'error': 'FALHA_REGISTRADA_CONSULTAR_EXECUCAO' if row.get('last_error') else '',
    }


def collect_jobs():
    source = '''import sqlite3,json
c=sqlite3.connect("file:/data/plx-ingress.sqlite3?mode=ro",uri=True,timeout=5)
c.row_factory=sqlite3.Row
c.execute("PRAGMA query_only=ON")
print(json.dumps([dict(r) for r in c.execute("SELECT * FROM jobs ORDER BY id DESC")]))'''
    rows = json.loads(command(['docker', 'exec', 'plx-documentos-plx-ingress-queue-1', 'python', '-c', source]))
    return [job for row in rows if (job := project_job(row)) is not None]


def collect_executions():
    sql = '''BEGIN READ ONLY;
SELECT coalesce(json_agg(t),'[]'::json) FROM
(SELECT id,status,mode,"startedAt","stoppedAt","workflowVersionId"
 FROM execution_entity WHERE "workflowId"='plxUnifiedV35Draft'
 AND "deletedAt" IS NULL ORDER BY id DESC LIMIT 30) t;
COMMIT;'''
    value = command(['docker', 'exec', 'plx-documentos-postgres-1', 'psql', '-X', '-qAt',
                     '-U', 'n8n_plx', '-d', 'n8n_plx', '-c', sql])
    return json.loads(value.strip())


def collect_session():
    # Only status leaves the WAHA container; never return config, headers or phone.
    js = '''fetch('http://127.0.0.1:3000/api/sessions/plx-documentos',
{headers:{'X-Api-Key':process.env.WAHA_API_KEY},signal:AbortSignal.timeout(5000)})
.then(async r=>{if(!r.ok)throw Error('status');const x=await r.json();
console.log(JSON.stringify({name:x.name,status:x.status}));}).catch(()=>process.exit(1));'''
    return json.loads(command(['docker', 'exec', 'sos-sales-waha', 'node', '-e', js]))


def collect_health():
    code = '''import json,urllib.request
result={}
for name,url in [('n8n','http://n8n:5678/healthz/readiness'),('queue','http://127.0.0.1:8090/health'),('reader','http://document-ai-gateway:8080/health')]:
 try:
  with urllib.request.urlopen(url,timeout=3) as r: result[name]='UP' if r.status==200 else 'UNAVAILABLE'
 except Exception: result[name]='UNAVAILABLE'
print(json.dumps(result))'''
    return json.loads(command(['docker', 'exec', 'plx-documentos-plx-ingress-queue-1', 'python', '-c', code]))


def observe(db, documents, now):
    db.execute('CREATE TABLE IF NOT EXISTS observations (id INTEGER PRIMARY KEY, document_id TEXT, digest TEXT, observed_at REAL, state TEXT)')
    db.execute('CREATE INDEX IF NOT EXISTS observations_doc ON observations(document_id,id)')
    for doc in documents:
        state = {k: doc[k] for k in ('status', 'attempts', 'declared_outcome', 'review', 'storage', 'notification', 'updated_at')}
        encoded = json.dumps(state, sort_keys=True)
        digest = hashlib.sha256(encoded.encode()).hexdigest()
        last = db.execute('SELECT digest FROM observations WHERE document_id=? ORDER BY id DESC LIMIT 1', (doc['id'],)).fetchone()
        if not last or last[0] != digest:
            db.execute('INSERT INTO observations(document_id,digest,observed_at,state) VALUES (?,?,?,?)', (doc['id'], digest, now, encoded))
        doc['observations'] = [dict(observed_at=r[0], state=json.loads(r[1])) for r in
                               db.execute('SELECT observed_at,state FROM observations WHERE document_id=? ORDER BY id DESC LIMIT 100', (doc['id'],))]
    db.commit()


def main():
    BASE.mkdir(parents=True, exist_ok=True)
    sources = {}
    snapshot = {'generated_at': time.time(), 'sources': sources, 'documents': [], 'executions': [],
                'session': {}, 'health': {}, 'coverage': 'PARTIAL',
                'coverage_note': 'Fila histórica e observações desde a ativação do painel. Captura completa do WhatsApp, integridade do Drive e entrega das confirmações ainda não reconciliadas.'}
    for name, fn in [('documents', collect_jobs), ('executions', collect_executions), ('session', collect_session), ('health', collect_health)]:
        try:
            snapshot[name] = fn()
            sources[name] = {'status': 'OK', 'observed_at': time.time()}
        except Exception:
            # Do not cache old data as current or include stderr with credentials in errors.
            sources[name] = {'status': 'UNAVAILABLE', 'observed_at': time.time()}
    with sqlite3.connect(BASE / 'observations.sqlite3') as db:
        observe(db, snapshot['documents'], time.time())
    temporary = BASE / 'snapshot.tmp'
    temporary.write_text(json.dumps(snapshot, ensure_ascii=False))
    temporary.chmod(0o644)
    temporary.replace(BASE / 'snapshot.json')


if __name__ == '__main__':
    main()
