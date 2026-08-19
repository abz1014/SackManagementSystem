# backup-appdb.ps1 — nightly backup of the APP database (ARCHITECTURE §13).
# The app DB holds the only irreplaceable data (product timeline, reject labels,
# users, config, rules). IFL's DB is not ours to back up.
# Schedule via Task Scheduler, or use a SQL Agent job on non-Express editions.
#
#   powershell -File scripts\backup-appdb.ps1 -Server "localhost,14330" -Db sms -OutDir "D:\sms-backups"
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
  [string]$User   = "sms_app",
  [string]$Pass   = $env:APP_DB_PASSWORD,
  [string]$OutDir = "C:\sms-backups"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$file  = Join-Path $OutDir "$Db-$stamp.bak"

# No COMPRESSION: that option requires SQL Server Standard Edition or higher
# and errors out on Express (Msg 1844) — this project's own chosen engine
# (CLAUDE.md D1). A prior version of this script had COMPRESSION here; it had
# never actually been run against an Express instance, so nothing caught it —
# every "backup written" line it ever printed on Express would have been
# false, for the same reason the exit-code check below now exists.
$sql = "BACKUP DATABASE [$Db] TO DISK = N'$file' WITH INIT, STATS = 10;"
sqlcmd -S $Server -U $User -P $Pass -C -Q $sql
if ($LASTEXITCODE -ne 0) {
  Write-Error "BACKUP DATABASE failed (sqlcmd exit $LASTEXITCODE) — see the SQL error above. No backup was written to $file despite any file that may exist at that path (SQL Server pre-creates the device before failing)."
  exit $LASTEXITCODE
}
if (-not (Test-Path $file)) {
  Write-Error "sqlcmd reported success but $file does not exist — treating this as a failed backup rather than reporting success."
  exit 1
}

# retention: keep 30 days
Get-ChildItem $OutDir -Filter "$Db-*.bak" |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
  Remove-Item -Force

Write-Host "backup written: $file"
