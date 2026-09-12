[CmdletBinding()]
param([ValidateSet('Check','Install','Remove')][string]$Action='Check')
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$Name='Discord-YuE2-BLUE-8191-From-BLACK'
$Python='C:\Users\Atsuki\Documents\Codex_workshop\yue2-blue-validation\python\cpython-3.13-windows-x86_64-none\python.exe'
if($env:COMPUTERNAME -ne 'DESKTOP-L9HAM1G') { throw 'BLUE required.' }
if(-not(Test-Path -LiteralPath $Python -PathType Leaf)) { throw 'Pinned isolated YuE2 Python missing.' }
$ip=Get-NetIPAddress -AddressFamily IPv4 | Where-Object IPAddress -eq '192.168.0.104'
if(-not $ip) { throw 'BLUE IP mismatch.' }
$profile=Get-NetConnectionProfile -InterfaceIndex $ip.InterfaceIndex
if($profile.NetworkCategory -ne 'Private') { throw 'BLUE LAN must already be Private; this script will not change it.' }
$rule=Get-NetFirewallRule -Name $Name -ErrorAction SilentlyContinue
function Assert-ExactRule($Rule) {
    $p=$Rule | Get-NetFirewallPortFilter
    $a=$Rule | Get-NetFirewallAddressFilter
    $app=$Rule | Get-NetFirewallApplicationFilter
    if($Rule.Direction -ne 'Inbound' -or $Rule.Action -ne 'Allow' -or [string]$Rule.Profile -ne 'Private' -or
        $Rule.Enabled -ne 'True' -or $Rule.EdgeTraversalPolicy -ne 'Block' -or
        [string]$p.Protocol -ne 'TCP' -or [string]$p.LocalPort -ne '8191' -or
        @($a.RemoteAddress).Count -ne 1 -or @($a.RemoteAddress)[0] -ne '192.168.0.105' -or
        @($a.LocalAddress).Count -ne 1 -or @($a.LocalAddress)[0] -ne '192.168.0.104' -or $app.Program -ne 'Any') {
        throw 'An existing rule with this name differs. No rule was modified; review manually.'
    }
}
if($rule) { Assert-ExactRule $rule }
if($Action -eq 'Install' -and -not $rule) {
    # Windows embedded/venv Python failed program-path matching in the real test.
    # Scope by one port + exact LAN peer/local IP + Private, not a general Python application rule.
    New-NetFirewallRule -Name $Name -DisplayName 'Discord YuE2 BLUE - BLACK only' -Direction Inbound -Action Allow -Enabled True -Profile Private -Protocol TCP -LocalPort 8191 -LocalAddress 192.168.0.104 -RemoteAddress 192.168.0.105 -EdgeTraversalPolicy Block | Out-Null
    $rule=Get-NetFirewallRule -Name $Name
    Assert-ExactRule $rule
}
if($Action -eq 'Remove' -and $rule) {
    # Only remove the exact scoped rule owned by this controller.
    Remove-NetFirewallRule -Name $Name
    $rule=$null
}
Write-Host "Rule: $Name / Present: $($null -ne $rule)"
Write-Host 'Scope: Private, TCP8191 only, 192.168.0.105 -> 192.168.0.104. No general Python application access.'
Write-Host 'No other rule, network profile, SSH/SMB setting, service, or router configuration was changed.'
