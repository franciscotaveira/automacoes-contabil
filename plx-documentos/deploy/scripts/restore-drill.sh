#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

latest_complete_backup() {
  for candidate in $(find backups -mindepth 1 -maxdepth 1 -type d -name '[0-9]*' | sort -r); do
    test -f "$candidate/SHA256SUMS" || continue
    test -f "$candidate/n8n-plx.dump" || continue
    test -f "$candidate/plx-ingress.sqlite3" || continue
    test -f "$candidate/n8n-data.tgz" || continue
    test -f "$candidate/waha-sessions.tgz" || continue
    test -f "$candidate/offsite-plx-backup.tar.gz.enc" || continue
    printf '%s\n' "$candidate"
    return 0
  done
  return 1
}

backup_dir=${1:-$(latest_complete_backup || true)}
test -n "$backup_dir" && test -d "$backup_dir" || { echo 'ERRO: backup completo ausente'; exit 1; }
for artifact in SHA256SUMS n8n-plx.dump plx-ingress.sqlite3 n8n-data.tgz waha-sessions.tgz compose.yaml env.enc offsite-plx-backup.tar.gz.enc; do
  test -f "$backup_dir/$artifact" || { echo "ERRO: artefato ausente: $artifact" >&2; exit 1; }
done

restore_db="plx_restore_drill_$(date -u +%Y%m%d%H%M%S)"
cleanup() {
  docker compose exec -T postgres dropdb -U n8n_plx --if-exists "$restore_db" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker compose exec -T postgres createdb -U n8n_plx "$restore_db"
docker compose exec -T postgres pg_restore -U n8n_plx -d "$restore_db" --no-owner --no-privileges < "$backup_dir/n8n-plx.dump"

tables=$(docker compose exec -T postgres psql -U n8n_plx -d "$restore_db" -Atc \
  "select count(*) from information_schema.tables where table_schema='public';")
workflows=$(docker compose exec -T postgres psql -U n8n_plx -d "$restore_db" -Atc \
  "select count(*) from workflow_entity;")
credentials=$(docker compose exec -T postgres psql -U n8n_plx -d "$restore_db" -Atc \
  "select count(*) from credentials_entity;")
test "$tables" -gt 0
test "$workflows" -ge 1
test "$credentials" -ge 2

sqlite_result=$(python3 -c 'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); print(c.execute("PRAGMA integrity_check").fetchone()[0]); c.close()' \
  "$backup_dir/plx-ingress.sqlite3")
test "$sqlite_result" = "ok"

for archive in n8n-data.tgz waha-sessions.tgz; do
  tar -tzf "$backup_dir/$archive" >/dev/null
done

printf 'RESTORE_DRILL_OK database=%s tables=%s workflows=%s credentials=%s queue=%s\n' \
  "$restore_db" "$tables" "$workflows" "$credentials" "$sqlite_result"
