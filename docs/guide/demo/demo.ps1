<#
.SYNOPSIS
  Launcher for the SMS demo environment used by the illustrated guide
  (worker T1, docs/guide plan section 4, task "T1").

.DESCRIPTION
  Every sms/ process (sync worker, API, CLI, scripts/migrate.mjs,
  scripts/simulate-plant.mjs) loads its config from environment variables
  first and falls back to sms/.env only for a key NOT already present in the
  process environment (verified in sync-worker/src/config.ts,
  scripts/migrate.mjs, scripts/simulate-plant.mjs, cli/src/context.ts,
  28 Sep 2026). This script exploits exactly that: it loads the DEMO's own
  key/value files into ITS OWN process environment, then launches an sms/
  command as a child process, which inherits that environment. sms/.env is
  never opened for writing, and every key it does contain is independently
  read (names only) so this script can PROVE none of them would leak in.

  Three files, layered in this order (later files may add keys, but every
  key must appear in exactly one of them - see below):
    demo.env          - every NON-secret key (committed; see demo.env's own header)
    demo-secrets.env   - every DB credential (gitignored; owner-written, see OWNER-STEP.md)
    demo-login.env     - the demo app account used by the capture tool (gitignored; owner-written)
  demo-login.env is optional for most subcommands (only the capture tool
  reads SMS_TEST_USERNAME/SMS_TEST_PASSWORD from it directly) and is loaded
  if present, ignored if not.

.PARAMETER Command
  One of: migrate | cli | worker | api | sim

.PARAMETER Rest
  Everything after Command is passed through verbatim (e.g.
  `demo.ps1 cli user:create --username=... --password=... --role=admin`,
  `demo.ps1 sim --days=21`).

.NOTES
  Never edits sms/.env. Never prints the VALUE of any environment variable -
  only key NAMES appear in any message this script writes, on screen or to
  its log files. Working directory for every child process is sms/, because
  that is what every one of these entry points assumes (relative paths to
  db/migrations, cli/dist, api/dist, sync-worker/dist, scripts/).
#>
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet('migrate', 'cli', 'worker', 'api', 'sim')]
  [string]$Command,

  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Rest
)

$ErrorActionPreference = 'Stop'

$DemoDir = $PSScriptRoot
$RepoRoot = Resolve-Path (Join-Path $DemoDir '..\..\..')
$SmsDir = Join-Path $RepoRoot 'sms'
$LogsDir = Join-Path $DemoDir 'logs'
$RealEnvFile = Join-Path $SmsDir '.env'

if (-not (Test-Path $LogsDir)) {
  New-Item -ItemType Directory -Path $LogsDir | Out-Null
}

# --------------------------------------------------------------- env files

function Read-EnvFile {
  param([string]$Path, [bool]$Required)
  $result = @{}
  if (-not (Test-Path $Path)) {
    if ($Required) {
      throw "REFUSED: required env file not found: $Path"
    }
    return $result
  }
  foreach ($line in Get-Content -Path $Path) {
    $t = $line.Trim()
    if ($t -eq '' -or $t.StartsWith('#')) { continue }
    $idx = $t.IndexOf('=')
    if ($idx -lt 0) { continue }
    $key = $t.Substring(0, $idx).Trim()
    $val = $t.Substring($idx + 1)
    if ($key -match '^[A-Za-z_][A-Za-z0-9_]*$') {
      $result[$key] = $val
    }
  }
  return $result
}

$demoEnvPath = Join-Path $DemoDir 'demo.env'
$secretsEnvPath = Join-Path $DemoDir 'demo-secrets.env'
$loginEnvPath = Join-Path $DemoDir 'demo-login.env'

$merged = @{}
try {
  foreach ($kv in (Read-EnvFile -Path $demoEnvPath -Required $true).GetEnumerator()) { $merged[$kv.Key] = $kv.Value }
  foreach ($kv in (Read-EnvFile -Path $secretsEnvPath -Required $true).GetEnumerator()) { $merged[$kv.Key] = $kv.Value }
  foreach ($kv in (Read-EnvFile -Path $loginEnvPath -Required $false).GetEnumerator()) { $merged[$kv.Key] = $kv.Value }
} catch {
  Write-Error $_.Exception.Message
  Write-Error "See docs/guide/demo/OWNER-STEP.md - demo-secrets.env (and, later, demo-login.env) must exist before demo.ps1 can run anything."
  exit 1
}

