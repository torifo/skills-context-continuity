# Prints the context-snapshot path. PowerShell twin of snapshot-path.sh: both MUST produce the same file name.
# On Windows the key comes from the Windows form of the path with the drive letter upper-cased, the same form
# snapshot-path.sh uses under Git Bash, so a snapshot written from either shell is found by either hook.
param([string]$Dir)
if (-not $Dir) { $Dir = (Get-Location).ProviderPath }
$base = $HOME
if ($env:OS -eq 'Windows_NT') {
    if ($env:USERPROFILE) { $base = $env:USERPROFILE }   # Claude Code's ~ ($HOME can be HOMEDRIVE+HOMEPATH)
    if ($Dir -cmatch '^[a-z]:') { $Dir = $Dir.Substring(0, 1).ToUpper() + $Dir.Substring(1) }
}
# Every UTF-8 byte that is not [0-9A-Za-z] -> '-' (same as LC_ALL=C sed in snapshot-path.sh)
$key = New-Object System.Text.StringBuilder
foreach ($b in [System.Text.Encoding]::UTF8.GetBytes($Dir)) {
    if (($b -ge 48 -and $b -le 57) -or ($b -ge 65 -and $b -le 90) -or ($b -ge 97 -and $b -le 122)) { [void]$key.Append([char]$b) } else { [void]$key.Append('-') }
}
[System.IO.Path]::Combine([System.IO.Path]::Combine($base, '.claude'), "context_snapshot_$key.md")
