"""Small tenant-scoped review inbox for unresolved document metadata."""
import hmac
import os
import sqlite3
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

ROOT = Path(__file__).parent


def create_app(db_path=None, shared_key=None):
    app = Flask(__name__, static_folder=None)
    app.config['DB_PATH'] = str(db_path or os.environ.get('REVIEW_DB_PATH', '/data/review.sqlite3'))
    app.config['SHARED_KEY'] = shared_key if shared_key is not None else os.environ.get('REVIEW_SHARED_KEY', '')

    def connect():
        db = sqlite3.connect(app.config['DB_PATH'])
        db.row_factory = sqlite3.Row
        return db

    Path(app.config['DB_PATH']).parent.mkdir(parents=True, exist_ok=True)
    with connect() as db:
        db.execute('''CREATE TABLE IF NOT EXISTS review_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id TEXT NOT NULL,
            correlation_id TEXT NOT NULL,
            filename TEXT,
            reason TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'PENDING',
            claimed_by TEXT,
            resolution TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (tenant_id, correlation_id)
        )''')

    @app.before_request
    def authorize_api():
        if not request.path.startswith('/api/'):
            return None
        configured = app.config['SHARED_KEY']
        if not configured or configured == 'CHANGE_ME':
            return jsonify(error='review_key_not_configured'), 503
        if not hmac.compare_digest(request.headers.get('X-Review-Key', ''), configured):
            return jsonify(error='unauthorized'), 401
        if not request.headers.get('X-Tenant-ID', '').strip():
            return jsonify(error='tenant_required'), 400
        return None

    @app.get('/')
    def index():
        return send_from_directory(ROOT / 'static', 'index.html')

    @app.get('/app.js')
    def script():
        return send_from_directory(ROOT / 'static', 'app.js')

    @app.get('/health')
    def health():
        return jsonify(ok=True, service='ops-review')

    @app.get('/api/items')
    def list_items():
        tenant = request.headers['X-Tenant-ID'].strip()
        status = request.args.get('status', 'PENDING')
        with connect() as db:
            rows = db.execute('SELECT * FROM review_items WHERE tenant_id=? AND status=? ORDER BY created_at', (tenant, status)).fetchall()
        return jsonify(items=[dict(row) for row in rows])

    @app.post('/api/items')
    def enqueue_item():
        tenant = request.headers['X-Tenant-ID'].strip()
        payload = request.get_json(silent=True) or {}
        correlation_id = str(payload.get('correlation_id', '')).strip()
        reason = str(payload.get('reason', '')).strip()
        if not correlation_id or not reason:
            return jsonify(error='correlation_id_and_reason_required'), 400
        with connect() as db:
            db.execute('INSERT OR IGNORE INTO review_items (tenant_id,correlation_id,filename,reason) VALUES (?,?,?,?)',
                       (tenant, correlation_id, str(payload.get('filename', ''))[:240], reason[:500]))
            row = db.execute('SELECT * FROM review_items WHERE tenant_id=? AND correlation_id=?', (tenant, correlation_id)).fetchone()
        return jsonify(item=dict(row)), 202

    @app.post('/api/items/<int:item_id>/claim')
    def claim_item(item_id):
        tenant = request.headers['X-Tenant-ID'].strip()
        actor = str((request.get_json(silent=True) or {}).get('actor', '')).strip()
        if not actor:
            return jsonify(error='actor_required'), 400
        with connect() as db:
            changed = db.execute("UPDATE review_items SET status='CLAIMED',claimed_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=? AND status='PENDING'", (actor[:120], item_id, tenant)).rowcount
            row = db.execute('SELECT * FROM review_items WHERE id=? AND tenant_id=?', (item_id, tenant)).fetchone()
        return (jsonify(item=dict(row)), 200) if changed else (jsonify(error='item_not_claimable'), 409)

    @app.post('/api/items/<int:item_id>/resolve')
    def resolve_item(item_id):
        tenant = request.headers['X-Tenant-ID'].strip()
        resolution = str((request.get_json(silent=True) or {}).get('resolution', '')).strip()
        if not resolution:
            return jsonify(error='resolution_required'), 400
        with connect() as db:
            changed = db.execute("UPDATE review_items SET status='RESOLVED',resolution=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=? AND status='CLAIMED'", (resolution[:1000], item_id, tenant)).rowcount
            row = db.execute('SELECT * FROM review_items WHERE id=? AND tenant_id=?', (item_id, tenant)).fetchone()
        return (jsonify(item=dict(row)), 200) if changed else (jsonify(error='item_not_resolvable'), 409)

    return app


if __name__ == '__main__':
    create_app().run(host='127.0.0.1', port=int(os.environ.get('REVIEW_PORT', '8095')))
