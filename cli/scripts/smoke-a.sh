#!/usr/bin/env bash
# Smoke run for icp, accounts, people and enrich on one tiny input. PAID: every step spends real
# looot credit, each one capped at 0.50 USD. Needs LOOOT_TOKEN and SMOKE_A_SPEND_OK=yes.
#
# Tiny input: 1 seed, 1 competitor, 1 account kept, 1 person per account, no phones.
# The steps run the same config with --only, so each later step replays the earlier calls by
# idempotency key (looot returns the stored run, no second charge) and adds one module.
#
#   SMOKE_A_SPEND_OK=yes LOOOT_TOKEN=... bash scripts/smoke-a.sh <domain> <seed> <competitor>
#
# Read each step's gtm-smoke-a/<module>/receipt.md afterwards. A miss can be charged when the
# provider bills a not found, the receipt shows the real amount per call.

set -euo pipefail

DOMAIN="${1:?usage: smoke-a.sh <your domain> <one seed customer domain> <one competitor domain>}"
SEED="${2:?usage: smoke-a.sh <your domain> <one seed customer domain> <one competitor domain>}"
COMPETITOR="${3:?usage: smoke-a.sh <your domain> <one seed customer domain> <one competitor domain>}"
CAP="0.50"

if [[ "${SMOKE_A_SPEND_OK:-}" != "yes" ]]; then
  echo "Refused. This script spends real looot credit (cap ${CAP} USD per step, 4 steps)."
  echo "Set SMOKE_A_SPEND_OK=yes once the spend is approved."
  exit 3
fi
if [[ -z "${LOOOT_TOKEN:-}" ]]; then
  echo "LOOOT_TOKEN is not set."
  exit 2
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="${ROOT}/dist/src/cli.js"
WORK="${SMOKE_A_DIR:-$(pwd)/gtm-smoke-a}"
mkdir -p "${WORK}"

(cd "${ROOT}" && npm run build >/dev/null)

CONFIG="${WORK}/config.yaml"
cat > "${CONFIG}" <<YAML
domain: ${DOMAIN}
brand: ${DOMAIN%%.*}
offer: smoke test for icp, accounts, people and enrich
icp:
  industries: [software]
  sizeBand: 11-1000
  geos: [United States]
  titles: [Head of Sales, VP Sales, Founder]
seeds: [${SEED}]
competitors: [${COMPETITOR}]
keywords: []
questions: []
depth: sample
limits:
  accounts: 1
  peoplePerAccount: 1
  signalAccounts: 0
phones: false
YAML

echo "== quote (no paid call)"
node "${CLI}" quote --config "${CONFIG}" --only enrich --cap "${CAP}"

for MOD in icp accounts people enrich; do
  echo
  echo "== ${MOD} (paid, cap ${CAP} USD)"
  node "${CLI}" run --config "${CONFIG}" --only "${MOD}" --cap "${CAP}" --out "${WORK}/${MOD}"
  echo "receipt ${WORK}/${MOD}/receipt.md"
done

echo
echo "Done. Compare the four receipts. The charged total is the sum of the run lines, replayed calls show replayed."
