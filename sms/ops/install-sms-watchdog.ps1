# Registers the SMS watchdog as a Scheduled Task that starts at logon and
# restarts itself if it ever exits. Run once, from an ordinary (non-elevated)
# PowerShell — it registers under the current user.
#
#   powershell -ExecutionPolicy Bypass -File .\ops\install-sms-watchdog.ps1
#
# To remove:  Unregister-ScheduledTask -TaskName 'SMS Tunnel Watchdog' -Confirm:$false

$taskName = 'SMS Tunnel Watchdog'
$script   = Join-Path $PSScriptRoot 'sms-watchdog.ps1'

if (-not (Test-Path $script)) { throw "watchdog script not found: $script" }

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# RestartInterval/Count covers the watchdog itself dying; the 30s loop inside
# covers the API and tunnel dying. ExecutionTimeLimit 0 = never time out, since
# this is a permanent loop rather than a job that finishes.
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -RestartInterval (New-TimeSpan -Minutes 1) -RestartCount 999 `
    -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
    -MultipleInstances IgnoreNew

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
    -Settings $settings -Description 'Keeps the SMS API (:4000) and its ngrok tunnel alive.' | Out-Null

Start-ScheduledTask -TaskName $taskName

Write-Host "Registered and started '$taskName'."
Write-Host "Log: $env:LOCALAPPDATA\sms-watchdog\watchdog.log"
Write-Host ""
Write-Host "NOTE: free-tier ngrok has one reserved domain. The SMS watchdog stands"
Write-Host "down while 'EMS Tunnel Watchdog' is enabled. Only one may own the URL."
