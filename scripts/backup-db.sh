#!/usr/bin/env bash
# DBの現在の状態をバックアップする。
# 使い方: Git Bash から `bash scripts/backup-db.sh` を実行(リスクのある修正の前に毎回実行する)
set -euo pipefail
cd "$(dirname "$0")/.."

PG_DUMP="/c/Program Files/PostgreSQL/16/bin/pg_dump.exe"
DB_URL=$(grep '^DATABASE_URL=' .env.local | sed -E 's/^DATABASE_URL="(.*)"$/\1/' | sed -E 's/\?schema=public$//')
STAMP=$(date +%Y-%m-%d_%H%M%S)
OUT="backups/cutsalon_${STAMP}.dump"

mkdir -p backups
MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*" "$PG_DUMP" -F c -f "$OUT" "$DB_URL"
echo "backup saved to $OUT"
