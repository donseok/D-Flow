#!/usr/bin/env bash
# 이미 켜진 레인 B 서버의 색 세트를 확인한다. lane-b-run.sh heavy 안에서 실행한다.
set -euo pipefail
label=${1:?라벨이 필요합니다}
routes=${2:?라우트 키가 필요합니다}
sizes=${3:-1440x900,390x844}
trap 'node scripts/ui-capture.mjs accent default' EXIT
for accent in default light dark; do
  node scripts/ui-capture.mjs accent "$accent"
  node scripts/ui-capture.mjs shoot --label "$label-$accent" --routes "$routes" --sizes "$sizes" --theme light --since b4283c0,UI-1,UI-2a,UI-2b,UI-3,C
done
