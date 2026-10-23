#!/bin/bash
# UserPromptSubmit hook. Auto-injects a context snapshot after /clear, if fresh
# (< 60 min). Primary key = the current working directory, because /clear mints
# a new session_id (cwd is the only handle that survives a clear).
#
# Hierarchy fallback: if there is no exact-cwd snapshot, restore a fresh snapshot
# taken in an ANCESTOR or DESCENDANT directory of the cwd (the "same hierarchy") —
# e.g. you launched in ~/proj but the snapshot was written in ~/proj/app.
# The directory key is a LOSSY encoding (every non-alphanumeric -> '-'), so a naive
# string-prefix match would confuse true siblings (~/dev vs ~/dev-tools). To stay
# correct, every candidate is confirmed against the REAL filesystem before use.
# Auto-injects ONLY when exactly ONE fresh hierarchy candidate exists; if the
# hierarchy is ambiguous it lists them and stays hands-off.
#
# encode (${x//[!0-9A-Za-z]/-}) MUST stay identical to snapshot-path.sh's sed.
# Both run under LC_ALL=C: otherwise multibyte names (日本語) encode per byte or per char by locale.
# restore-context.ps1 is the PowerShell twin of this file (native Windows): keep the two in step.

INPUT=$(cat)
extract() { # $1 = json key
    if command -v jq >/dev/null 2>&1; then
        printf '%s' "$INPUT" | jq -r ".$1 // empty"
    else
        printf '%s' "$INPUT" | sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -1 | sed 's/\\\\/\\/g'
    fi
}
CWD=$(extract cwd)
[ -z "$CWD" ] && CWD="$PWD"

HOME_DIR="$HOME"
LC_ALL=C
# Git Bash on Windows: cwd arrives as C:\x while $PWD is /c/x. Work in C:/x, the form snapshot-path.sh keys off.
if command -v cygpath >/dev/null 2>&1; then
    winpath() { local p; p=$(cygpath -m "$1"); case "$p" in [a-z]:*) p=$(printf '%s' "${p:0:1}" | tr '[:lower:]' '[:upper:]')${p:1} ;; esac; printf '%s' "$p"; }
    CWD=$(winpath "$CWD"); HOME_DIR=$(winpath "${USERPROFILE:-$HOME}")
fi
SNAPDIR="$HOME_DIR/.claude"
is_fresh() { [ -f "$1" ] && find "$1" -mmin -60 2>/dev/null | grep -q .; }
emit_snapshot() { # $1 = snapshot path
    echo "=== CONTEXT SNAPSHOT (自動復元) ==="
    cat "$1"
    echo "=== END SNAPSHOT ==="
    echo ""
}

CWD_KEY="${CWD//[!0-9A-Za-z]/-}"
EXACT="$SNAPDIR/context_snapshot_${CWD_KEY}.md"

# 1) Exact cwd match — preferred, and the only path most sessions ever take.
if is_fresh "$EXACT"; then
    emit_snapshot "$EXACT"
    echo "上記スナップショットを読み込み、context-restore スキルの手順で作業を再開してください。"
    exit 0
fi

# 2) Hierarchy fallback.
shopt -s nullglob
declare -a matches=()   # confirmed: "realdir|snapshotpath"
declare -a desc=()      # descendant candidate keys (confirm later via real FS): "key|snapshotpath"

for snap in "$SNAPDIR"/context_snapshot_*.md; do
    is_fresh "$snap" || continue
    key="${snap##*/context_snapshot_}"; key="${key%.md}"
    [ "$key" = "$CWD_KEY" ] && continue

    # Ancestor candidate: CWD_KEY starts with "key-" -> snapshot dir may be an
    # ancestor of cwd. Confirm by walking cwd upward (real paths, unambiguous).
    if [ "${CWD_KEY#"$key"-}" != "$CWD_KEY" ]; then
        p="$CWD"
        while :; do
            np="$(dirname "$p")"
            { [ "$np" = "$p" ] || [ "$np" = "." ]; } && break   # "." : Windows C:/x tops out at C: then .
            p="$np"
            if [ "${p//[!0-9A-Za-z]/-}" = "$key" ] && [ -d "$p" ]; then
                matches+=("$p|$snap"); break
            fi
        done
    fi

    # Descendant candidate: key starts with "CWD_KEY-" -> confirm against real
    # subdirectories of cwd below (a single bounded find, only if any candidate).
    if [ "${key#"$CWD_KEY"-}" != "$key" ]; then
        desc+=("$key|$snap")
    fi
done

# Confirm descendant candidates by enumerating real dirs under cwd. Skipped for
# $HOME and / (too broad) and when there are no descendant candidates at all.
if [ "${#desc[@]}" -gt 0 ] && [ -d "$CWD" ] && [ "$CWD" != "$HOME_DIR" ] && [ "$CWD" != "/" ]; then
    while IFS= read -r d; do
        dk="${d//[!0-9A-Za-z]/-}"
        for ent in "${desc[@]}"; do
            [ "$dk" = "${ent%%|*}" ] && matches+=("$d|${ent#*|}")
        done
    done < <(find "$CWD" -mindepth 1 -maxdepth 3 \
                 \( -name node_modules -o -name .git -o -name dist -o -name build \
                    -o -name vendor -o -name .venv -o -name target -o -name .next \) -prune \
                 -o -type d -print 2>/dev/null)
fi

# Dedup. A newline-joined string, not `declare -A`: macOS /bin/bash is 3.2.
seen=$'\n'; declare -a uniq=()
for m in "${matches[@]}"; do
    case "$seen" in *$'\n'"$m"$'\n'*) continue ;; esac
    seen="$seen$m"$'\n'; uniq+=("$m")
done

if [ "${#uniq[@]}" -eq 1 ]; then
    path="${uniq[0]#*|}"; dir="${uniq[0]%%|*}"
    emit_snapshot "$path"
    echo "（注: cwd 完全一致ではなく『階層フォールバック』で $dir のスナップショットを復元しました。"
    echo "  削除する際はこの実パスを使うこと（snapshot-path.sh は cwd 由来の別パスを返す点に注意）: $path ）"
    echo "上記スナップショットを読み込み、context-restore スキルの手順で作業を再開してください。"
elif [ "${#uniq[@]}" -gt 1 ]; then
    echo "=== CONTEXT SNAPSHOT: 階層内に複数の新鮮な候補あり（自動復元は保留） ==="
    for m in "${uniq[@]}"; do echo "  - ${m%%|*}   →   ${m#*|}"; done
    echo "どれを復元するか指示するか、対象ディレクトリで起動し直してください。"
fi
