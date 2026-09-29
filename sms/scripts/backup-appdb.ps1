# backup-appdb.ps1 — nightly backup of the APP database (ARCHITECTURE §13).
# The app DB holds the only irreplaceable data (product timeline, reject labels,
# users, config, rules). IFL's DB is not ours to back up.
# Schedule via Task Scheduler, or use a SQL Agent job on non-Express editions.
#
#   powershell -File scripts\backup-appdb.ps1 -Server "localhost,14330" -Db sms -Pass "<sms_backup password>" -OutDir "D:\sms-backups"
#
# The login needs the db_backupoperator role on the target database — the
# app's own runtime login (sms_app) deliberately does NOT have it (least
# privilege: the app has no operational reason to ever take a backup of
# itself), so use a separate login provisioned for this script alone. See
# DEPLOY.md's backup section for the exact CREATE LOGIN/ALTER ROLE statements.
#
# -OutDir must be a path the SQL SERVER SERVICE ACCOUNT can write to, not just
# the account running this script — BACKUP DATABASE executes on the server,
# not the client. A path under the instance's own data directory (query it:
# EXEC master.dbo.xp_instance_regread N'HKEY_LOCAL_MACHINE',
# N'Software\Microsoft\MSSQLServer\MSSQLServer', N'BackupDirectory') is
# guaranteed writable without any extra ACL work; an arbitrary user-profile
# temp folder or a bare "Program Files\...\Backup\<subfolder>" typically is not.

param(
  [string]$Server = "localhost,14330",
  [string]$Db     = "sms",
  # Fixes finding L4 (Sep 2026 audit): this default used to be "sms_app" —
  # the app's own runtime login, which this very file's header comment says
  # deliberately does NOT have db_backupoperator. Every "backup written" run
  # on that default would have failed at the sqlcmd step; the default now
  # matches the login DEPLOY.md's setup section actually creates for this.
  [string]$User   = "sms_backup",
  [string]$Pass,
  [string]$OutDir = "C:\sms-backups",
  # W1-C (29 Sep 2026): skip retention pruning for this run — used by a
  # rehearsal or a manual out-of-band backup where the caller wants every
  # file (and its .verified.json marker) left alone regardless of age.
  [switch]$NoPrune
)

$ErrorActionPreference = "Stop"

