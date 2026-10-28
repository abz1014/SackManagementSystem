# install.ps1 - guided install of the IFL Sack Management System (SMS) on a plant PC.
#
# Run from the unzipped bundle folder, in an ADMINISTRATOR PowerShell window:
#
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
#
# Re-runnable. Each step checks what is already there and asks before it
# changes anything outside this folder. Nothing here ever writes to IFL's
# databases (DATA_TP1U2, PDAS_TP1U2): the plant connection is tested with
# read-only SELECTs, and SMS keeps its own data in its own database [sms].
#
# Later, once IFL has given the read-only login, connect the plant only:
#
#   powershell -ExecutionPolicy Bypass -File .\install.ps1 -PlantOnly
#
# Every run writes a transcript to logs\install-<time>.log. No password is
# ever printed or written to the transcript.

[CmdletBinding()]
param(
    [int]$ApiPort = 4000,
    [string]$SqlInstance = '',        # e.g. SQLEXPRESS; empty = detect
    [switch]$PlantOnly                # only (re)connect the plant source
)

$ErrorActionPreference = 'Stop'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$EnvFile = Join-Path $Here '.env'
$Nssm = Join-Path $Here 'prereqs\nssm.exe'
$Cli = Join-Path $Here 'cli\dist\index.js'

New-Item -ItemType Directory -Force (Join-Path $Here 'logs') | Out-Null
Start-Transcript -Path (Join-Path $Here ("logs\install-{0:yyyyMMdd-HHmmss}.log" -f (Get-Date))) | Out-Null

function Step($t)  { Write-Host ""; Write-Host "== $t" -ForegroundColor Cyan }
function Ok($t)    { Write-Host "   OK  $t" -ForegroundColor Green }
function Warn($t)  { Write-Host "   !!  $t" -ForegroundColor Yellow }
function Fail($t)  { Write-Host "   XX  $t" -ForegroundColor Red; Stop-Transcript | Out-Null; exit 1 }
function Ask($q, $default = 'n') {
    $hint = if ($default -eq 'y') { '[Y/n]' } else { '[y/N]' }
    $a = Read-Host "   ?   $q $hint"
    if ([string]::IsNullOrWhiteSpace($a)) { $a = $default }
    return $a.Trim().ToLower().StartsWith('y')
}
function AskText($q, $default) {
    $a = Read-Host "   ?   $q [$default]"
    if ([string]::IsNullOrWhiteSpace($a)) { return $default } else { return $a.Trim() }
}
function AskSecret($q) {
    $s = Read-Host "   ?   $q" -AsSecureString
    $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}
function NewPassword {
    # Letters, digits and a few symbols that are safe in SQL N'..', in .env and on a command line.
    $sets = 'ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@*-_+.'
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    $bytes = New-Object byte[] 64; $rng.GetBytes($bytes)
    $all = -join $sets; $chars = @()
    for ($i = 0; $i -lt 4; $i++) { $chars += $sets[$i][$bytes[$i] % $sets[$i].Length] }
    for ($i = 4; $i -lt 24; $i++) { $chars += $all[$bytes[$i] % $all.Length] }
    return -join ($chars | Sort-Object { Get-Random })
}

# ---- .env helpers: keep comments, replace or append KEY=value -------------
function Read-EnvValue($key) {
    if (-not (Test-Path $EnvFile)) { return $null }
    foreach ($line in Get-Content -LiteralPath $EnvFile) {
        if ($line -match "^\s*$key\s*=\s*(.*?)\s*$") { return $Matches[1] }
    }
    return $null
}
function Set-EnvValues([hashtable]$values) {
    $lines = [System.Collections.Generic.List[string]]::new()
    if (Test-Path $EnvFile) { (Get-Content -LiteralPath $EnvFile) | ForEach-Object { $lines.Add($_) } }
    foreach ($k in $values.Keys) {
        $done = $false
        for ($i = 0; $i -lt $lines.Count; $i++) {
            if ($lines[$i] -match "^\s*#?\s*$k\s*=") { $lines[$i] = "$k=$($values[$k])"; $done = $true; break }
        }
        if (-not $done) { $lines.Add("$k=$($values[$k])") }
    }
    # No BOM: the app's .env reader does not expect one.
    [IO.File]::WriteAllLines($EnvFile, $lines, (New-Object Text.UTF8Encoding $false))
}
function Remove-EnvKey($key) {
    if (-not (Test-Path $EnvFile)) { return }
    $kept = Get-Content -LiteralPath $EnvFile | Where-Object { $_ -notmatch "^\s*$key\s*=" }
    [IO.File]::WriteAllLines($EnvFile, [string[]]$kept, (New-Object Text.UTF8Encoding $false))
}

