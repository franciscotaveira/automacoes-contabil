"""Authenticated read-only operational panel. No provider access or mutation endpoint."""
import base64
import hashlib
import hmac
import json
import os
import threading
import time
from collections import Counter, deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).parent
DATA = Path(os.environ.get('PANEL_DATA', '/data'))
AUTH = Path(os.environ.get('PANEL_AUTH', '/config/users.json'))
LOCK = threading.Lock()
FAILURES = deque(maxlen=100)


def authenticate(header, users):
    try:
        scheme, encoded = header.split(' ', 1)
        if scheme.lower() != 'basic': return None
        username, password = base64.b64decode(encoded, validate=True).decode().split(':', 1)
        user = users.get(username)
        if not user: return None
        key = hashlib.scrypt(password.encode(), salt=bytes.fromhex(user['salt']), n=16384, r=8, p=1).hex()
        return user if hmac.compare_digest(key, user['hash']) else None
    except (ValueError, UnicodeError, KeyError):
        return None


def scoped(snapshot, user):
    tenants = set(user.get('tenants', []))
    return [d for d in snapshot.get('documents', []) if d.get('tenant_id') in tenants]


def operational_summary(documents, executions):
    """Expose only what persisted sources prove; provider delivery is never inferred."""
    statuses = Counter(d['status'] for d in documents)
    active = statuses['queued'] + statuses['processing'] + statuses['retry']
    technical_errors = sum(e.get('status') == 'error' for e in executions)
    stages = [
        {'id': 'ingress', 'label': 'Entrada persistida', 'value': len(documents), 'detail': 'Registros existentes na fila durável.', 'state': 'ok'},
        {'id': 'queue', 'label': 'Aguardando processamento', 'value': active, 'detail': 'Na fila, em processamento ou em nova tentativa.', 'state': 'attention' if active else 'ok', 'filter': 'queued'},
        {'id': 'worker', 'label': 'Concluído na fila', 'value': statuses['done'], 'detail': 'Resultado técnico registrado pela fila; não confirma entrega ao cliente.', 'state': 'attention' if statuses['failed'] else 'ok', 'filter': 'done'},
        {'id': 'drive', 'label': 'Referência no Drive', 'value': sum(bool(d['drive_file_id']) for d in documents), 'detail': 'Referência retornada pelo processo. A integridade física ainda não foi reconciliada.', 'state': 'unknown'},
        {'id': 'notify', 'label': 'Confirmação no WhatsApp', 'value': 0, 'detail': 'Sem reconciliação de entrega disponível nesta fonte.', 'state': 'unknown'},
    ]
    attention = [
        {'id': 'failed', 'label': 'Falhas registradas', 'value': statuses['failed'], 'detail': 'Abrir os documentos com falha e consultar a execução correlata.', 'state': 'critical', 'filter': 'failed'},
        {'id': 'active', 'label': 'Aguardando ação do fluxo', 'value': active, 'detail': 'Inclui fila, processamento e nova tentativa.', 'state': 'attention' if active else 'ok', 'filter': 'queued'},
        {'id': 'review', 'label': 'Revisões indicadas', 'value': sum(d['review'] == 'PENDENTE' for d in documents), 'detail': 'Documento organizado com informação que pede conferência humana.', 'state': 'attention'},
        {'id': 'n8n', 'label': 'Erros técnicos recentes no n8n', 'value': technical_errors, 'detail': 'Podem incluir testes manuais e eventos sem documento; não são vinculados automaticamente a um arquivo.', 'state': 'attention' if technical_errors else 'ok'},
    ]
    return stages, attention


def client_summaries(documents):
    grouped = {}
    for doc in documents:
        grouped.setdefault(doc.get('tenant_id') or 'unknown', []).append(doc)
    result = []
    for tenant, entries in grouped.items():
        counts = Counter(d['status'] for d in entries)
        result.append({'id': tenant, 'name': 'PLX Contabilidade' if tenant == 'plx' else tenant,
                       'documents': len(entries), 'completed': counts['done'],
                       'active': counts['queued'] + counts['processing'] + counts['retry'],
                       'failed': counts['failed'], 'reviews': sum(d['review'] == 'PENDENTE' for d in entries),
                       'drive_references': sum(bool(d['drive_file_id']) for d in entries),
                       'last_activity': max((d.get('updated_at') or d.get('created_at') or '') for d in entries),
                       'groups': len({d.get('group_id') for d in entries if d.get('group_id')})})
    return sorted(result, key=lambda x: x['name'].casefold())


