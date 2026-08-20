[CmdletBinding()]
param(
    [ValidateSet('Status', 'Free', 'Stop')]
    [string]$Mode = 'Status',
    [switch]$Quiet,
    [int]$Port = 8188,
    [string]$BaseUrl = ''
)

# ComfyUI を安全に確認・解放・停止するための小さな管理スクリプトです。
# start/status/free/stop-comfyui-music.bat から呼び出します。

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$ComfyRoots = @(
    'C:\StabilityMatrix-v2.15.5\Data\Packages\ComfyUI',
    'C:\StabilityMatrix\Data\Packages\ComfyUI'
)
$ComfyRoots = @($ComfyRoots | Where-Object { Test-Path -LiteralPath $_ })
$ResolvedBaseUrl = if ($BaseUrl) { $BaseUrl.TrimEnd('/') } else { "http://127.0.0.1:$Port" }

function Write-Info([string]$Message) {
    if (-not $Quiet) {
        Write-Host $Message
    }
}

function Get-Listener {
    try {
        return @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
            Sort-Object OwningProcess | Select-Object -First 1)
    } catch {
        return @()
    }
}

function Get-ComfyProcesses {
    try {
        $all = @(Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" -ErrorAction SilentlyContinue)
        return @($all | Where-Object {
            $commandLine = [string]$_.CommandLine
            if (-not ($commandLine -match '(?i)main\.py')) { return $false }
            if (-not ($commandLine -match "(?i)--port\s+$Port(\s|$)")) { return $false }
            if ($ComfyRoots.Count -eq 0) { return $true }
            foreach ($root in $ComfyRoots) {
                if ($commandLine.IndexOf($root, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
                    return $true
                }
            }
            return $false
        })
    } catch {
        return @()
    }
}

function Get-ApiStats {
    try {
        return Invoke-RestMethod -Uri "$ResolvedBaseUrl/system_stats" -Method Get -TimeoutSec 5
    } catch {
        return $null
    }
}

function Format-Gb([object]$Bytes) {
    if ($null -eq $Bytes) { return 'n/a' }
    return ('{0:N1} GB' -f ([double]$Bytes / 1GB))
}

function Show-Status {
    $listener = @(Get-Listener)
    $comfyProcesses = @(Get-ComfyProcesses)
    $stats = Get-ApiStats

    if ($stats -and $listener.Count -gt 0) {
        $listenerPid = [int]$listener[0].OwningProcess
        Write-Info '[OK] ComfyUI status: RUNNING'
        Write-Info ("[INFO] URL: {0}  PID: {1}" -f $ResolvedBaseUrl, $listenerPid)
        if ($stats.system) {
            Write-Info ("[INFO] RAM free: {0} / {1}" -f (Format-Gb $stats.system.ram_free), (Format-Gb $stats.system.ram_total))
        }
        $devices = @($stats.devices)
        if ($devices.Count -gt 0) {
            Write-Info ("[INFO] VRAM free: {0} / {1}" -f (Format-Gb $devices[0].vram_free), (Format-Gb $devices[0].vram_total))
        }
        return 0
    }

    if ($listener.Count -gt 0) {
        $listenerPid = [int]$listener[0].OwningProcess
        Write-Info ("[WARN] Port {0} is occupied (PID {1}), but ComfyUI API is not responding." -f $Port, $listenerPid)
        return 2
    }

    if ($comfyProcesses.Count -gt 0) {
        $ids = ($comfyProcesses | ForEach-Object { $_.ProcessId }) -join ', '
        Write-Info ("[WARN] ComfyUI Python process remains without a listening port. PID: {0}" -f $ids)
        return 2
    }

    Write-Info '[INFO] ComfyUI status: STOPPED'
    return 1
}

function Invoke-Free {
    if (-not (Get-ApiStats)) {
        Write-Info '[ERROR] ComfyUI API is not responding. Nothing was released.'
        return 1
    }

    try {
        $body = '{"unload_models":true,"free_memory":true}'
        Invoke-RestMethod -Uri "$ResolvedBaseUrl/free" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 30 | Out-Null
        Start-Sleep -Seconds 2
        Write-Info '[OK] ComfyUI model memory was released.'
        $null = Show-Status
        return 0
    } catch {
        Write-Info ("[ERROR] Failed to release ComfyUI memory: {0}" -f $_.Exception.Message)
        return 1
    }
}

function Invoke-Stop {
    $listener = @(Get-Listener)
    $comfyProcesses = @(Get-ComfyProcesses)

    if ($listener.Count -gt 0) {
        $listenerPid = [int]$listener[0].OwningProcess
        $knownPids = @($comfyProcesses | ForEach-Object { [int]$_.ProcessId })
        if ($knownPids -notcontains $listenerPid) {
            Write-Info ("[ERROR] Port {0} belongs to an unknown process (PID {1}). It was not stopped." -f $Port, $listenerPid)
            return 2
        }
    }

    if ($comfyProcesses.Count -eq 0) {
        Write-Info '[INFO] No ComfyUI process is running.'
        return 0
    }

    if (Get-ApiStats) {
        try {
            $body = '{"unload_models":true,"free_memory":true}'
            Invoke-RestMethod -Uri "$ResolvedBaseUrl/free" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 30 | Out-Null
        } catch {
            Write-Info '[WARN] Model release API failed; stopping the verified ComfyUI process anyway.'
        }
    }

    foreach ($process in $comfyProcesses) {
        try {
            Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction Stop
            Write-Info ("[INFO] Stopped ComfyUI process PID {0}." -f $process.ProcessId)
        } catch {
            Write-Info ("[WARN] Could not stop PID {0}: {1}" -f $process.ProcessId, $_.Exception.Message)
        }
    }

    $remainingListener = @(Get-Listener)
    for ($attempt = 0; $attempt -lt 20 -and $remainingListener.Count -gt 0; $attempt++) {
        Start-Sleep -Milliseconds 500
        $remainingListener = @(Get-Listener)
    }
    $remainingProcesses = @(Get-ComfyProcesses)

    if ($remainingListener.Count -eq 0 -and $remainingProcesses.Count -eq 0) {
        Write-Info '[OK] ComfyUI stopped. RAM/VRAM can be reclaimed by Windows.'
        return 0
    }

    Write-Info '[WARN] A ComfyUI process or port 8188 is still present. Run this stop script again or inspect Task Manager.'
    return 2
}

$exitCode = switch ($Mode) {
    'Status' { Show-Status }
    'Free' { Invoke-Free }
    'Stop' { Invoke-Stop }
}
exit $exitCode