# ------------------------------------------------------- coverage guard

# Key NAMES only, never values (hard constraint: never print .env contents).
$realKeys = @()
if (Test-Path $RealEnvFile) {
  foreach ($line in Get-Content -Path $RealEnvFile) {
    if ($line -match '^([A-Z_][A-Z0-9_]*)=') { $realKeys += $Matches[1] }
  }
  $realKeys = $realKeys | Sort-Object -Unique
} else {
  Write-Warning "sms/.env not found - cannot verify coverage against it. Proceeding on demo.env/demo-secrets.env alone."
}

$missing = @()
foreach ($k in $realKeys) {
  if (-not $merged.ContainsKey($k)) { $missing += $k }
}
if ($missing.Count -gt 0) {
  Write-Error "REFUSED: the following key(s) appear in sms/.env but are not covered by demo.env/demo-secrets.env/demo-login.env. Without them, a demo process would silently fall back to sms/.env's own value (the real dev database)."
  Write-Error ("Missing key name(s): " + ($missing -join ', '))
  exit 1
}

# ------------------------------------------------------- sanity guards

function Require {
  param([string]$Condition, [string]$Message)
  if (-not $Condition) {
    Write-Error "REFUSED: $Message"
    exit 1
  }
}

if ($merged['APP_DB_NAME'] -ne 'SMS_DEMO') {
  Write-Error "REFUSED: APP_DB_NAME must be exactly 'SMS_DEMO' in the demo (found a different value)."
  exit 1
}
if (-not ($merged['IFL_DB_NAME_DATA'] -match '_SIM$')) {
  Write-Error "REFUSED: IFL_DB_NAME_DATA must end in '_SIM' in the demo (matches scripts/simulate-plant.mjs's own guard)."
  exit 1
}
if ($merged['IFL_DB_NAME_PDAS'] -ne 'PDAS_DEMO') {
  Write-Error "REFUSED: IFL_DB_NAME_PDAS must be exactly 'PDAS_DEMO' in the demo."
  exit 1
}
if ($merged['PDAS_WRITE_ENABLED'] -ne 'false') {
  Write-Error "REFUSED: PDAS_WRITE_ENABLED must be 'false' in the demo (the demo PDAS has no vendor stored procedures)."
  exit 1
}
if ($merged['API_PORT'] -eq '4000') {
  Write-Error "REFUSED: API_PORT must not be 4000 in the demo (that is the dev API's own port; the demo must never share it)."
  exit 1
}

# ------------------------------------------------------- apply to environment

foreach ($kv in $merged.GetEnumerator()) {
  Set-Item -Path "Env:$($kv.Key)" -Value $kv.Value
}

Write-Output "Demo environment loaded and guarded ($($merged.Count) keys; sms/.env has $($realKeys.Count), all covered)."

# ------------------------------------------------------------- dispatch

Push-Location $SmsDir
try {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $logFile = Join-Path $LogsDir "$Command-$stamp.log"

  switch ($Command) {
    'migrate' {
      Write-Output "Running: migrate"
      & node scripts/migrate.mjs @Rest 2>&1 | Tee-Object -FilePath $logFile
    }
    'cli' {
      Write-Output "Running: cli $($Rest | Select-Object -First 1)"
      & node cli/dist/index.js @Rest 2>&1 | Tee-Object -FilePath $logFile
    }
    'worker' {
      Write-Output "Running: node sync-worker/dist/index.js"
      & node sync-worker/dist/index.js 2>&1 | Tee-Object -FilePath $logFile
    }
    'api' {
      Write-Output "Running: node api/dist/index.js"
      & node api/dist/index.js 2>&1 | Tee-Object -FilePath $logFile
    }
    'sim' {
      Write-Output "Running: sim"
      & node scripts/simulate-plant.mjs @Rest 2>&1 | Tee-Object -FilePath $logFile
    }
  }
  $exitCode = $LASTEXITCODE
} finally {
  Pop-Location
}

exit $exitCode