# ---- SQL helpers (System.Data.SqlClient ships with Windows: no sqlcmd needed)
function Invoke-Sql($connStr, $sql) {
    $c = New-Object System.Data.SqlClient.SqlConnection $connStr
    $c.Open()
    try {
        $cmd = $c.CreateCommand(); $cmd.CommandTimeout = 120; $cmd.CommandText = $sql
        $t = New-Object System.Data.DataTable
        $r = $cmd.ExecuteReader(); $t.Load($r); $r.Close()
        return ,$t
    } finally { $c.Close() }
}
function Invoke-SqlBatches($connStr, $script) {
    $c = New-Object System.Data.SqlClient.SqlConnection $connStr
    $c.add_InfoMessage({ param($s, $e) Write-Host "       $($e.Message)" })
    $c.Open()
    try {
        foreach ($batch in ($script -split '(?im)^\s*GO\s*$')) {
            if ($batch.Trim().Length -eq 0) { continue }
            $cmd = $c.CreateCommand(); $cmd.CommandTimeout = 300; $cmd.CommandText = $batch
            [void]$cmd.ExecuteNonQuery()
        }
    } finally { $c.Close() }
}

function Get-NodeExe {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$machine;$user"
    $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source } else { return $null }
}
function Format-NativeLine($line) {
    # A native program's stderr line arrives as an ErrorRecord; show its text only.
    if ($line -is [System.Management.Automation.ErrorRecord]) { return $line.Exception.Message }
    return "$line"
}
function Invoke-Node([string[]]$nodeArgs) {
    # Out-Host: node's own output must not become this function's return value.
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { & $script:NodeExe @nodeArgs 2>&1 | ForEach-Object { Format-NativeLine $_ } | Out-Host; return $LASTEXITCODE }
    finally { $ErrorActionPreference = $old }
}
function Invoke-Nssm([string[]]$nssmArgs) {
    # PS 5.1 turns native stderr into terminating errors under 'Stop'; NSSM writes to stderr freely.
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $out = (& $Nssm @nssmArgs 2>&1 | ForEach-Object { Format-NativeLine $_ }) -join "`n"; return $out.Replace("`0", '').Trim() }
    finally { $ErrorActionPreference = $old }
}

# ===========================================================================
Write-Host "IFL Sack Management System - installer" -ForegroundColor White
Write-Host "Folder: $Here"

Step "Checking this window runs as administrator"
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Fail "Open PowerShell with 'Run as administrator' and run this again." }
Ok "Administrator"

foreach ($f in 'api\dist\index.js', 'sync-worker\dist\index.js', 'cli\dist\index.js', 'web\dist\index.html', 'node_modules', 'db\bootstrap\00_create_app_database.sql') {
    if (-not (Test-Path (Join-Path $Here $f))) { Fail "The bundle is incomplete: $f is missing. Unzip the whole package again." }
}

