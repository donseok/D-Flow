#!/bin/sh
# kit-build.sh — D-Flow 정본(.claude/skills/dflow-*)에서 dflow-kit 배포 킷을 조립한다.
# 사용법: scripts/kit-build.sh <출력 폴더>   (예: ~/dflow-kit — 그 폴더가 git 리포면 커밋·push 는 사람이)
# 출력: <출력>/skills/dflow-* · skills/_shared · install.sh · .env.example · README.md · VERSION
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${1:-}"
[ -n "$OUT" ] || { echo "사용법: kit-build.sh <출력 폴더>" >&2; exit 2; }
mkdir -p "$OUT/skills"

SKILLS="dflow-work dflow-dev dflow-poll dflow-merge dflow-team dflow-export dflow-wbs-nlevel"
for s in $SKILLS; do
  [ -d "$ROOT/.claude/skills/$s" ] || { echo "정본 스킬 없음: $s" >&2; exit 2; }
  rm -rf "$OUT/skills/$s"
  cp -R "$ROOT/.claude/skills/$s" "$OUT/skills/$s"
  find "$OUT/skills/$s" -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null || true
  find "$OUT/skills/$s" -name '.pytest_cache' -type d -prune -exec rm -rf {} + 2>/dev/null || true
done

# 공용 node 헬퍼·문체 가이드 — dflow-export·dflow-wbs-nlevel 의 .mjs 스크립트가 ../../_shared/node 를 import 한다(2026-10-19).
rm -rf "$OUT/skills/_shared" && mkdir -p "$OUT/skills/_shared"
for d in node style; do
  [ -d "$ROOT/.claude/skills/_shared/$d" ] || { echo "정본 공용 폴더 없음: _shared/$d" >&2; exit 2; }
  cp -R "$ROOT/.claude/skills/_shared/$d" "$OUT/skills/_shared/$d"
done

cp "$ROOT/kit/install.sh" "$OUT/install.sh"; chmod +x "$OUT/install.sh"
cp "$ROOT/kit/.env.example" "$OUT/.env.example"
cp "$ROOT/kit/.gitattributes" "$OUT/.gitattributes"
cp "$ROOT/kit/worker-allow.json" "$OUT/worker-allow.json"
cp "$ROOT/kit/README.md" "$OUT/README.md"
mkdir -p "$OUT/hooks" && cp "$ROOT/kit/hooks/heartbeat.sh" "$OUT/hooks/heartbeat.sh" && chmod +x "$OUT/hooks/heartbeat.sh"
printf 'source: d-flow %s\nbuilt: %s\nskills: %s\n' \
  "$(git -C "$ROOT" rev-parse --short HEAD)" "$(date +%Y-%m-%d)" "$SKILLS" > "$OUT/VERSION"

# 킷 밖을 가리키는 경로(리포 문서·개발자 PC 의 절대경로)가 남아 있으면 빌드 실패 — 다른 PC 에서 깨진다.
if grep -rn 'docs/superpowers\|docs/agent/claude-skill\|~/project/\|/Users/\|/home/' "$OUT/skills" "$OUT/hooks" --include='*.md' --include='*.sh' \
   | grep -v '킷에는 미동봉\|D-Flow 리포 docs/superpowers\|정본은 `D-Flow/.claude/skills/` 뿐이다' ; then
  echo "위: 킷 밖 참조가 남아 있다 — SKILL.md 를 고치고 다시 빌드" >&2; exit 1
fi

echo "빌드 완료: $OUT"; cat "$OUT/VERSION"
