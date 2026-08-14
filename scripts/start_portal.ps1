[CmdletBinding()]
param(
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$converterScript = Join-Path $projectRoot "scripts\local_word_converter.py"
$converterDirectory = Join-Path $projectRoot "tmp\word-converter"
$logDirectory = Join-Path $projectRoot ".codex-qa"

New-Item -ItemType Directory -Force -Path $converterDirectory, $logDirectory | Out-Null

$python = Get-Command py.exe -ErrorAction SilentlyContinue
if (-not $python) {
    $python = Get-Command python.exe -ErrorAction SilentlyContinue
}
if (-not $python) {
    throw "Python 3 is required to run the Word-to-PDF helper."
}

$converterRunning = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains("local_word_converter.py") } |
    Select-Object -First 1

if (-not $converterRunning) {
    $converterOut = Join-Path $logDirectory "word-converter-live.log"
    $converterErr = Join-Path $logDirectory "word-converter-live-error.log"
    $commandInterpreter = if ($env:ComSpec) { $env:ComSpec } else { "cmd.exe" }
    $converterCommand = 'start "" /b "{0}" "{1}" "{2}" 1>>"{3}" 2>>"{4}"' -f (
        $python.Source,
        $converterScript,
        $converterDirectory,
        $converterOut,
        $converterErr
    )
    & $commandInterpreter /d /s /c $converterCommand
    Start-Sleep -Seconds 1
}

$dockerCandidates = @(
    (Get-Command docker.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),
    (Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\resources\bin\docker.exe"),
    (Join-Path $env:ProgramFiles "Docker\Docker\resources\bin\docker.exe")
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

$docker = $dockerCandidates | Select-Object -First 1
if (-not $docker) {
    throw "Docker Desktop is required to run the portal stack."
}

Push-Location $projectRoot
try {
    $composeArguments = @("compose", "up", "-d")
    if (-not $SkipBuild) {
        $composeArguments += "--build"
    }
    & $docker @composeArguments
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Compose could not start the portal."
    }

    $ready = $false
    for ($attempt = 0; $attempt -lt 45; $attempt++) {
        try {
            $health = Invoke-RestMethod -Uri "http://localhost:8000/api/v1/health" -TimeoutSec 2
            if ($health.status -eq "ok") {
                $ready = $true
                break
            }
        } catch {
            Start-Sleep -Seconds 2
        }
    }
    if (-not $ready) {
        throw "The portal API did not become healthy within 90 seconds."
    }

    & $docker compose ps --all
    Write-Host ""
    Write-Host "AROMAZEN AI Portal is ready: http://localhost:3001" -ForegroundColor Green
    Write-Host "The Word-to-PDF helper is running for HR letter previews." -ForegroundColor Green
} finally {
    Pop-Location
}
