# backup-appdb.ps1 — nightly backup of the APP database (ARCHITECTURE §13).
# The app DB holds the only irreplaceable data (product timeline, reject labels,
# users, config, rules). IFL's DB is not ours to back up.
# Schedule via Task Scheduler, or use a SQL Agent job on non-Express editions.
#
#   powershell -File scripts\backup-appdb.ps1 -Server "localhost,14330" -Db sms -OutDir "D:\sms-backups"

param(
  [string]$Server = "localhost,14330",
  [string]$Db     = "sms",
  [string]$User   = "sms_app",
  [string]$Pass   = $env:APP_DB_PASSWORD,
  [string]$OutDir = "C:\sms-backups"
)

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$file  = Join-Path $OutDir "$Db-$stamp.bak"

$sql = "BACKUP DATABASE [$Db] TO DISK = N'$file' WITH INIT, COMPRESSION, STATS = 10;"
sqlcmd -S $Server -U $User -P $Pass -C -Q $sql

# retention: keep 30 days
Get-ChildItem $OutDir -Filter "$Db-*.bak" |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
  Remove-Item -Force

Write-Host "backup written: $file"