# ---- Node.js --------------------------------------------------------------
Step "Node.js 22"
$script:NodeExe = Get-NodeExe
$major = 0
if ($script:NodeExe) { $major = [int]((& $script:NodeExe -v).TrimStart('v').Split('.')[0]) }
if ($major -ge 22) {
    Ok "Node $(& $script:NodeExe -v) at $script:NodeExe"
} else {
    if ($script:NodeExe) { Warn "Node $(& $script:NodeExe -v) is too old; SMS needs 22 or newer." }
    $msi = Get-ChildItem (Join-Path $Here 'prereqs') -Filter 'node-v22*-x64.msi' | Select-Object -First 1
    if (-not $msi) { Fail "prereqs\node-v22...-x64.msi is missing from the bundle." }
    Write-Host "   Installing $($msi.Name) (about a minute)..."
    $p = Start-Process msiexec.exe -ArgumentList '/i', "`"$($msi.FullName)`"", '/qn', '/norestart' -Wait -PassThru
    if ($p.ExitCode -notin 0, 3010) { Fail "Node installer exit code $($p.ExitCode)." }
    $script:NodeExe = Get-NodeExe
    if (-not $script:NodeExe) { $script:NodeExe = 'C:\Program Files\nodejs\node.exe' }
    if (-not (Test-Path $script:NodeExe)) { Fail "Node installed but node.exe was not found." }
    Ok "Installed Node $(& $script:NodeExe -v)"
}

# ---- Package links ---------------------------------------------------------
Step "Linking the app's own packages"
$sms = Join-Path $Here 'node_modules\@sms'
New-Item -ItemType Directory -Force $sms | Out-Null
foreach ($p in 'shared', 'sync-worker', 'cli', 'api') {
    $link = Join-Path $sms $p
    if (Test-Path $link) {
        $item = Get-Item -LiteralPath $link -Force
        if ($item.LinkType -eq 'Junction') { cmd /c rmdir "`"$link`"" | Out-Null }
        else { Fail "$link exists and is not a link; unzip the package again into an empty folder." }
    }
    cmd /c mklink /J "`"$link`"" "`"$(Join-Path $Here $p)`"" | Out-Null
}
Ok "Linked shared, sync-worker, cli, api"

# ---- Clock -----------------------------------------------------------------
$offset = [TimeZoneInfo]::Local.GetUtcOffset((Get-Date)).TotalMinutes
if ($offset -ne 300) { Warn "This PC's time zone is UTC$('{0:+0;-0}' -f ($offset/60)) but the plant is UTC+5. Shift times will be wrong until Windows is set to (UTC+05:00) Islamabad, Karachi." }

