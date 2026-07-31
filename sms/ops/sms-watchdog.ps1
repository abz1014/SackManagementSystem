# ============================================================================
# SMS API + ngrok self-healing watchdog
#
# Every 30s it verifies the API (port 4000, serving the built SPA) and the
# ngrok tunnel are alive, and restarts whichever is down. Registered as a
# Scheduled Task at logon by install-sms-watchdog.ps1, so the public site
# comes back on its own after boot, logon, or wake-from-sleep.
#
# Public URL: https://unnamed-thriving-choosing.ngrok-free.dev
#
# SHARED-DOMAIN WARNING
# The ngrok account is free tier: ONE reserved domain, one live endpoint.
# The EMS watchdog ("EMS Tunnel Watchdog") tunnels the same domain to port
# 5045. Both watchdogs force-kill ngrok when they think it is wrong, so
# running both enabled would flap the domain back and forth every 30s.
# Ensure-Tunnel below therefore STANDS DOWN whenever the EMS task is
# enabled — only one of the two may own the domain at a time, on purpose.
# ============================================================================

$ErrorActionPreference = 'SilentlyContinue'

$repo       = 'C:\Users\ABDULLAH SAJID\Desktop\sag database\sms'
$apiEntry   = Join-Path $repo 'api\dist\index.js'
$webDist    = Join-Path $repo 'web\dist'
$policyFile = Join-Path $repo 'ops\sms-tunnel-policy.yml'
$port       = 4000
$emsTask    = 'EMS Tunnel Watchdog'

$logDir = Join-Path $env:LOCALAPPDATA 'sms-watchdog'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$apiLog   = Join-Path $logDir 'sms-api.log'
$ngrokLog = Join-Path $logDir 'ngrok.log'
$watchLog = Join-Path $logDir 'watchdog.log'

function Log($msg) {
    $line = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    Add-Content -Path $watchLog -Value $line
    if ((Get-Item $watchLog).Length -gt 512KB) {
        $tail = Get-Content $watchLog -Tail 500
        Set-Content -Path $watchLog -Value $tail
    }
}

# /api/health is anonymous and does a real 'SELECT 1' against the app DB, so a
# 200 means Express is up AND SQL Server is reachable — not just that the port
# is bound. Any other outcome counts as down.
function Test-Api {
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:$port/api/health" -UseBasicParsing -TimeoutSec 5
        return $r.StatusCode -eq 200
    } catch { return $false }
}

# Kill ONLY whatever holds port 4000 — never "all node.exe". Vite dev servers,
# editors and other tooling on this machine are node too, and taking them out
# to restart the API would be a nasty surprise.
function Stop-ApiProcs {
    try {
        Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
            ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
    } catch { }
    Start-Sleep -Seconds 2
}

function Launch-Api {
    if (-not (Test-Path $apiEntry)) { Log "MISSING $apiEntry - run: npx tsc -b api"; return }
    if (-not (Test-Path $webDist))  { Log "MISSING $webDist - run: npx vite build web" }
    # COOKIE_SECURE=true because the tunnel terminates TLS; the session cookie
    # must carry the Secure flag over the public HTTPS origin.
    $env:WEB_DIST      = $webDist
    $env:COOKIE_SECURE = 'true'
    Start-Process -FilePath 'node' -ArgumentList @("`"$apiEntry`"") `
        -WorkingDirectory $repo -WindowStyle Hidden `
        -RedirectStandardOutput $apiLog -RedirectStandardError "$apiLog.err"
}

function Ensure-Api {
    if (Test-Api) { return }
    Log 'API down -> clean restart'
    Stop-ApiProcs
    Launch-Api
    for ($i = 0; $i -lt 10; $i++) {
        Start-Sleep -Seconds 3
        if (Test-Api) { Log 'API up'; return }
    }
    Log 'API still not up after 30s'
}

# Stricter than the EMS watchdog's equivalent, which treats ANY https tunnel as
# healthy. We must know the tunnel points at OUR port: if something repoints
# the shared domain elsewhere, "a tunnel exists" is not good enough.
# Probe the PUBLIC url, not ngrok's local agent API.
#
# The agent API on 127.0.0.1:4040 proved unreliable from inside the Scheduled
# Task context - it reported "no tunnel" while the site was demonstrably
# serving - and it also cannot tell us whether the auth gate is actually
# applied. A 401 from the public URL proves the whole chain in one call: DNS,
# the tunnel, and the basic-auth policy. Anything else (connection failure, or
# ngrok's own 404 "endpoint offline" page) means the tunnel is not ours.
$publicUrl = 'https://unnamed-thriving-choosing.ngrok-free.dev'

function Test-Tunnel {
    try {
        # 'ngrok-skip-browser-warning' + a non-browser agent suppress ngrok's
        # free-tier interstitial, which is served as HTTP 200 and would
        # otherwise look like "the auth gate is off".
        $r = Invoke-WebRequest -Uri $publicUrl -UseBasicParsing -TimeoutSec 10 `
                -UserAgent 'sms-watchdog' -Headers @{ 'ngrok-skip-browser-warning' = '1' }
        return $false   # a real 200 without credentials means the gate is OFF
    } catch {
        $code = $_.Exception.Response.StatusCode.value__
        # 401 = tunnel up AND gate enforcing. The only healthy answer.
        return ($code -eq 401)
    }
}

function Ensure-Tunnel {
    if (Test-Tunnel) { return }

    # Stand down rather than start a kill-war over the single free-tier domain.
    $ems = Get-ScheduledTask -TaskName $emsTask -ErrorAction SilentlyContinue
    if ($ems -and $ems.State -ne 'Disabled') {
        Log "tunnel not ours, but '$emsTask' is enabled - standing down (disable it to give SMS the domain)"
        return
    }

    if (-not (Test-Path $policyFile)) { Log "MISSING $policyFile - tunnel would be UNAUTHENTICATED, refusing"; return }

    # Be very patient with an agent that is already running. Killing ngrok makes
    # the cloud side hold the reserved domain (ERR_NGROK_334) while the old
    # endpoint drains, so a relaunch takes minutes, not seconds - and an
    # impatient watchdog kills the new agent just as it is about to succeed,
    # which is exactly the flap this replaces. Only a genuinely stuck agent is
    # worth restarting.
    $existing = Get-Process ngrok -ErrorAction SilentlyContinue
    if ($existing) {
        $age = ((Get-Date) - ($existing | Sort-Object StartTime | Select-Object -First 1).StartTime).TotalSeconds
        if ($age -lt 300) { Log ("ngrok {0:N0}s old, no tunnel yet - waiting" -f $age); return }
        Log ("ngrok stuck {0:N0}s -> restarting" -f $age)
    } else {
        Log 'no ngrok -> starting'
    }

    Get-Process ngrok -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 2
    Start-Process -FilePath 'ngrok' `
        -ArgumentList @('http', "$port", '--traffic-policy-file', "`"$policyFile`"") `
        -WindowStyle Hidden `
        -RedirectStandardOutput $ngrokLog -RedirectStandardError "$ngrokLog.err"
    # Don't block the loop polling for success: establishing the tunnel can take
    # minutes after a domain conflict. The next 30s cycle verifies it, and the
    # age guard above stops us relaunching on top of it meanwhile.
    Log 'ngrok launched - will verify next cycle'
}

Log '=== sms watchdog started ==='

while ($true) {
    Ensure-Api      # only tunnel to a live app, so do this first
    Ensure-Tunnel
    Start-Sleep -Seconds 30
}
