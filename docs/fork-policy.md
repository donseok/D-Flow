# 포크 정책

D-Flow 는 `wbs-web`(D'Flow, D-CUBE 운영)의 **한 시점 사본**이며 이후 독립 진화한다. 원본 리포는 이 작업으로
바뀌지 않는다. 정본은 `docs/superpowers/specs/2026-09-23-generic-platform-design.md` 6.6 절 — 이 문서는
그 절을 이 리포에 맞게 옮기고 컷오프 좌표를 실측값으로 고정한다.

## 컷오프 커밋 고정

- 컷오프: `wbs-web@77cf6785e088e65a35857ae69b4b5b040fa13bf3`(wbs-web **staging**). 상위 스펙 6.6 은
  "포크 시점의 `origin/main` SHA" 라 적었으나 실제 컷오프는 이 staging 커밋이다 — 2026-09-23 실측으로
  이 커밋은 wbs-web `origin/main` 의 조상이고, 그 뒤 `supabase/migrations` 차이는 0건이다(즉 운영 스키마 =
  컷오프 코드의 스키마).
- 로컬 보관 이력의 첫 커밋(`c40de1a`) 트레일러
  `Fork-of: wbs-web@77cf6785e088e65a35857ae69b4b5b040fa13bf3` 에 고정돼 있다.
- **원본 이력(루트 `c40de1a` 와 SP0 작업 브랜치 `sp0/fork-bootstrap`)은 로컬 보관 브랜치(`main-fork-history`)에만
  둔다 — push 하지 않는다.** `c40de1a` 부터의 작업 이력에는 원본 트리가 그대로 들어 있어서다.
  pre-push 훅의 G5 가 `c40de1a` 를 조상으로 둔 ref(브랜치·태그)의 push 를 `SKIP_GUARD` 와 무관하게 막는다.
  원격(`origin`)의 루트는 SP0 결과 트리를 한 커밋으로 담은 깨끗한 squash 커밋이며, 같은 트레일러
  `Fork-of: wbs-web@77cf6785e088e65a35857ae69b4b5b040fa13bf3` 를 단다. 루트 squash 는 `git checkout --orphan`
  (index 보존 — `git switch --orphan` 은 트리를 비운다)으로 만든다.
  2026-09-24 기록: SP0 마무리 전에 `origin/main` 에 `f790e82`(c40de1a 포함)가 한 번 올라간 사고가 있어, 사용자 결정으로
  깨끗한 루트를 `SKIP_GUARD=1 git push --force-with-lease=refs/heads/main:f790e82… -u origin main` 으로 **강제 교체**했다
  (SKIP_GUARD 는 squash 루트가 마이그레이션과 코드를 함께 담아 G1 에 걸리기 때문). 교체된 옛 커밋은 원격에서 도달
  불가하지만 GitHub 가 객체를 한동안 보관할 수 있다 — 완전한 삭제가 필요하면 리포 삭제·재생성이 확실한 방법이다.
  이 강제 push 는 이 한 번뿐이며 이후 `main` 에 대한 force push 는 다시 금지다. 사고 원인: 리뷰 에이전트가
  스크래치패드 클론에서 훅을 시뮬레이션하다 `cd` 가 실패한 뒤(병렬 에이전트가 같은 경로를 지움) 나머지 명령이
  실제 체크아웃에서 실행돼 `SKIP_GUARD=1 git push -u origin main` 이 옛 `main` 을 올렸다 — G5 는 이 재발을 막는다.
- 이후 원본의 커밋을 자동으로 따라가지 않는다. 원본을 가리킬 일이 있으면 `git remote add upstream <wbs-web>`
  으로 두되, **`merge`·`rebase` 는 금지**다(아래 cherry-pick 절차만 쓴다).
- 근거: 원본은 최근 30일 468커밋(전 브랜치)·마이그레이션 14커밋으로 계속 움직이고, SP1 이후 스키마
  (`memberships`·`project_roles` 폐기)가 갈라져 애초에 머지가 성립하지 않는다.

## 금지 ref

두 ref 모두 이 리포의 어떤 명령·스크립트도 가리켜선 안 된다.

- `rglfgrwwwwdqejohdnty` — wbs-web **운영**, D-CUBE 실데이터. 접속하면 운영 데이터를 읽거나(정보 유출)
  잘못하면 쓰는(사고) 사고로 직결된다.
- `abtyahghvvkcriawffty` — wbs-web **스테이징**. 원본 팀의 검증 환경이며, 이 리포가 건드릴 이유가 없다.

`scripts/lib/targets.mjs` 의 `FORBIDDEN_REFS` 가 두 ref 를 기계적으로 막는다 — 어떤 경로로 해석된 ref·URL·DSN
이든 이 문자열을 포함하면 throw 한다. 유일한 예외는 `scripts/baseline-dump.mjs`(SP0 기준선 확보, **읽기 전용**
1회 접속)이며, 이 스크립트만 예외 플래그를 넘긴다. `docs/superpowers/**` 의 옛 문서에 박힌 ref·절차는 원본
리포의 기록이므로 남겨 두되 따르지 않는다.

## 보안 픽스 cherry-pick 절차

**대상은 보안 픽스로 한정한다** — 인증·RLS·시크릿 처리·의존성 취약점·외부 API 인증 우회에 해당하는 원본
커밋만. 기능·UI·성능 커밋은 대상이 아니다(필요하면 이 리포에서 다시 구현한다).

1. `git remote add upstream <wbs-web 리포 주소>` (아직 없다면). **`merge`·`rebase` 는 쓰지 않는다.**
2. `git cherry-pick -x <sha>` 로 해당 커밋만 가져온다(`-x` 가 원본 sha 를 커밋 메시지에 남긴다).
3. 커밋 트레일러에 `Upstream-fix: wbs-web@<sha>` 를 추가한다.
4. 픽스에 마이그레이션이 딸려 있으면 이 리포의 번호 체계로 **재번호**한다 — 원본 번호는 트레일러에만
   남기고 파일명은 이 리포의 다음 빈 번호를 쓴다. G1(마이그레이션·코드 분리)·G4(리허설 트레일러)는
   cherry-pick 커밋에도 그대로 적용된다.
5. 역방향(이 리포 → 원본)도 같은 기준의 보안 픽스만 오간다. 원본에 적용할 때는 원본 `CLAUDE.md` 의 규칙
   (`git add -A` 금지·스테이징 리허설)을 따른다.

## 공유 패키지 없음

- 두 리포가 같이 쓰는 npm 패키지·git submodule·모노리포를 만들지 않는다(YAGNI). 순수 함수
  (`src/lib/domain/*`)가 겹치더라도 각 리포에 복사본으로 둔다.
- 이유: 공유 패키지를 만들면 두 리포의 릴리스 타이밍이 묶이고, 원본의 D-CUBE 특화(팀 코드 타입
  `TeamCode` 등)와 이 리포의 범용 타입이 한 패키지 안에서 충돌한다.
