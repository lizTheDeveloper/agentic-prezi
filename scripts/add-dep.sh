#!/bin/sh
# Add an npm dependency enforcing a 7-day minimum release age.
# Usage: scripts/add-dep.sh <package>[@version] [extra npm flags]
if [ "$#" -eq 0 ]; then
  echo "usage: scripts/add-dep.sh <package>[@version] [npm install flags]" >&2
  exit 1
fi
CUTOFF="$(node -e 'console.log(new Date(Date.now()-7*864e5).toISOString())')"
echo "Installing with --before=$CUTOFF (7-day minimum release age)"
exec npm install "$@" --before="$CUTOFF"
