#!/bin/sh
# Render /videns.config.json from the environment and the basemap list
# (VIDENS_SPEC.md section 11). Values are checked by the viewer, which shows any problem on
# screen; this script only refuses values that would produce invalid JSON.
set -eu

out_dir=/tmp/videns
mkdir -p "$out_dir"

json_string() {
    case "$1" in
        *'"'* | *'\'*) echo "40-videns-config: refusing $2 containing a quote or backslash" >&2; exit 1 ;;
    esac
    printf '"%s"' "$1"
}

json_literal() {
    case "$1" in
        *[!-0-9.a-z,:{}\"\ ]*) echo "40-videns-config: refusing $2=$1" >&2; exit 1 ;;
    esac
    printf '%s' "$1"
}

basemaps_file="${VIDENS_BASEMAPS_FILE:-/etc/videns/basemaps.json}"

{
    printf '{\n'
    printf '  "feed": %s,\n' "$(json_string "${VIDENS_FEED:-/picture/v0}" VIDENS_FEED)"
    printf '  "basemap": %s,\n' "$(json_string "${VIDENS_BASEMAP:-none}" VIDENS_BASEMAP)"
    printf '  "basemaps": '
    cat "$basemaps_file"
    printf ',\n'
    printf '  "ellipse_confidence": %s,\n' "$(json_literal "${VIDENS_ELLIPSE_CONFIDENCE:-0.95}" VIDENS_ELLIPSE_CONFIDENCE)"
    printf '  "view": %s,\n' "$(json_literal "${VIDENS_VIEW:-null}" VIDENS_VIEW)"
    printf '  "coordinate_format": "dd",\n'
    printf '  "truth_overlay": %s\n' "$(json_literal "${VIDENS_TRUTH_OVERLAY:-false}" VIDENS_TRUTH_OVERLAY)"
    printf '}\n'
} > "$out_dir/videns.config.json"

echo "40-videns-config: feed=${VIDENS_FEED:-/picture/v0} upstream=${VIDENS_FEED_UPSTREAM:-unset} basemap=${VIDENS_BASEMAP:-none} basemaps=$basemaps_file ellipse=${VIDENS_ELLIPSE_CONFIDENCE:-0.95}"
