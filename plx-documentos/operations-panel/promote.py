"""Run on VPS after a verified backup. Add only /operacao/ to the existing host."""
import hashlib
import json
import subprocess
from pathlib import Path

BASE = Path('/opt/plx-operations-panel')
backup = Path((BASE / 'backup-path.txt').read_text().strip())
hashes = json.loads((backup / 'SHA256.json').read_text())
for name, expected in hashes.items():
    assert hashlib.sha256((backup / name).read_bytes()).hexdigest() == expected, 'BACKUP_HASH_MISMATCH'
path = Path('/opt/sos-sales/Caddyfile')
original = path.read_text()
assert original == (backup / 'Caddyfile').read_text(), 'CADDY_CHANGED_SINCE_BACKUP'
needle = 'automacao.iaparavendas.tech {\n    encode zstd gzip\n    reverse_proxy n8n:5678\n}'
replacement = '''automacao.iaparavendas.tech {
    encode zstd gzip
    redir /operacao /operacao/ 308
    handle_path /operacao/* {
        reverse_proxy plx-operations-panel:8095
    }
    handle {
        reverse_proxy n8n:5678
    }
}'''
assert original.count(needle) == 1, 'CADDY_TARGET_NOT_EXACT'
subprocess.run(['docker','compose','-f',str(BASE/'compose.yaml'),'up','-d'],check=True)
path.write_text(original.replace(needle,replacement))
try:
    subprocess.run(['docker','exec','sos-sales-caddy','caddy','validate','--config','/etc/caddy/Caddyfile'],check=True)
    subprocess.run(['docker','exec','sos-sales-caddy','caddy','reload','--config','/etc/caddy/Caddyfile'],check=True)
except Exception:
    path.write_text(original)
    subprocess.run(['docker','exec','sos-sales-caddy','caddy','reload','--config','/etc/caddy/Caddyfile'],check=True)
    raise
for name in ['plx-panel-collector.service','plx-panel-collector.timer']:
    Path('/etc/systemd/system',name).write_bytes((BASE/name).read_bytes())
subprocess.run(['systemctl','daemon-reload'],check=True)
subprocess.run(['systemctl','enable','--now','plx-panel-collector.timer'],check=True)
print('Panel route installed; workflow and WAHA routes preserved.')
