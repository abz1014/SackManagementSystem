#!/usr/bin/env bash
# build-bundle.sh - stage a SOURCE-FREE install package for a plant PC and zip it.
#
#   bash deploy/build-bundle.sh [OUT_DIR]        (run `npm run build` first)
#
# Ships compiled JavaScript only: no TypeScript, no .map, no .d.ts, no tests,
# no src folders. node_modules\@sms\* are NOT shipped (npm makes them links
# back into this repo); install.ps1 re-links them on the target PC.
# Prerequisite installers are taken from $PREREQS (Node 22 MSI, nssm.exe).
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
OUT_ROOT="${1:-/c/Users/ABDULLAH SAJID/Desktop/SMS-install}"
PREREQS="${PREREQS:-$OUT_ROOT/prereqs}"
OUT="$OUT_ROOT/sms"
ZIP="$OUT_ROOT/SMS-install.zip"

[ -f "$SRC/api/dist/index.js" ] || { echo "no api/dist: run npm run build first"; exit 1; }
ls "$PREREQS"/node-v22*-x64.msi >/dev/null 2>&1 || { echo "missing Node 22 MSI in $PREREQS"; exit 1; }
[ -f "$PREREQS/nssm.exe" ] || { echo "missing nssm.exe in $PREREQS"; exit 1; }
[ ! -e "$OUT" ] || { echo "$OUT already exists: remove it first"; exit 1; }
mkdir -p "$OUT"

copy_dist() { # compiled .js plus non-code runtime assets, never maps/types/tests
  mkdir -p "$OUT/$1"
  cp "$SRC/$1/package.json" "$OUT/$1/"
  (cd "$SRC/$1" && find dist -type f \
      ! -name '*.map' ! -name '*.d.ts' ! -name '*.tsbuildinfo' ! -name '*.test.*' ! -name '__*' ! -path '*__tests__*' \
      -exec bash -c 'mkdir -p "$0/$(dirname "$1")" && cp "$1" "$0/$1"' "$OUT/$1" {} \;)
}
for w in shared sync-worker cli api; do copy_dist "$w"; done

mkdir -p "$OUT/web" "$OUT/web-next" "$OUT/scripts" "$OUT/logs" "$OUT/prereqs"
cp -r "$SRC/web/dist" "$OUT/web/dist"
cp -r "$SRC/web-next/dist" "$OUT/web-next/dist"
cp -r "$SRC/db" "$OUT/db"
cp "$SRC/scripts/migrate.mjs" "$SRC/scripts/migrate-core.mjs" "$SRC/scripts/backup-appdb.ps1" \
   "$SRC/scripts/backup-config.ps1" "$SRC/scripts/install-scheduled-tasks.ps1" "$SRC/scripts/db-maintenance.sql" "$OUT/scripts/"
cp "$SRC/.env.example" "$OUT/.env.example"
cp "$SRC/deploy/bundle/install.ps1" "$SRC/deploy/bundle/uninstall.ps1" "$SRC/deploy/bundle/link-packages.cmd" "$SRC/deploy/bundle/INSTALL.txt" "$OUT/"
cp "$PREREQS"/node-v22*-x64.msi "$PREREQS/nssm.exe" "$OUT/prereqs/"
[ -f "$PREREQS/node-SHASUMS256.txt" ] && cp "$PREREQS/node-SHASUMS256.txt" "$OUT/prereqs/"

# Root package.json with only the four runtime workspaces, then production deps.
node -e '
const p=require(process.argv[1]);
const out={name:"sms",version:p.version,private:true,engines:p.engines,
  workspaces:["shared","sync-worker","cli","api"],dependencies:{mssql:p.devDependencies.mssql},overrides:p.overrides};
require("fs").writeFileSync(process.argv[2],JSON.stringify(out,null,2));
' "$SRC/package.json" "$OUT/package.json"
cp "$SRC/package-lock.json" "$OUT/package-lock.json"
(cd "$OUT" && npm install --omit=dev --no-audit --no-fund >/dev/null)
rm -f "$OUT/package-lock.json"

# Remove npm's workspace links (junctions) so the zip carries no links.
WIN_OUT="$(cygpath -w "$OUT")"
for w in shared sync-worker cli api web web-next; do
  [ -e "$OUT/node_modules/@sms/$w" ] && cmd //c rmdir "$WIN_OUT\\node_modules\\@sms\\$w" >/dev/null
done

# Guard: refuse to zip anything that looks like source.
bad=$(find "$OUT" -path "$OUT/node_modules" -prune -o \( -name '*.ts' -o -name '*.tsx' -o -name '*.map' -o -type d -name src \) -print | wc -l)
links=$(find "$OUT" -type l | wc -l)
[ "$bad" -eq 0 ] && [ "$links" -eq 0 ] || { echo "REFUSED: $bad source-like files, $links links in $OUT"; exit 1; }
[ ! -f "$OUT/.env" ] || { echo "REFUSED: a .env is in the bundle"; exit 1; }

rm -f "$ZIP"
powershell -NoProfile -Command "Compress-Archive -Path '$WIN_OUT' -DestinationPath '$(cygpath -w "$ZIP")'"
echo "bundle: $OUT"
echo "zip:    $ZIP ($(du -h "$ZIP" | cut -f1))"