if (-not $PlantOnly) {
# ---- SQL Server --------------------------------------------------------------
Step "Finding SQL Server on this PC"
$instKey = 'HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL'
if (-not (Test-Path $instKey)) { Fail "No SQL Server is installed on this PC. Install SQL Server Express first, then run this again." }
$instances = (Get-ItemProperty $instKey).PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' }
if ($SqlInstance) { $inst = $instances | Where-Object Name -eq $SqlInstance }
elseif (@($instances).Count -eq 1) { $inst = $instances | Select-Object -First 1 }
else {
    Write-Host "   Instances: $(($instances | ForEach-Object Name) -join ', ')"
    $pick = AskText "Which instance should hold the SMS database?" (($instances | Where-Object Name -eq 'SQLEXPRESS' | Select-Object -First 1).Name)
    $inst = $instances | Where-Object Name -eq $pick
}
if (-not $inst) { Fail "SQL Server instance '$SqlInstance' not found." }
$instName = $inst.Name; $instId = $inst.Value
$svcName = if ($instName -eq 'MSSQLSERVER') { 'MSSQLSERVER' } else { "MSSQL`$$instName" }
$dataSource = if ($instName -eq 'MSSQLSERVER') { '.' } else { ".\$instName" }
$svc = Get-Service -Name $svcName -ErrorAction SilentlyContinue
if (-not $svc) { Fail "Service $svcName not found." }
if ($svc.Status -ne 'Running') { Fail "SQL Server service $svcName is $($svc.Status). Start it, then run this again." }
Ok "Instance $instName (service $svcName)"

$trusted = "Data Source=$dataSource;Initial Catalog=master;Integrated Security=SSPI;TrustServerCertificate=True;Connect Timeout=15"
try {
    $isSa = (Invoke-Sql $trusted "SELECT IS_SRVROLEMEMBER('sysadmin') AS s").Rows[0].s
} catch { Fail "Could not connect to $dataSource with this Windows account: $($_.Exception.Message)" }
if ($isSa -ne 1) { Fail "This Windows account is not a sysadmin on $instName. Run as the account that installed SQL Server, or ask IT to add it." }
Ok "Connected as a sysadmin"

$iflHere = (Invoke-Sql $trusted "SELECT CASE WHEN DB_ID('DATA_TP1U2') IS NULL THEN 0 ELSE 1 END AS d, CASE WHEN DB_ID('PDAS_TP1U2') IS NULL THEN 0 ELSE 1 END AS p").Rows[0]
$iflOnThisInstance = ($iflHere.d -eq 1 -or $iflHere.p -eq 1)
if ($iflOnThisInstance) { Warn "IFL's own plant database is on this same instance. SMS will only create its own database [sms] beside it and never change IFL's." }

# Network settings SMS needs: TCP on, SQL logins allowed, a fixed port.
$base = "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\$instId\MSSQLServer"
$tcpKey = "$base\SuperSocketNetLib\Tcp"
$ipAll = "$tcpKey\IPAll"
$loginMode = (Get-ItemProperty $base -ErrorAction SilentlyContinue).LoginMode
$tcpOn = (Get-ItemProperty $tcpKey -ErrorAction SilentlyContinue).Enabled
$staticPort = ((Get-ItemProperty $ipAll -ErrorAction SilentlyContinue).TcpPort | Out-String).Trim()
$dynPort = ((Get-ItemProperty $ipAll -ErrorAction SilentlyContinue).TcpDynamicPorts | Out-String).Trim()

$changes = @()
if ($loginMode -ne 2) { $changes += 'allow SQL Server logins (mixed authentication)' }
if ($tcpOn -ne 1) { $changes += 'turn on TCP/IP' }
if (-not $staticPort) { $changes += 'give the instance a fixed TCP port' }

if ($changes.Count -gt 0) {
    Warn "SQL Server needs these settings changed for SMS to connect:"
    $changes | ForEach-Object { Write-Host "         - $_" }
    Warn "This needs ONE restart of the SQL Server service ($svcName), which stops every database on it for about 30 seconds."
    if ($iflOnThisInstance) { Warn "IFL's plant database is on this instance: readings written during the restart may be lost. Do this only with IFL's OK, ideally between shifts." }
    if (-not (Ask "Change these settings and restart $svcName now?")) {
        Fail "Stopped before changing SQL Server. Nothing was changed. Run again when a restart is allowed."
    }
    if ($loginMode -ne 2) { Set-ItemProperty $base -Name LoginMode -Value 2 -Type DWord }
    if ($tcpOn -ne 1) { Set-ItemProperty $tcpKey -Name Enabled -Value 1 -Type DWord }
    if (-not $staticPort) {
        $want = if ($dynPort) { $dynPort } else { '1433' }
        $busy = Get-NetTCPConnection -LocalPort ([int]$want) -State Listen -ErrorAction SilentlyContinue
        if ($busy -and -not $dynPort) { $want = '14333' }
        $want = AskText "Fixed TCP port for $instName" $want
        Set-ItemProperty $ipAll -Name TcpPort -Value $want
        Set-ItemProperty $ipAll -Name TcpDynamicPorts -Value ''
        $staticPort = $want
    }
    Write-Host "   Restarting $svcName..."
    Restart-Service -Name $svcName -Force
    (Get-Service $svcName).WaitForStatus('Running', [TimeSpan]::FromSeconds(90))
    Start-Sleep -Seconds 5
    Ok "SQL Server restarted"
}
$sqlPort = [int]$staticPort
Ok "SQL Server listens on TCP $sqlPort with SQL logins allowed"

# ---- SMS database and its two logins ---------------------------------------
Step "Creating the SMS database [sms] and its logins"
$existing = Invoke-Sql $trusted "SELECT name FROM sys.server_principals WHERE name IN ('sms_app','sms_migrate')"
$appExists = @($existing.Rows | Where-Object { $_.name -eq 'sms_app' }).Count -gt 0
$migExists = @($existing.Rows | Where-Object { $_.name -eq 'sms_migrate' }).Count -gt 0

$appPassword = Read-EnvValue 'APP_DB_PASSWORD'
if (-not $appPassword -or $appPassword -eq '__set_me__') { $appPassword = $null }
$resetApp = $false
if (-not $appPassword) {
    $appPassword = NewPassword
    if ($appExists) {
        Warn "Login sms_app already exists and its password is not in this folder's .env."
        if (-not (Ask "Give sms_app a new password? (Only SMS uses this login.)" 'y')) { Fail "Cannot continue without the sms_app password." }
        $resetApp = $true
    }
}
$migPassword = NewPassword

$boot = Get-Content -Raw -LiteralPath (Join-Path $Here 'db\bootstrap\00_create_app_database.sql')
$boot = $boot.Replace('$(AppPassword)', $appPassword).Replace('$(MigratePassword)', $migPassword)
Invoke-SqlBatches $trusted $boot
# The bootstrap leaves an existing login's password alone; set ours explicitly.
if ($resetApp) { Invoke-SqlBatches $trusted "ALTER LOGIN [sms_app] WITH PASSWORD = N'$appPassword';" }
if ($migExists) { Invoke-SqlBatches $trusted "ALTER LOGIN [sms_migrate] WITH PASSWORD = N'$migPassword';" }
Invoke-SqlBatches $trusted "ALTER LOGIN [sms_migrate] ENABLE; ALTER LOGIN [sms_app] ENABLE;"
Ok "Database [sms], logins sms_app and sms_migrate ready"

# ---- .env ------------------------------------------------------------------
Step "Writing settings (.env)"
if (-not (Test-Path $EnvFile)) {
    Copy-Item (Join-Path $Here '.env.example') $EnvFile
    $placeholders = @{
        IFL_DB_SERVER = '__set_me__'; IFL_DB_PORT = '1433'; IFL_DB_USER = '__set_me__'; IFL_DB_PASSWORD = '__set_me__'
    }
    Set-EnvValues $placeholders
} else {
    Copy-Item $EnvFile ("$EnvFile.bak-{0:yyyyMMdd-HHmmss}" -f (Get-Date))
}
Set-EnvValues @{
    APP_DB_SERVER = 'localhost'; APP_DB_PORT = "$sqlPort"; APP_DB_NAME = 'sms'
    APP_DB_USER = 'sms_app'; APP_DB_PASSWORD = $appPassword
    APP_DB_ENCRYPT = 'true'; APP_DB_TRUST_SERVER_CERTIFICATE = 'true'
    API_PORT = "$ApiPort"; COOKIE_SECURE = 'false'; TRUST_PROXY = 'false'
    PLANT_UTC_OFFSET_MINUTES = '300'; LIVE_ALLOW_AS_OF = 'false'; PDAS_WRITE_ENABLED = 'false'
    WEB_DIST = './web/dist'; WEB_NEXT_DIST = './web-next/dist'; BACKUP_DIR = 'C:\sms-backups'
}
Remove-EnvKey 'LIVE_ALLOW_SIMULATOR'
Remove-EnvKey 'MIGRATE_DB_USER'
Remove-EnvKey 'MIGRATE_DB_PASSWORD'
# Only administrators and the services (SYSTEM) may read the passwords in .env.
icacls $EnvFile /inheritance:r /grant:r '*S-1-5-32-544:F' '*S-1-5-18:F' | Out-Null
Ok ".env written and locked to Administrators and SYSTEM"

# ---- Migrations --------------------------------------------------------------
Step "Creating the SMS tables (migrations)"
$env:MIGRATE_DB_USER = 'sms_migrate'; $env:MIGRATE_DB_PASSWORD = $migPassword
Push-Location $Here
try { $code = Invoke-Node @((Join-Path $Here 'scripts\migrate.mjs')) }
finally { Pop-Location; Remove-Item Env:MIGRATE_DB_USER, Env:MIGRATE_DB_PASSWORD -ErrorAction SilentlyContinue }
if ($code -ne 0) { Fail "Migrations failed (exit $code). See the messages above." }
Invoke-SqlBatches $trusted "ALTER LOGIN [sms_migrate] DISABLE;"
Ok "Tables ready; sms_migrate disabled again until the next upgrade"

# ---- First admin account ---------------------------------------------------
Step "Admin account"
$users = (Invoke-Sql $trusted "SELECT COUNT(*) AS n FROM sms.sms.app_user").Rows[0].n
if ($users -gt 0) {
    Ok "$users account(s) already exist; skipping"
} elseif (Ask "Create the first admin account now?" 'y') {
    $u = AskText "Admin username" 'admin'
    do {
        $pw = AskSecret "Admin password (10+ characters, no spaces or quotes)"
        $pw2 = AskSecret "Type it again"
        if ($pw -ne $pw2) { Warn "They did not match." }
    } while ($pw -ne $pw2)
    Push-Location $Here
    try { $code = Invoke-Node @($Cli, 'user:create', "--username=$u", "--password=$pw", '--role=admin') }
    finally { Pop-Location; $pw = $null; $pw2 = $null }
    if ($code -ne 0) { Warn "Account not created (exit $code). Create it later: node cli\dist\index.js user:create --username=admin --password=... --role=admin" }
    else { Ok "Admin '$u' created" }
}
} # end if -not PlantOnly