def metrics_snapshot(documents):
    """Counters derived from the latest durable snapshot; no delivery is inferred."""
    return {
        'document_received_total': len(documents),
        'document_archived_total': sum(bool(d.get('drive_file_id')) for d in documents),
        'reinforcement_failures_total': sum(
            'REINFORCEMENT' in str(d.get('review_reason', '')).upper()
            or 'REINFORCEMENT' in str(d.get('last_error', '')).upper()
            for d in documents
        ),
        'reconciliation_discrepancies_total': sum(
            d.get('integrity') not in (None, 'VERIFICADA') for d in documents
        ),
    }


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, value, mime='application/json; charset=utf-8', challenge=False):
        payload = json.dumps(value, ensure_ascii=False).encode() if isinstance(value, (dict, list)) else value
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
        if challenge: self.send_header('WWW-Authenticate', 'Basic realm="Operacao documental", charset="UTF-8"')
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        path = urlsplit(self.path)
        if path.path == '/healthz': return self.reply(200, {'ok': True})
        try:
            users = json.loads(AUTH.read_text())
        except Exception:
            return self.reply(503, {'error': 'AUTH_UNAVAILABLE'})
        with LOCK:
            now = time.time()
            while FAILURES and FAILURES[0] < now - 60: FAILURES.popleft()
            limited = len(FAILURES) >= 30
        if limited: return self.reply(429, {'error': 'TOO_MANY_ATTEMPTS'})
        user = authenticate(self.headers.get('Authorization', ''), users)
        if not user:
            if self.headers.get('Authorization'):
                with LOCK: FAILURES.append(time.time())
            return self.reply(401, {'error': 'UNAUTHORIZED'}, challenge=True)
        static = {'/': ('index.html','text/html; charset=utf-8'),
                  '/app.js': ('app.js','text/javascript; charset=utf-8'),
                  '/style.css': ('style.css','text/css; charset=utf-8'),
                  '/compact.css': ('compact.css','text/css; charset=utf-8'),
                  '/layout.css': ('layout.css','text/css; charset=utf-8')}
        if path.path in static:
            name, mime = static[path.path]
            return self.reply(200, (ROOT / 'static' / name).read_bytes(), mime)
        if not path.path.startswith('/api/'): return self.reply(404, {'error': 'NOT_FOUND'})
        try:
            snapshot = json.loads((DATA / 'snapshot.json').read_text())
        except Exception:
            return self.reply(503, {'error': 'SNAPSHOT_UNAVAILABLE'})
        age = max(0, time.time()-snapshot['generated_at'])
        metadata = {'generated_at': snapshot['generated_at'], 'age_seconds': round(age), 'stale': age > 90,
                    'coverage': snapshot['coverage'], 'coverage_note': snapshot['coverage_note'], 'sources': snapshot['sources']}
        docs = scoped(snapshot, user)
        all_scoped_docs = docs[:]
        query = parse_qs(path.query)
        requested_tenant = query.get('tenant', [''])[0]
        if requested_tenant:
            docs = [d for d in docs if d.get('tenant_id') == requested_tenant]
        # The legacy source is exclusively PLX. An unknown tenant receives no source-level data.
        plx = 'plx' in user.get('tenants', [])
        if path.path == '/api/metrics':
            return self.reply(200, {**metadata, 'metrics': metrics_snapshot(docs)})
        if path.path == '/api/overview':
            stages, attention = operational_summary(docs, snapshot['executions'] if plx else [])
            return self.reply(200, {**metadata, 'office': 'PLX Contabilidade' if plx else 'Sem escritório vinculado',
                'counts': dict(Counter(d['status'] for d in docs)), 'total': len(docs),
                'reviews': sum(d['review']=='PENDENTE' for d in docs),
                'storage_references': sum(bool(d['drive_file_id']) for d in docs),
                'notification_unknown': len(docs),
                'session': snapshot['session'] if plx else {}, 'health': snapshot['health'] if plx else {},
                'executions': snapshot['executions'] if plx else [], 'pipeline': stages,
                'attention': attention, 'clients': client_summaries(docs),
                'all_clients': client_summaries(all_scoped_docs)})
        if path.path == '/api/documents':
            try:
                offset = max(0, int(query.get('offset', ['0'])[0]))
                limit = min(100, max(1, int(query.get('limit', ['25'])[0])))
            except ValueError:
                return self.reply(400, {'error': 'INVALID_PAGINATION'})
            term = query.get('q', [''])[0].casefold()
            state = query.get('status', [''])[0]
            group = query.get('group', [''])[0]
            docs = [d for d in docs if (not state or d['status']==state) and (not group or d['group_id']==group)
                    and (not term or term in d['filename'].casefold() or term==d['id'])]
            return self.reply(200, {**metadata, 'total': len(docs), 'offset': offset,
                'items': [{k:v for k,v in d.items() if k!='observations'} for d in docs[offset:offset+limit]]})
        if path.path.startswith('/api/documents/'):
            doc = next((d for d in docs if d['id']==path.path.rsplit('/',1)[-1]), None)
            return self.reply(200, {**metadata, 'document': doc}) if doc else self.reply(404, {'error':'NOT_FOUND'})
        return self.reply(404, {'error': 'NOT_FOUND'})

    def do_POST(self):
        self.reply(405, {'error': 'READ_ONLY'})

    def log_message(self, fmt, *args):
        # Do not log query strings (may include a client's filename) or credentials.
        print(json.dumps({'at': time.time(), 'method': self.command, 'path': urlsplit(self.path).path}), flush=True)


if __name__ == '__main__':
    ThreadingHTTPServer(('0.0.0.0', int(os.environ.get('PORT', '8095'))), Handler).serve_forever()
