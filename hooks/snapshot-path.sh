#!/bin/bash
# Prints the context-snapshot path. Single source of truth for the naming
# pattern — used by the snapshot-clear / context-restore skills (write & delete)
# and by the restore / precompact hooks (read).
#
# Keyed by WORKING DIRECTORY, not session_id.
#   Why: `/clear` mints a brand-new session_id (a cleared session gets a fresh
#   id with parentUuid=null — no link to the pre-clear session). Keying by
#   session_id therefore orphaned every snapshot the moment /clear ran: it was
#   written under the old id and looked up under the new one. The working
#   directory is stable across /clear and is identical between the writing skill
#   ($PWD) and the reading hooks (stdin .cwd), so write and read always agree.
#
#   Trade-off: two sessions that /clear in the SAME directory share one snapshot
#   (last-writer-wins). This is unavoidable — after /clear there is no stable
#   handle to the pre-clear session other than its directory.
#
# Arg 1: working directory. Falls back to $PWD when no argument is given.
DIR="${1:-$PWD}"
[ -z "$DIR" ] && DIR="unknown"
# Encode the path the way Claude encodes project dirs: every non-alphanumeric -> '-'
KEY=$(printf '%s' "$DIR" | sed 's#[^A-Za-z0-9]#-#g')
printf '%s/.claude/context_snapshot_%s.md\n' "$HOME" "$KEY"
