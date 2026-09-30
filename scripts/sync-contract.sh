#!/bin/sh
# Copy scenario.v2 from the Vigilans contract package, the single source of truth, then
# regenerate types and validators. The copy lets Videns build on its own; the scenario test
# fails if the two differ whenever VIGILANS_CONTRACT_DIR points at the package's schemas.
#
#   scripts/sync-contract.sh [path/to/Vigilans 2.0/contract/schemas]
set -eu
here=$(dirname "$0")/..
src=${1:-"$here/../Vigilans 2.0/contract/schemas"}
cp "$src/scenario.v2.schema.json" "$here/contract/scenario.v2.schema.json"
echo "copied scenario.v2.schema.json from $src; now run: npm run gen"
