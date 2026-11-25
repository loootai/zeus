#!/usr/bin/env bash
# PAID smoke test for modules seo, reviews, mentions, local and commerce.
# One tiny input per module, each run capped at $0.50. Needs LOOOT_TOKEN and --yes.
#
#   SMOKE_DOMAIN=yourdomain.com SMOKE_COMPETITOR=rival-a.com bash scripts/smoke-c.sh --yes
#   SMOKE_DOMAIN=... SMOKE_COMPETITOR=... REVIEWS_APP_ID=<app store id> COMMERCE_ASIN=<asin> bash scripts/smoke-c.sh --yes
#
# Without REVIEWS_APP_ID the reviews run takes its skip path (no call). Without COMMERCE_ASIN the
# commerce run takes its skip path (no call). The worst case for the whole script is about $0.30,
# far under the five $0.50 caps. Results land in runs/smoke-c-<time>/<module>/gtm.

set -euo pipefail

if [[ "${1:-}" != "--yes" ]]; then
  echo "This script makes paid looot calls (worst case about \$0.30). Run it again with --yes to go ahead."
  exit 2
fi
if [[ -z "${SMOKE_DOMAIN:-}" || -z "${SMOKE_COMPETITOR:-}" ]]; then
  echo "Set SMOKE_DOMAIN (your domain) and SMOKE_COMPETITOR (one competitor domain). Nothing ran."
  exit 2
fi
if [[ -z "${LOOOT_TOKEN:-}" ]]; then
  echo "LOOOT_TOKEN is not set. Nothing ran."
  exit 2
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$ROOT/dist/src/cli.js"
CAP="0.50"
OUT="$ROOT/runs/smoke-c-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"

(cd "$ROOT" && npm run build >/dev/null)

base() {
  cat <<YAML
domain: $SMOKE_DOMAIN
offer: one line about what you sell
icp:
  industries: [software]
  sizeBand: 11-200
  geos: [United States]
  titles: [Head of Sales]
seeds: []
depth: sample
phones: false
YAML
}

run_module() {
  local id="$1" cfg="$2"
  local dir="$OUT/$id"
  mkdir -p "$dir"
  printf '%s\n' "$cfg" > "$dir/config.yaml"
  echo
  echo "== $id (cap \$$CAP)"
  node "$CLI" quote --config "$dir/config.yaml" --cap "$CAP" --only "$id" || true
  set +e
  node "$CLI" run --config "$dir/config.yaml" --out "$dir/gtm" --cap "$CAP" --only "$id" 2>&1 | tee "$dir/run.log"
  set -e
  if grep -q "not built yet" "$dir/run.log"; then
    echo "!! $id is not registered yet, so nothing ran for it."
  fi
}

run_module seo "$(base)
competitors: [$SMOKE_COMPETITOR]
keywords: [sales pipeline software]
questions: [what is the best crm for a small sales team]
reviews: {mode: off}
local: {mode: off}
commerce: {mode: off}"

if [[ -n "${REVIEWS_APP_ID:-}" ]]; then
  REVIEWS="reviews: {mode: auto, appStoreIds: [\"$REVIEWS_APP_ID\"], mapsPlaces: []}"
else
  REVIEWS="reviews: {mode: auto, appStoreIds: [], mapsPlaces: []}"
fi
run_module reviews "$(base)
competitors: []
keywords: []
questions: []
$REVIEWS
local: {mode: off}
commerce: {mode: off}"

run_module mentions "$(base)
competitors: [$SMOKE_COMPETITOR]
keywords: []
questions: []
reviews: {mode: off}
local: {mode: off}
commerce: {mode: off}"

run_module local "$(base)
competitors: []
keywords: []
questions: []
reviews: {mode: off}
local: {mode: auto, queries: [\"crm consultant @ Amsterdam\"]}
commerce: {mode: off}"

if [[ -n "${COMMERCE_ASIN:-}" ]]; then
  COMMERCE="commerce: {mode: auto, asins: [\"$COMMERCE_ASIN\"]}"
else
  COMMERCE="commerce: {mode: auto, asins: []}"
fi
run_module commerce "$(base)
competitors: []
keywords: []
questions: []
reviews: {mode: off}
local: {mode: off}
$COMMERCE"

echo
echo "Done. Receipts per module: $OUT/<module>/gtm/receipt.md"
echo "Check per receipt: outcome per row, charged per row (misses can be charged), one-provider rows flagged."