# ---- Plant source (IFL, read-only) -----------------------------------------
Step "Connecting to IFL's plant database (read-only)"
$plantOk = $false
$curServer = Read-EnvValue 'IFL_DB_SERVER'
if ($PlantOnly -or (Ask "Do you have IFL's read-only SQL login now?" 'n')) {
    $iflServer = AskText "Plant SQL Server host (name or IP, no instance)" $(if ($curServer -and $curServer -ne '__set_me__') { $curServer } else { 'localhost' })
    $iflPort = AskText "Plant SQL Server TCP port" $(if (Read-EnvValue 'IFL_DB_PORT') { Read-EnvValue 'IFL_DB_PORT' } else { '1433' })
    $iflData = AskText "Acquisition database" 'DATA_TP1U2'
    $iflPdas = AskText "Product (PDAS) database" 'PDAS_TP1U2'
    $iflUser = AskText "Read-only login" 'sms_readonly'
    $iflPass = AskSecret "Password for $iflUser"
    $iflConn = "Data Source=$iflServer,$iflPort;Initial Catalog=master;User ID=$iflUser;Password=$iflPass;Encrypt=True;TrustServerCertificate=True;Connect Timeout=15;ApplicationIntent=ReadOnly"
    try {
        # The same four read-only checks DEPLOY.md asks for before go-live.
        [void](Invoke-Sql $iflConn "SELECT TOP 1 id FROM [$iflData].dbo.pack1_TP1U2")
        [void](Invoke-Sql $iflConn "SELECT TOP 1 id FROM [$iflData].dbo.sack1_TP1U2")
        [void](Invoke-Sql $iflConn "SELECT TOP 1 MaterialId FROM [$iflPdas].dbo.Materials")
        [void](Invoke-Sql $iflConn "SELECT create_date FROM [$iflData].sys.tables WHERE name = 'pack1_TP1U2'")
        $plantOk = $true
        Ok "The login can read cones, sacks and products"
    } catch {
        Warn "Plant check failed: $($_.Exception.Message)"
        Warn "SMS needs db_datareader on BOTH $iflData and $iflPdas (see db\bootstrap\10_ifl_readonly_login.template.sql)."
    }
    Set-EnvValues @{
        IFL_DB_SERVER = $iflServer; IFL_DB_PORT = $iflPort; IFL_DB_NAME_DATA = $iflData; IFL_DB_NAME_PDAS = $iflPdas
        IFL_DB_USER = $iflUser; IFL_DB_PASSWORD = $iflPass; IFL_DB_ENCRYPT = 'true'; IFL_DB_TRUST_SERVER_CERTIFICATE = 'true'
    }
    $iflPass = $null; $iflConn = $null
    Ok "Plant settings saved in .env"
} else {
    Warn "Skipped. SMS will open but show no plant data until you run: .\install.ps1 -PlantOnly"
}

