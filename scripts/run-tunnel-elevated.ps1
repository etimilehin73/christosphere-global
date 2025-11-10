# One-click PowerShell to allow Node outbound and start the app + localtunnel
# Usage: right-click and "Run with PowerShell" OR run from an elevated PowerShell:
# PowerShell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-tunnel-elevated.ps1

param()

function Ensure-RunningAsAdmin {
    $current = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($current)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Write-Host "Not running as Administrator — relaunching elevated..."
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = 'powershell'
        $psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
        $psi.Verb = 'runas'
        try {
            [System.Diagnostics.Process]::Start($psi) | Out-Null
        } catch {
            Write-Error "Failed to relaunch elevated: $_"
        }
        Exit
    }
}

Ensure-RunningAsAdmin

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Write-Host "Project dir: $ProjectDir"

$NodePath = "C:\Program Files\nodejs\node.exe"
$NpmPath = "C:\Program Files\nodejs\npm.cmd"

if (-not (Test-Path $NodePath)) {
    Write-Error "Node executable not found at $NodePath. Please install Node.js LTS and re-run this script."
    Exit 1
}

# Create firewall rule if missing
$ruleName = "Allow Node Outbound for LocalTunnel"
try {
    $existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
} catch {
    $existing = $null
}

if (-not $existing) {
    Write-Host "Creating outbound firewall rule for node.exe..."
    try {
        New-NetFirewallRule -DisplayName $ruleName -Direction Outbound -Program $NodePath -Action Allow -Profile Any -Description "Temporary allow for localtunnel outbound" | Out-Null
        Write-Host "Firewall rule created: $ruleName"
    } catch {
        Write-Error "Failed to create firewall rule: $_"
        Write-Host "You can create it manually with the following command (run as Administrator):"
        Write-Host "New-NetFirewallRule -DisplayName \"$ruleName\" -Direction Outbound -Program \"$NodePath\" -Action Allow -Profile Any -Description \"Temporary allow for localtunnel outbound\""
        Exit 1
    }
} else {
    Write-Host "Firewall rule already exists: $ruleName"
}

# Ensure we are in project dir
Set-Location $ProjectDir

# Install localtunnel if missing
if (-not (Test-Path (Join-Path $ProjectDir 'node_modules\localtunnel'))) {
    Write-Host "Installing localtunnel (will be saved to devDependencies)..."
    & $NpmPath install --no-audit --no-fund localtunnel@2.0.2 --save-dev
    if ($LASTEXITCODE -ne 0) {
        Write-Error "npm install localtunnel failed (exit $LASTEXITCODE). Please run the install manually and retry."
        Exit 1
    }
}

# Start server if not running (look for a node process running server.js)
$serverRunning = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine -match 'server.js' }
if (-not $serverRunning) {
    Write-Host "Starting server (node server.js) in background..."
    Start-Process -FilePath $NodePath -ArgumentList 'server.js' -WorkingDirectory $ProjectDir -WindowStyle Hidden | Out-Null
    Start-Sleep -Seconds 1
} else {
    Write-Host "Server already appears to be running."
}

# Run localtunnel in the current elevated console so user sees the URL
$ltPath = Join-Path $ProjectDir 'node_modules\localtunnel\bin\lt.js'
if (-not (Test-Path $ltPath)) {
    Write-Error "localtunnel CLI not found at $ltPath"
    Exit 1
}

Write-Host "Starting localtunnel; the public URL will be printed below. Press Ctrl+C to stop the tunnel when you're done."

& $NodePath $ltPath --port 3000 --print-requests

Write-Host "localtunnel exited. If you want to remove the firewall rule, run: Remove-NetFirewallRule -DisplayName \"$ruleName\""