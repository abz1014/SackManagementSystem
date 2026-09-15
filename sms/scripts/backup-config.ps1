# backup-config.ps1 — copy the installation's CONFIGURATION somewhere the
# database backup does not reach (roadmap Phase 11 item 6, 14 Sep 2026).
#
# The nightly .bak holds every row the app owns, and nothing else. Rebuilding
# the host from it alone means re-typing .env, re-issuing the TLS certificate,
# re-creating both NSSM services and re-registering three scheduled tasks
# from memory — the gap analysis: "nothing backs up .env, TLS material, NSSM
# definitions or scheduled tasks". This copies all four into
#
#   <BackupDir>\config\<yyyyMMdd-HHmmss>\
#       env                      the .env file (contains passwords — see ACL below)
#       tls\                     whatever TLS_* paths in .env point at (pfx / crt / key)
#       nssm-SMS-Api.txt         `nssm dump SMS-Api`  — the exact install commands
#       nssm-SMS-Sync.txt        `nssm dump SMS-Sync`
#       tasks-<name>.xml         `schtasks /query /xml` for each SMS task
#       manifest.txt             what was copied, and what was missing
#
# and then RESTRICTS THE FOLDER'S ACL to the current user and Administrators
# (icacls: inheritance removed, everyone else stripped), because .env holds
# the app-database and IFL passwords in clear and a backup folder is exactly
# where a casual reader would look. The database backups beside it stay as
# they were; only the config\<stamp> folder is locked down.
#
#   powershell -ExecutionPolicy Bypass -File scripts\backup-config.ps1 -InstallDir "C:\sms" -BackupDir "C:\sms-backups"
#
# Run as an administrator (nssm dump and schtasks /xml need it for the
# service definitions). Keeps the last 10 config snapshots. Never touches
# the database, IFL, or anything outside <BackupDir>\config.

param(
  [string]$InstallDir = "C:\sms",
  [string]$BackupDir  = "C:\sms-backups",
  [string[]]$Services = @("SMS-Api", "SMS-Sync"),
  [string[]]$Tasks    = @("SMS Nightly Backup", "SMS Weekly Maintenance", "SMS Daily Retention"),
  [int]$Keep          = 10
)

$ErrorActionPreference = "Stop"

$stamp  = Get-Date -Format "yyyyMMdd-HHmmss"
$root   = Join-Path $BackupDir "config"
$target = Join-Path $root $stamp
New-Item -ItemType Directory -Force -Path $target | Out-Null
$manifest = New-Object System.Collections.Generic.List[string]
function Note([string]$line) { $manifest.Add($line); Write-Host $line }

# 1. .env ----------------------------------------------------------------------
$envPath = Join-Path $InstallDir ".env"
if (Test-Path $envPath) {
  Copy-Item $envPath (Join-Path $target "env")
  Note "copied  .env"
} else {
  Note "MISSING .env at $envPath"
}

# 2. TLS material named in .env --------------------------------------------------
$tlsDir = Join-Path $target "tls"
if (Test-Path $envPath) {
  $tlsKeys = @("TLS_PFX_PATH", "TLS_CERT_PATH", "TLS_KEY_PATH")
  foreach ($line in Get-Content $envPath) {
    if ($line -match '^\s*(TLS_[A-Z_]+)\s*=\s*(.*?)\s*$') {
      $key = $Matches[1]; $val = $Matches[2]
      if ($tlsKeys -contains $key -and $val -ne "") {
        if (Test-Path $val) {
          New-Item -ItemType Directory -Force -Path $tlsDir | Out-Null
          Copy-Item $val (Join-Path $tlsDir (Split-Path $val -Leaf))
          Note "copied  $key -> $(Split-Path $val -Leaf)"
        } else {
          Note "MISSING $key names $val, which does not exist"
        }
      }
    }
  }
}

# 3. NSSM service definitions ------------------------------------------------------
$nssm = Get-Command nssm -ErrorAction SilentlyContinue
foreach ($svc in $Services) {
  $out = Join-Path $target "nssm-$svc.txt"
  if ($null -eq $nssm) {
    Note "SKIPPED nssm dump $svc — nssm not on PATH"
    continue
  }
  $dump = & $nssm.Source dump $svc 2>&1
  if ($LASTEXITCODE -eq 0) {
    $dump | Out-File -FilePath $out -Encoding utf8
    Note "copied  nssm dump $svc"
  } else {
    Note "MISSING service $svc (nssm dump exit $LASTEXITCODE)"
  }
}

# 4. Scheduled tasks ---------------------------------------------------------------
foreach ($task in $Tasks) {
  $safe = ($task -replace '[^A-Za-z0-9]+', '-').Trim('-')
  $out = Join-Path $target "tasks-$safe.xml"
  $xml = & schtasks /query /tn "$task" /xml 2>&1
  if ($LASTEXITCODE -eq 0) {
    $xml | Out-File -FilePath $out -Encoding utf8
    Note "copied  task '$task'"
  } else {
    Note "MISSING task '$task' (not registered — scripts\install-scheduled-tasks.ps1)"
  }
}

# 5. Manifest, then lock the folder down -------------------------------------------
$manifest.Insert(0, "SMS configuration backup $stamp from $InstallDir")
$manifest | Out-File -FilePath (Join-Path $target "manifest.txt") -Encoding utf8

# Remove inherited ACEs, grant the current user and Administrators full
# control, and nothing else. The .env inside holds passwords in clear.
$me = "$env:USERDOMAIN\$env:USERNAME"
& icacls $target /inheritance:r /grant:r "${me}:(OI)(CI)F" "BUILTIN\Administrators:(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Error "icacls failed (exit $LASTEXITCODE): the folder $target was written but NOT restricted. Fix its permissions before leaving it."
  exit $LASTEXITCODE
}
Note "ACL     restricted to $me and BUILTIN\Administrators"

# 6. Keep the newest $Keep snapshots ------------------------------------------------
Get-ChildItem $root -Directory |
  Sort-Object Name -Descending |
  Select-Object -Skip $Keep |
  ForEach-Object { Remove-Item $_.FullName -Recurse -Force; Write-Host "removed old snapshot $($_.Name)" }

Write-Host "configuration backup written: $target"