if ($plantOk) {
    Step "Registering the plant's live data generation"
    Write-Host "   SMS reads the plant only after you confirm which tables it is reading. The plan:"
    Push-Location $Here
    try {
        $code = Invoke-Node @($Cli, 'epoch:list')
        $code = Invoke-Node @($Cli, 'epoch:accept', '--all', '--provenance=ifl_live', '--label=Plant, live')
        if (Ask "Accept this plan and start reading the plant?" 'y') {
            $code = Invoke-Node @($Cli, 'epoch:accept', '--all', '--provenance=ifl_live', '--label=Plant, live', '--confirm')
            if ($code -ne 0) { Warn "epoch:accept exit $code; the reader will stay stopped until this succeeds."; $plantOk = $false }
            else { Ok "Live generation registered" }
        } else { $plantOk = $false; Warn "Not accepted; the reader stays stopped." }
    } finally { Pop-Location }
}

# ---- Windows services --------------------------------------------------------
Step "Windows services"
if (-not (Test-Path $Nssm)) { Fail "prereqs\nssm.exe is missing from the bundle." }
if (-not $svcName) {
    # -PlantOnly: find the SQL service the existing services depend on.
    $svcName = Invoke-Nssm @('get', 'SMS-Api', 'DependOnService')
}
function Install-SmsService($name, $entry, $logBase, [bool]$start) {
    if (Get-Service $name -ErrorAction SilentlyContinue) {
        [void](Invoke-Nssm @('stop', $name))
        [void](Invoke-Nssm @('remove', $name, 'confirm'))
        Start-Sleep -Seconds 2
    }
    [void](Invoke-Nssm @('install', $name, $script:NodeExe, (Join-Path $Here $entry)))
    if (-not (Get-Service $name -ErrorAction SilentlyContinue)) { Fail "Could not create service $name." }
    $settings = @(
        @('AppDirectory', $Here),
        @('DisplayName', "IFL SMS - $logBase"),
        @('AppStdout', (Join-Path $Here "logs\$logBase.log")),
        @('AppStderr', (Join-Path $Here "logs\$logBase.err.log")),
        @('AppRestartDelay', '10000'),
        @('AppRotateFiles', '1'),
        @('AppRotateOnline', '1'),
        @('AppRotateBytes', '52428800')
    )
    foreach ($s in $settings) { [void](Invoke-Nssm @('set', $name, $s[0], $s[1])) }
    if ($svcName) { [void](Invoke-Nssm @('set', $name, 'DependOnService', $svcName)) }
    if ($start) {
        [void](Invoke-Nssm @('set', $name, 'Start', 'SERVICE_AUTO_START'))
        [void](Invoke-Nssm @('start', $name))
        Start-Sleep -Seconds 3
        if ((Get-Service $name).Status -ne 'Running') { Warn "$name did not stay running. See logs\$logBase.err.log." }
    } else {
        [void](Invoke-Nssm @('set', $name, 'Start', 'SERVICE_DEMAND_START'))
    }
}
if ($PlantOnly) {
    if (-not (Get-Service SMS-Api -ErrorAction SilentlyContinue)) { Fail "SMS is not installed yet. Run .\install.ps1 without -PlantOnly first." }
    Restart-Service SMS-Api -Force
    Ok "SMS-Api restarted with the new settings"
} else {
    Install-SmsService 'SMS-Api' 'api\dist\index.js' 'api' $true
    Ok "SMS-Api installed and started (starts with Windows)"
}
Install-SmsService 'SMS-Sync' 'sync-worker\dist\index.js' 'sync' $plantOk
if ($plantOk) { Ok "SMS-Sync installed and started (starts with Windows)" }
else { Warn "SMS-Sync installed but NOT started (no confirmed plant connection yet)." }

