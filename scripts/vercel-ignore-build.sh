#!/bin/bash
# Vercel ignoreCommand — 낭비 빌드 차단(2026-08-21, Hobby 배포 한도 대응. 원본 리포에서
# 프로젝트 둘 구성 시절에 쓰던 로직을 이어받았다 — D-Flow 프로젝트는 첫 배포 SP 에서 생성한다).
#
# Vercel 프로젝트를 둘(운영·스테이징) 연결하면 push 한 번에 빌드가 두 개 도는 낭비가 생긴다.
# 실제로 쓰는 조합만 남긴다:
#   - 각 프로젝트의 Production 빌드(운영←main, 스테이징←staging): 항상 수행
#   - 스테이징 프로젝트의 Preview 빌드: 전부 스킵(용도 없음)
#   - 운영 프로젝트의 staging 브랜치 Preview: 스킵(스테이징 확인은 스테이징 프로젝트 몫)
#   - 운영 프로젝트의 피처 브랜치 Preview: 유지(G2 Preview 워크플로)
#
# exit 0 = 빌드 스킵, exit 1 = 빌드 진행 (Vercel ignoreCommand 계약).
# STAGING_PROJECT_PREFIX 는 Vercel 프로젝트 설정의 환경변수로 채운다(예: 스테이징 프로젝트명).
# 미설정이면 "__unset__" 로 접힌다 — VERCEL_PROJECT_PRODUCTION_URL 이 그 문자열로 시작할 리 없으므로
# case 가 안 걸려 스테이징 프로젝트의 피처 Preview 만 남는 안전한 퇴화다. 빌드가 필요한 경우를
# 잘못 스킵하지는 않는다.

if [ "$VERCEL_ENV" = "production" ]; then
  exit 1
fi

case "$VERCEL_PROJECT_PRODUCTION_URL" in
  "${STAGING_PROJECT_PREFIX:-__unset__}"*) exit 0 ;;
esac

if [ "$VERCEL_GIT_COMMIT_REF" = "staging" ]; then
  exit 0
fi

exit 1
