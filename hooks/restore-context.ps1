# UserPromptSubmit hook. PowerShell twin of restore-context.sh: same lookup, same output (design notes live there).
# Written for Windows PowerShell 5.1 and PowerShell 7. stdin/stdout are raw UTF-8 bytes, so the console code page
# (e.g. CP932) cannot garble paths or the snapshot text.
$ErrorActionPreference = 'SilentlyContinue'
$utf8 = New-Object System.Text.UTF8Encoding $false
$stdout = [Console]::OpenStandardOutput()
function Out-Line([string]$Text) { $b = $utf8.GetBytes($Text + "`n"); $stdout.Write($b, 0, $b.Length) }
function Write-Snapshot([string]$Path) {
    Out-Line '=== CONTEXT SNAPSHOT (自動復元) ==='
    $b = [System.IO.File]::ReadAllBytes($Path); $stdout.Write($b, 0, $b.Length)
    Out-Line '=== END SNAPSHOT ==='
    Out-Line ''
}
function ConvertTo-SnapshotKey([string]$Path) { # every UTF-8 byte not in [0-9A-Za-z] -> '-', as snapshot-path.sh/.ps1
    $sb = New-Object System.Text.StringBuilder
    foreach ($b in $utf8.GetBytes($Path)) {
        if (($b -ge 48 -and $b -le 57) -or ($b -ge 65 -and $b -le 90) -or ($b -ge 97 -and $b -le 122)) { [void]$sb.Append([char]$b) } else { [void]$sb.Append('-') }
    }
    $sb.ToString()
}
$cutoff = (Get-Date).AddMinutes(-60)
function Test-Fresh([string]$Path) { [System.IO.File]::Exists($Path) -and [System.IO.File]::GetLastWriteTime($Path) -gt $cutoff }

$ms = New-Object System.IO.MemoryStream
[Console]::OpenStandardInput().CopyTo($ms)
$cwd = $null
try { $cwd = ($utf8.GetString($ms.ToArray()) | ConvertFrom-Json).cwd } catch { }
if (-not $cwd) { $cwd = (Get-Location).ProviderPath }

$homeDir = $HOME
if ($env:OS -eq 'Windows_NT') {   # key off the drive-letter-upper-cased Windows form, as snapshot-path.sh under Git Bash
    if ($env:USERPROFILE) { $homeDir = $env:USERPROFILE }
    if ($cwd -cmatch '^[a-z]:') { $cwd = $cwd.Substring(0, 1).ToUpper() + $cwd.Substring(1) }
}
$snapDir = [System.IO.Path]::Combine($homeDir, '.claude')
$cwdKey = ConvertTo-SnapshotKey $cwd
$exact = [System.IO.Path]::Combine($snapDir, "context_snapshot_$cwdKey.md")

# 1) Exact cwd match.
if (Test-Fresh $exact) {
    Write-Snapshot $exact
    Out-Line '上記スナップショットを読み込み、context-restore スキルの手順で作業を再開してください。'
    return
}

# 2) Hierarchy fallback (ancestors, and descendants confirmed against real dirs).
$found = New-Object 'System.Collections.Generic.List[string]'   # "realdir|snapshotpath"
$desc = New-Object 'System.Collections.Generic.List[string]'    # "key|snapshotpath"
$names = @()
if ([System.IO.Directory]::Exists($snapDir)) { $names = @([System.IO.Directory]::GetFiles($snapDir, 'context_snapshot_*.md') | Where-Object { $_.EndsWith('.md') }) }
[Array]::Sort($names, [StringComparer]::Ordinal)
foreach ($snap in $names) {
    if (-not (Test-Fresh $snap)) { continue }
    $leaf = [System.IO.Path]::GetFileName($snap)
    $key = $leaf.Substring(17, $leaf.Length - 20)   # strip "context_snapshot_" and ".md"
    if ($key -ceq $cwdKey) { continue }
    if ($cwdKey.StartsWith("$key-", [StringComparison]::Ordinal)) {
        $p = $cwd
        while ($true) {
            $np = [System.IO.Path]::GetDirectoryName($p)
            if (-not $np -or $np -eq $p) { break }
            $p = $np
            if ((ConvertTo-SnapshotKey $p) -ceq $key -and [System.IO.Directory]::Exists($p)) { $found.Add("$p|$snap"); break }
        }
    }
    if ($key.StartsWith("$cwdKey-", [StringComparison]::Ordinal)) { $desc.Add("$key|$snap") }
}

# Descendants: 3 levels below cwd, pruned like the find in restore-context.sh; skipped for home and /.
$prune = @('node_modules', '.git', 'dist', 'build', 'vendor', '.venv', 'target', '.next')
if ($desc.Count -gt 0 -and [System.IO.Directory]::Exists($cwd) -and $cwd -ne $homeDir -and $cwd -ne '/') {
    $level = @($cwd)
    for ($depth = 1; $depth -le 3; $depth++) {
        $next = New-Object 'System.Collections.Generic.List[string]'
        foreach ($d in $level) {
            try { $children = (New-Object System.IO.DirectoryInfo $d).GetDirectories() } catch { continue }
            foreach ($c in $children) {
                if ($prune -ccontains $c.Name -or ($c.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) { continue }
                $next.Add($c.FullName)
                $ck = ConvertTo-SnapshotKey $c.FullName
                foreach ($e in $desc) {
                    $i = $e.IndexOf('|')
                    if ($e.Substring(0, $i) -ceq $ck) { $found.Add("$($c.FullName)|$($e.Substring($i + 1))") }
                }
            }
        }
        $level = $next
    }
}

$seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
$uniq = New-Object 'System.Collections.Generic.List[string]'
foreach ($m in $found) { if ($seen.Add($m)) { $uniq.Add($m) } }

if ($uniq.Count -eq 1) {
    $i = $uniq[0].IndexOf('|'); $dir = $uniq[0].Substring(0, $i); $path = $uniq[0].Substring($i + 1)
    Write-Snapshot $path
    Out-Line "（注: cwd 完全一致ではなく『階層フォールバック』で $dir のスナップショットを復元しました。"
    Out-Line "  削除する際はこの実パスを使うこと（snapshot-path.sh は cwd 由来の別パスを返す点に注意）: $path ）"
    Out-Line '上記スナップショットを読み込み、context-restore スキルの手順で作業を再開してください。'
} elseif ($uniq.Count -gt 1) {
    Out-Line '=== CONTEXT SNAPSHOT: 階層内に複数の新鮮な候補あり（自動復元は保留） ==='
    foreach ($m in $uniq) { $i = $m.IndexOf('|'); Out-Line "  - $($m.Substring(0, $i))   →   $($m.Substring($i + 1))" }
    Out-Line 'どれを復元するか指示するか、対象ディレクトリで起動し直してください。'
}