# No default for -Pass, deliberately: defaulting a backup login's password to
# anything (including $env:APP_DB_PASSWORD, the PREVIOUS behaviour here) risks
# silently running as the wrong login. sms_backup's password is a separate
# credential DEPLOY.md never puts in .env, so there is nothing safe to default
# it to — require it explicitly every run.
#
# TRUSTED CONNECTION (roadmap Phase 11 item 6, 14 Sep 2026): -User "" means
# "connect as the Windows account running this script" (sqlcmd -E), which is
# how scripts\install-scheduled-tasks.ps1 runs it — a scheduled task whose
# run-as account holds db_backupoperator, so no password appears in any task
# argument (they are readable in the task XML). -Pass is required only for a
# SQL login.
if ($User -eq "") {
  $auth = @("-E")
} else {
  if (-not $Pass) {
    Write-Error "-Pass is required with a SQL login (the sms_backup login's password, see DEPLOY.md's backup setup); use -User `"`" for a trusted connection as the current Windows account. Refusing to guess or fall back to another login's credential."
    exit 1
  }
  $auth = @("-U", $User, "-P", $Pass)
}

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$file  = Join-Path $OutDir "$Db-$stamp.bak"

# No COMPRESSION: that option requires SQL Server Standard Edition or higher
# and errors out on Express (Msg 1844) — this project's own chosen engine
# (CLAUDE.md D1). A prior version of this script had COMPRESSION here; it had
# never actually been run against an Express instance, so nothing caught it —
# every "backup written" line it ever printed on Express would have been
# false, for the same reason the exit-code check below now exists.
# CHECKSUM: page checksums are verified as the backup is written and a backup
# checksum is stored with it, so `RESTORE VERIFYONLY ... WITH CHECKSUM` can
# later prove the file is intact without restoring it. Added 14 Sep 2026: the
# rehearsal records described this script as writing WITH CHECKSUM and it did
# not — the checksummed baseline backup had been taken by hand. Supported on
# Express (unlike COMPRESSION, above).
$sql = "BACKUP DATABASE [$Db] TO DISK = N'$file' WITH INIT, CHECKSUM, STATS = 10;"
sqlcmd -S $Server @auth -C -b -Q $sql
if ($LASTEXITCODE -ne 0) {
  Write-Error "BACKUP DATABASE failed (sqlcmd exit $LASTEXITCODE) — see the SQL error above. No backup was written to $file despite any file that may exist at that path (SQL Server pre-creates the device before failing)."
  exit $LASTEXITCODE
}
if (-not (Test-Path $file)) {
  Write-Error "sqlcmd reported success but $file does not exist — treating this as a failed backup rather than reporting success."
  exit 1
}

# Verify what was just written, the same way the restore rehearsal does. A
# backup that cannot pass this is not a backup; fail the run so a scheduled
# task shows red rather than a green run over a file that will not restore.
#
# W1-C (29 Sep 2026, failure analysis F-15/F-13): a green sqlcmd exit here
# used to be the whole story — nothing downstream (api/src/services/
# health.ts's backupHealth) could tell a verified file from one that merely
# exists, so a partially-corrupt backup that still passed Test-Path counted
# as "the newest backup" on Health with no way to know it had never been
# proven restorable. On success this now writes a ".verified.json" marker
# beside the file; on failure it renames the file itself so it can never be
# picked up as if it were good.
sqlcmd -S $Server @auth -C -b -Q "RESTORE VERIFYONLY FROM DISK = N'$file' WITH CHECKSUM;"
if ($LASTEXITCODE -ne 0) {
  $failedName = "$file.unverified"
  Write-Warning "RESTORE VERIFYONLY WITH CHECKSUM failed on $file (sqlcmd exit $LASTEXITCODE) — the file was written but did not verify. Renaming it to $failedName so nothing downstream can mistake it for a good backup."
  try {
    Move-Item -LiteralPath $file -Destination $failedName -Force
  } catch {
    Write-Warning "Could not rename $file to $failedName : $_"
  }
  Write-Error "RESTORE VERIFYONLY WITH CHECKSUM failed on $file (sqlcmd exit $LASTEXITCODE) — the file was written but did not verify. Not trusting it; investigate before relying on any backup from this host."
  exit $LASTEXITCODE
}

# The marker: what backupHealth (api/src/services/health.ts) reads to decide
# a .bak file is trustworthy, not just present. sizeBytes is the file's size
# AT THE MOMENT OF VERIFICATION — backupHealth re-reads the file's current
# size and only counts the backup as verified when the two still match, so a
# .bak silently truncated or replaced after this script ran is caught rather
# than trusted on the strength of a marker that no longer describes the file
# beside it.
$fileInfo = Get-Item -LiteralPath $file
$marker = [ordered]@{
  file        = (Split-Path -Leaf $file)
  sizeBytes   = $fileInfo.Length
  verifiedUtc = (Get-Date).ToUniversalTime().ToString("o")
  method      = "RESTORE VERIFYONLY WITH CHECKSUM"
}
# Write without a BOM: Windows PowerShell 5.1's `Set-Content -Encoding utf8`
# prepends a UTF-8 BOM (EF BB BF), which JSON.parse (api/src/services/
# health.ts::parseMarker) rejects outright — every marker this script wrote
# was silently unparseable and backup.verified stayed false forever.
$markerJson = $marker | ConvertTo-Json
$markerPath = "$file.verified.json"
[System.IO.File]::WriteAllText($markerPath, $markerJson, (New-Object System.Text.UTF8Encoding $false))

# retention: keep 30 days. The marker travels with its .bak — an orphaned
# .verified.json for a file retention already removed would otherwise sit in
# $OutDir forever, and worse, could in principle be misread against a LATER,
# unrelated .bak that happened to reuse the same name.
if (-not $NoPrune) {
  Get-ChildItem $OutDir -Filter "$Db-*.bak" |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
    ForEach-Object {
      $marker = "$($_.FullName).verified.json"
      if (Test-Path -LiteralPath $marker) { Remove-Item -LiteralPath $marker -Force }
      Remove-Item -LiteralPath $_.FullName -Force
    }
}

Write-Host "backup written and verified: $file"