# ---- Firewall ----------------------------------------------------------------
if (-not $PlantOnly) {
    Step "Firewall"
    netsh advfirewall firewall show rule name="SMS API" | Out-Null
    if ($LASTEXITCODE -eq 0) { Ok "Rule 'SMS API' already exists" }
    elseif (Ask "Allow other PCs on the plant network to open SMS on port $ApiPort?" 'y') {
        netsh advfirewall firewall add rule name="SMS API" dir=in action=allow protocol=TCP localport=$ApiPort | Out-Null
        Ok "Port $ApiPort opened"
    } else { Warn "Not opened; SMS will only work on this PC (http://localhost:$ApiPort)." }
}

# ---- Health check --------------------------------------------------------------
Step "Checking SMS answers"
$up = $false
for ($i = 0; $i -lt 30 -and -not $up; $i++) {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 "http://localhost:$ApiPort/api/health"
        if ($r.StatusCode -eq 200) { $up = $true }
    } catch { Start-Sleep -Seconds 2 }
}
if (-not $up) { Fail "SMS did not answer on port $ApiPort. Look at logs\api.err.log and logs\api.log." }
Ok "SMS is running"

$ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | ForEach-Object IPAddress
Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "  On this PC:        http://localhost:$ApiPort"
foreach ($ip in $ips) { Write-Host "  From other PCs:    http://${ip}:$ApiPort" }
if (-not $plantOk) { Write-Host "  Plant data:        not connected yet. When IFL gives the read-only login: .\install.ps1 -PlantOnly" }
Write-Host "  Logs:              $Here\logs"
Stop-Transcript | Out-Null
