# install-scheduled-tasks.ps1 — register the three recurring jobs the SMS
# installation needs as Windows Scheduled Tasks (roadmap Phase 11 item 6,
# 14 Sep 2026). Before this, DEPLOY.md said "schedule the backup script via
# Task Scheduler" and left the how to the operator — and the obvious how put
# the sms_backup password in the task's argument string, which is readable
# in the task XML by anyone who can list tasks.
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-scheduled-tasks.ps1 `
#       -InstallDir "C:\sms" -RunAs "PLANT\svc-sms-backup" -Server "<host>,<port>" -WhatIf
#
# Run as an administrator. -WhatIf prints exactly what would be registered
# and registers nothing; drop it to register. Re-running replaces the tasks.
#
# THE THREE TASKS
#   SMS Nightly Backup   02:00 daily   scripts\backup-appdb.ps1
#   SMS Weekly Maintenance 03:00 Sun   sqlcmd -i scripts\db-maintenance.sql
#   SMS Daily Retention  04:00 daily   node cli\dist\index.js retention
#
# NO PASSWORD IN ANY TASK. The backup and maintenance tasks run AS a Windows
# account (-RunAs) that SQL Server trusts through Windows authentication:
# the backup script is called with -User "" so sqlcmd uses -E (trusted
# connection), and the maintenance task uses -E directly. That account needs
# db_backupoperator on [sms] for the backup and db_owner for CHECKDB / ALTER
# INDEX — grant it once, in SSMS, as sysadmin:
#
#   CREATE LOGIN [PLANT\svc-sms-backup] FROM WINDOWS;
#   USE sms; CREATE USER [PLANT\svc-sms-backup] FOR LOGIN [PLANT\svc-sms-backup];
#   ALTER ROLE db_backupoperator ADD MEMBER [PLANT\svc-sms-backup];
#   ALTER ROLE db_owner          ADD MEMBER [PLANT\svc-sms-backup];   -- maintenance only
#
# The retention task reads .env for its own login (sms_app) exactly as the
# CLI always has; it needs no SQL rights beyond the app's and runs as the
# same account, which must be able to read .env.
#
# -BackupDir must be writable by the SQL Server SERVICE account (BACKUP
# DATABASE runs on the server, not the client) — see backup-appdb.ps1's
# header. Match BACKUP_DIR in .env so the Health screen looks in the same
# place.

[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$InstallDir = "C:\sms",
  [Parameter(Mandatory = $true)][string]$RunAs,
  [Parameter(Mandatory = $true)][string]$Server,   # required, no default: "<host>,<port>" of the APP database (sms)
  [string]$Database   = "sms",
  [string]$BackupDir  = "C:\sms-backups",
  [string]$NodeExe    = "C:\Program Files\nodejs\node.exe",
  [string]$BackupTime = "02:00",
  [string]$MaintenanceTime = "03:00",
  [string]$RetentionTime   = "04:00"
)

$ErrorActionPreference = "Stop"

foreach ($p in @("$InstallDir\scripts\backup-appdb.ps1", "$InstallDir\scripts\db-maintenance.sql", "$InstallDir\cli\dist\index.js")) {
  if (-not (Test-Path $p)) { Write-Error "not found: $p — is -InstallDir right, and has 'npm run build' been run?"; exit 1 }
}
if (-not (Test-Path $NodeExe)) { Write-Error "node.exe not found at $NodeExe (-NodeExe)"; exit 1 }

$logDir = Join-Path $InstallDir "logs"
$ps = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"

# Each task: name, what runs, when. Arguments are plain paths and flags — no
# credential anywhere. The backup script's -User "" means "trusted
# connection"; -Pass is omitted on purpose and the script accepts that only
# when -User is empty.
$tasks = @(
  @{
    Name    = "SMS Nightly Backup"
    Exe     = $ps
    # -Command, not -File: with -File everything after the script path is a
    # parameter TO the script, so a `*>>` redirection would arrive as a stray
    # positional argument and the backup script would refuse it. (Found by the
    # -WhatIf rehearsal on 14 Sep 2026.) Single quotes inside the double-quoted
    # task argument keep paths with spaces intact.
    Args    = "-NoProfile -ExecutionPolicy Bypass -Command `"& '$InstallDir\scripts\backup-appdb.ps1' -Server '$Server' -Db '$Database' -User '' -OutDir '$BackupDir' *>> '$logDir\backup.log'; exit `$LASTEXITCODE`""
    Trigger = New-ScheduledTaskTrigger -Daily -At $BackupTime
  },
  @{
    Name    = "SMS Weekly Maintenance"
    Exe     = "sqlcmd.exe"
    Args    = "-S `"$Server`" -E -d `"$Database`" -b -i `"$InstallDir\scripts\db-maintenance.sql`" -o `"$logDir\maintenance.log`""
    Trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At $MaintenanceTime
  },
  @{
    Name    = "SMS Daily Retention"
    Exe     = $NodeExe
    Args    = "`"$InstallDir\cli\dist\index.js`" retention"
    Trigger = New-ScheduledTaskTrigger -Daily -At $RetentionTime
  }
)

# The two tasks that append to a log need the folder to exist; the services'
# NSSM block creates the same folder, but a host where the tasks are
# registered first must not lose its first night's log to a missing directory.
if (-not (Test-Path $logDir) -and $PSCmdlet.ShouldProcess($logDir, "Create log directory")) {
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
}

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew
# Password prompt for the run-as account happens ONCE, here, interactively, and
# is stored by the Task Scheduler service — never in the task definition.
$principal = New-ScheduledTaskPrincipal -UserId $RunAs -LogonType Password -RunLevel Limited

foreach ($t in $tasks) {
  Write-Host ""
  Write-Host ("== {0}" -f $t.Name)
  Write-Host ("   run as : {0}" -f $RunAs)
  Write-Host ("   command: {0} {1}" -f $t.Exe, $t.Args)
  Write-Host ("   working: {0}" -f $InstallDir)
  Write-Host ("   trigger: {0}" -f (($t.Trigger | Format-List | Out-String).Trim() -replace "\s+", " "))
  if ($PSCmdlet.ShouldProcess($t.Name, "Register scheduled task")) {
    $action = New-ScheduledTaskAction -Execute $t.Exe -Argument $t.Args -WorkingDirectory $InstallDir
    Register-ScheduledTask -TaskName $t.Name -Action $action -Trigger $t.Trigger -Settings $settings -Principal $principal -Force | Out-Null
    Write-Host "   registered."
  }
}

Write-Host ""
Write-Host "Verify with:  schtasks /query /tn `"SMS Nightly Backup`" /v /fo LIST"
Write-Host "Run one now:  schtasks /run /tn `"SMS Nightly Backup`""
Write-Host "The Health screen (?s=health) shows the newest backup's age from $BackupDir."
