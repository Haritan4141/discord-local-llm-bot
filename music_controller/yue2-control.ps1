[CmdletBinding()]
param([ValidateSet('Start','Stop','Status')][string]$Action='Status', [switch]$CheckOnly)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$Root='C:\Users\Atsuki\Documents\Codex_workshop\yue2-blue-validation'
$Main=Join-Path $Root 'ComfyUI\main.py'
$ExpectedPython=Join-Path $Root 'python\cpython-3.13-windows-x86_64-none\python.exe'
$Extension=Join-Path $Root 'ComfyUI\custom_nodes\discord_yue2_result\__init__.py'
$Base='http://127.0.0.1:8191'
function Get-Listeners {
    @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object LocalPort -eq 8191)
}
function Test-Identity($Process) {
    # Includes the pre-integration loopback launcher; exact isolated Python is mandatory.
    return ($null -ne $Process -and $Process.ExecutablePath -eq $ExpectedPython -and
        $Process.CommandLine -match '(?i)(^|\s|\\)main\.py"?(\s|$)' -and
        $Process.CommandLine -match '(?i)(^|\s)--port\s+8191(\s|$)')
}
function Assert-EmptyQueue {
    $q=Invoke-RestMethod "$Base/queue" -TimeoutSec 5
    if($q.queue_running -isnot [Array] -or $q.queue_pending -isnot [Array]) { throw 'Queue status unknown. No stop/free was requested.' }
    if($q.queue_running.Count -or $q.queue_pending.Count) { throw 'Generation is running or queued. Wait before stopping.' }
}
try {
    if($env:COMPUTERNAME -ne 'DESKTOP-L9HAM1G') { throw 'BLUE / DESKTOP-L9HAM1G required.' }
    if(-not(Get-NetIPAddress -AddressFamily IPv4 | Where-Object IPAddress -eq '192.168.0.104')) { throw 'BLUE LAN IP mismatch.' }
    foreach($file in @($Main,$ExpectedPython,(Join-Path $Root 'scripts\environment.ps1'))) {
        if(-not(Test-Path -LiteralPath $file -PathType Leaf)) { throw "Required file missing: $file" }
    }
    $listeners=@(Get-Listeners)
    $owners=@($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
    if($CheckOnly -or $Action -eq 'Status') {
        Write-Host "YuE2 BLUE: $($listeners.Count) listener(s), PID: $($owners -join ', ')"
        Write-Host "Local: $Base / LAN: http://192.168.0.104:8191 (Bot PC only)"
        Write-Host "Result extension installed: $(Test-Path -LiteralPath $Extension)"
        if($owners.Count) {
            foreach($owner in $owners) {
                $p=Get-CimInstance Win32_Process -Filter "ProcessId=$owner"
                Write-Host "Verified YuE2 process: $(Test-Identity $p)"
            }
        }
        exit 0
    }
    if($Action -eq 'Start') {
        if($listeners.Count) { throw '8191 is occupied. Nothing was started or stopped.' }
        if(-not(Test-Path -LiteralPath $Extension)) { throw 'Install the discord_yue2_result extension before starting.' }
        $stale=@(Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object {Test-Identity $_})
        if($stale.Count) { throw 'A YuE2 process exists without a listener. Ask the administrator; no duplicate was started.' }
        . (Join-Path $Root 'scripts\environment.ps1')
        $gpu=@(& nvidia-smi --query-gpu=name,uuid --format=csv,noheader)
        if(-not($gpu | Where-Object {$_ -match 'NVIDIA GeForce RTX 3090, GPU-e5370fc5-8df1-b0ba-15e8-4574ca831b2e'})) { throw 'RTX 3090 UUID mismatch.' }
        Write-Host 'YuE2 STARTING - keep this console open. Use stop-yue2.bat after the queue is empty.'
        Write-Host 'Local: http://127.0.0.1:8191 / LAN: http://192.168.0.104:8191'
        Push-Location (Join-Path $Root 'ComfyUI')
        try {
            & $python -u $Main --listen 127.0.0.1,192.168.0.104 --port 8191 --disable-auto-launch --disable-all-custom-nodes --whitelist-custom-nodes discord_yue2_result --disable-api-nodes --output-directory (Join-Path $Root 'outputs') --temp-directory (Join-Path $Root 'temp') --user-directory (Join-Path $Root 'user')
            $result=$LASTEXITCODE
        } finally { Pop-Location }
        Write-Host "YuE2 exited. Code: $result"
        exit $result
    }
    if($owners.Count -eq 0) { Write-Host 'No YuE2 listener. Nothing was stopped.'; exit 0 }
    if($owners.Count -ne 1) { throw 'Ambiguous listener ownership.' }
    if(@($listeners | Where-Object LocalAddress -notin @('127.0.0.1','192.168.0.104')).Count) { throw 'Unexpected bind address. No process was stopped.' }
    $targetId=[int]$owners[0]
    $target=Get-CimInstance Win32_Process -Filter "ProcessId=$targetId"
    if(-not(Test-Identity $target)) { throw '8191 belongs to another process. Nothing was stopped.' }
    Assert-EmptyQueue
    $current=Get-CimInstance Win32_Process -Filter "ProcessId=$targetId"
    if(-not(Test-Identity $current) -or $current.CreationDate -ne $target.CreationDate -or $current.CommandLine -ne $target.CommandLine) { throw 'Process identity changed.' }
    $handle=Get-Process -Id $targetId
    $ticks=$handle.StartTime.ToUniversalTime().Ticks
    if(($ticks-($ticks%10)) -ne $target.CreationDate.ToUniversalTime().Ticks) { throw 'Process creation time changed.' }
    Assert-EmptyQueue
    Stop-Process -InputObject $handle
    if(-not $handle.WaitForExit(10000)) { throw 'YuE2 did not exit within 10 seconds.' }
    if(@(Get-Listeners).Count) { throw '8191 is still occupied. No other process was stopped.' }
    Write-Host 'YuE2 STOPPED. ACE-Step / video servers were not stopped.'
} catch { Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red; exit 1 }
