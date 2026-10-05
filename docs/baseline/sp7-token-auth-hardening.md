# SP7 착수 — 기존 토큰 인증 경계 보강 (2026-10-05)

기준: main `98ba6c60`. SP7 전용 작업트리의 자격증명/마이그레이션 작업과 별도로 기존 PAT 인증 공용 함수를 보강한다.

## 재현 및 변경

- `Buffer.from(hash, 'hex')`는 정상 SHA-256 해시 뒤의 잘못된 문자 또는 홀수 자리 접미사를 무시한다. 저장 해시 전체를 정확히 64자리 hex로 검사하고 이후 `timingSafeEqual`로 비교한다. null 등 손상 값도 인증 거절로 처리한다.
- `tokenUsable`은 `enabled === true`만 허용한다. 만료 시각과 판정 시각 모두 유한한 값이어야 한다. 기존 enabled → revoked → expires 검사 순서는 유지한다.
- 스코프 호환 목록을 `Map`으로 바꿔 `constructor`·`toString`·`__proto__`가 상속된 객체 속성으로 해석돼 예외를 내는 문제를 막는다. 기존 `work:report` → `work:claim` 호환은 유지한다.

추가 회귀 테스트에서 수정 전 4건 실패를 확인했다. 도메인 함수뿐 아니라 실제 PAT 리졸버에서 손상된 해시·비불리언 활성 상태가 401로 거절되는지도 확인한다.

## 다음 구현 범위

SP7 전체 완료가 아니다. 워크스페이스별 `integration_credentials`, 현재 사용자 권한과 토큰 범위의 교집합, 외부 API 인증 연결, `agent_projects` 제거, 가져오기 재시도 원장, 팀 ID 이행과 배포 계약은 후속 구현 범위다.

이 변경은 DB 스키마를 변경하지 않는다. 기존 HANDOFF.md 및 SP7 전용 작업트리의 미커밋 변경은 보존한다.

## 검증 결과

- 에이전트/토큰 관련 32파일 342건 통과, 전체 단위 980파일 12,784건 통과.
- `npm run lint` 오류 0, 기존 테스트 경고 4건. Git에서 제외된 `.superpowers` QA 산출물도 ESLint에서 제외해 로컬과 CI 검사 범위를 맞췄다.
- 기존 `.next/types`가 UI 통합 전 경로를 참조해 최초 타입 검사는 실패했다. 프로덕션 빌드로 생성 파일을 갱신한 후 `npm run typecheck` 통과.
- `npm run build` 통과. LLM 설정 조회 시간 초과는 기존 환경변수 기본값으로 폴백했다.
- `git diff --check` 통과. 사용자 DB 적용·원격 push는 수행하지 않았다.
