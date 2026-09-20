#!/usr/bin/env bash
# バックアップからDBを復元する(現在のDBの中身は上書きされる)。
# 使い方: bash scripts/restore-db.sh backups/cutsalon_2026-09-20_155201.dump
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${1:-}" ]; then
  echo "使い方: bash scripts/restore-db.sh <backups/xxxx.dump>"
  exit 1
fi

PG_RESTORE="/c/Program Files/PostgreSQL/16/bin/pg_restore.exe"
DB_URL=$(grep '^DATABASE_URL=' .env.local | sed -E 's/^DATABASE_URL="(.*)"$/\1/' | sed -E 's/\?schema=public$//')

MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*" "$PG_RESTORE" --clean --if-exists -d "$DB_URL" "$1"
echo "restored from $1"
