# uninstall.ps1 - stop and remove the SMS Windows services and firewall rule.
#
#   powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
#
# It does NOT delete the SMS database [sms], its logins, this folder or .env:
# the database holds users, settings and history that cannot be rebuilt.
# To remove the database as well, back it up first, then in SSMS (sysadmin):
#   DROP DATABASE [sms]; DROP LOGIN [sms_app]; DROP LOGIN [sms_migrate];
# IFL's own databases are never touched by install or uninstall.

$ErrorActionPreference = 'Continue'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Nssm = Join-Path $Here 'prereqs\nssm.exe'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Write-Host "Run this in an administrator PowerShell window." -ForegroundColor Red; exit 1 }

foreach ($name in 'SMS-Sync', 'SMS-Api') {
    if (Get-Service $name -ErrorAction SilentlyContinue) {
        & $Nssm stop $name 2>&1 | Out-Null
        & $Nssm remove $name confirm 2>&1 | Out-Null
        Write-Host "Removed service $name"
    } else { Write-Host "Service $name not installed" }
}
netsh advfirewall firewall show rule name="SMS API" | Out-Null
if ($LASTEXITCODE -eq 0) {
    netsh advfirewall firewall delete rule name="SMS API" | Out-Null
    Write-Host "Removed firewall rule 'SMS API'"
}
Write-Host "Done. The [sms] database and this folder were left in place."
