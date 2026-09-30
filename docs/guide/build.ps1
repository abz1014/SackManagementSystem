<#
.SYNOPSIS
  End-to-end build for the IFL SMS User & IT Guide:
  markdown (docs/guide/src) -> docx (build_docx.py) -> Word COM finish
  (TOC/fields/PDF, word_finish.ps1) -> checks (checks.py, source AND the
  final docx) -> copy both files to the Desktop SMS-Guide folder.

.PARAMETER Draft
  Passed through to build_docx.py (allows [[TBD: ...]] markers) and to
  checks.py (missing facts/*.md files become WARN instead of FAIL). Any
  other check failure (a real bad label/path/command/redaction hit) still
  fails the build even in -Draft mode.

.PARAMETER DesktopDir
  Where the finished docx/pdf are copied. Defaults to the owner's
  Desktop\SMS-Guide folder, created if missing.
#>
param(
    [switch]$Draft,
    [string]$DesktopDir = "$([Environment]::GetFolderPath('Desktop'))\SMS-Guide",
    # Overrides for pipeline smoke-testing only (see README-BUILD.md). The
    # real build always uses docs/guide/{src,images,facts}.
    [string]$SrcDir,
    [string]$ImagesDir,
    [string]$FactsDir
)

$ErrorActionPreference = "Stop"

$GuideRoot = $PSScriptRoot
$RepoRoot = (Resolve-Path (Join-Path $GuideRoot "..\..")).Path
$OutDir = Join-Path $GuideRoot "out"
$DocxPath = Join-Path $OutDir "IFL-SMS-User-and-IT-Guide.docx"
$PdfPath = Join-Path $OutDir "IFL-SMS-User-and-IT-Guide.pdf"

if (-not $SrcDir) { $SrcDir = Join-Path $GuideRoot "src" }
if (-not $ImagesDir) { $ImagesDir = Join-Path $GuideRoot "images" }
if (-not $FactsDir) { $FactsDir = Join-Path $GuideRoot "facts" }

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }

function Section($title) {
    Write-Host ""
    Write-Host "=== $title ===" -ForegroundColor Cyan
}

# Find a python launcher.
$python = $null
foreach ($cand in @("python", "py")) {
    if (Get-Command $cand -ErrorAction SilentlyContinue) { $python = $cand; break }
}
if (-not $python) {
    Write-Error "build.ps1: no 'python' or 'py' found on PATH."
    exit 1
}

# --- Step 1: build the .docx from markdown -----------------------------
Section "Building .docx from docs/guide/src"
$buildArgs = @(
    (Join-Path $GuideRoot "build\build_docx.py"),
    "--repo-root", $RepoRoot,
    "--src-dir", $SrcDir,
    "--out", $DocxPath
)
if ($Draft) { $buildArgs += "--draft" }
& $python @buildArgs
if ($LASTEXITCODE -ne 0) {
    Write-Error "build.ps1: build_docx.py failed (exit $LASTEXITCODE). Stopping before Word/checks."
    exit $LASTEXITCODE
}

# --- Step 2: Word COM finish (TOC/fields/pagination + PDF export) ------
Section "Word COM: updating TOC/fields and exporting PDF"
& (Join-Path $GuideRoot "build\word_finish.ps1") -DocxPath $DocxPath -PdfPath $PdfPath
if ($LASTEXITCODE -ne 0) {
    Write-Error "build.ps1: word_finish.ps1 failed (exit $LASTEXITCODE). Nothing was installed; see the error above. Stopping."
    exit $LASTEXITCODE
}

# --- Step 3: checks (source + the final docx, e.g. for redaction) ------
Section "Running checks.py"
$checkArgs = @(
    (Join-Path $GuideRoot "build\checks.py"),
    "--repo-root", $RepoRoot,
    "--src-dir", $SrcDir,
    "--images-dir", $ImagesDir,
    "--facts-dir", $FactsDir,
    "--docx", $DocxPath,
    "--report", (Join-Path $OutDir "check-report.md")
)
if ($Draft) { $checkArgs += "--draft" }
& $python @checkArgs
$checksExit = $LASTEXITCODE
if ($checksExit -ne 0) {
    Write-Error "build.ps1: checks.py found FAIL-level issues (see docs\guide\out\check-report.md). Not copying to the Desktop."
    exit $checksExit
}

# --- Step 4: copy to the Desktop ---------------------------------------
Section "Copying to $DesktopDir"
if (-not (Test-Path $DesktopDir)) { New-Item -ItemType Directory -Force -Path $DesktopDir | Out-Null }
Copy-Item -Force $DocxPath $DesktopDir
Copy-Item -Force $PdfPath $DesktopDir

Write-Host ""
Write-Host "build.ps1: done." -ForegroundColor Green
Write-Host "  docx: $DocxPath"
Write-Host "  pdf:  $PdfPath"
Write-Host "  copied to: $DesktopDir"
