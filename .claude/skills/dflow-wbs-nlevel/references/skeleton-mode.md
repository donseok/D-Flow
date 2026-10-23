# 골격 모드 입력·표준 구성 (dflow-wbs-nlevel 에서 옮김)

> SKILL.md `## 골격 정의 파일 (skeleton.yaml)` 절 (methodology 3종·wsf 골격 표준 구성 포함)에서 분리.

## 골격 정의 파일 (`skeleton.yaml`) — 골격 모드의 입력 정본

```yaml
project: Acme
start_date: 2026-09-01
methodology: wsf            # wsf(기본) | waterfall | scrum — 단계 프리셋과 PL 생성 규칙을 결정
phases:                     # 생략 시 methodology 프리셋. 명시하면 그것이 이김
  - { key: PH-03, name: 구축, build: true }   # build: true = 시스템 트리가 붙는 Phase
levels: default             # 'default' = 스펙 정본 7층. 커스텀이면 배열. scrum 은 Phase 층 제거판
systems:
  - { key: SYS-OP, name: 주문처리, module: acme-op, pl: PL-A }
interfaces:                 # 선택 — 연동하는 상대 시스템. 선언한 것만 I/F WP 를 만든다(없으면 만들지 않는다)
  - { key: PG, name: 외부 결제 시스템 }   # key = ID 조각(영문 약어) — 연동 테스트 WP 가 WP-IT-{key}
```

### methodology 3종 — 단계 프리셋 + 생성 규칙

| 값 | phases 프리셋 | levels | PL 모드 규칙 |
|---|---|---|---|
| `wsf` (기본) | 분석·설계·구축(build)·통합테스트·적용 | 정본 7층 | 모듈 Water 꼬리 + Scrum + 모듈 Fall (현행) |
| `waterfall` | 분석·설계·개발(build)·단위테스트·통합테스트·이행 | 정본 7층 | 애자일 반복 없음 — 프로그램 Task 일렬, 계약 Task 는 설계 단계 소속, `credit:doc` 게이트 중심 |
| `scrum` | **없음** — Phase 층 자체를 levels 에서 제거, System 이 최상위 | Phase 제거 6층 | 선행·후행 공정 없음 — 백로그형. 통테는 횡단 시스템으로 두거나 생략 |

- **파일이 있으면 무질문 생성.** 파일이 없으면 대화로 수집한다 — 질문은 다섯뿐:
  ① 프로젝트명 ② **방법론(wsf/waterfall/scrum — 기본 wsf)** ③ 단계(방법론 프리셋을 제시하고 수정 여부;
  scrum 이면 생략) ④ 시스템 목록(이름을 받아 키·module 을 제안 → 사용자 확정)
  ⑤ 연동할 상대 시스템(**선택** — `interfaces`. 이름을 받아 key 를 제안 → 사용자 확정. "없음"이면 키를 두지 않는다).
  답으로 **skeleton.yaml 을 생성하고 멈춘다** — "파일 검토 후 재실행" 안내.
  즉석 골격 생성 금지: 시스템 키는 external_ref 라 불변이며, 리뷰 없이 확정하지 않는다.
- 시스템 목록을 스킬이 지어내지 않는다 — 입력(파일 또는 답변)에 없는 시스템은 만들지 않는다.
  인터페이스도 같다 — `interfaces` 에 없는 상대 시스템의 I/F WP·Task 를 만들지 않는다.
- 필수 누락(project 없음, systems 0개)은 중단. 선택 누락(pl 미정)은 기본값 + 리포트.
  `interfaces` 가 없으면 I/F WP 없이 생성한다(정상 — 리포트에 "인터페이스 선언 없음" 한 줄).

### wsf 골격 구성 (예시: `.claude/skills/dflow-wbs-nlevel/references/skeleton-sample.md` — 인터페이스 선언 없는 골격)

구축(build Phase)은 System 자리만 두고, 나머지 4 Phase 는 아래 WP 구성을 템플릿으로 생성한다
(시스템 횡단이라 System·Subsystem 층 건너뜀 — 얕은 비대칭 트리):

| Phase | WP 구성 |
|---|---|
| 분석 | 현행(AS-IS) 분석 · **요건 정의(시스템별 Task ×N)** · I/F 요건 정의(**인터페이스를 선언했을 때만** — 인터페이스별 Task) + 보고회 [M] |
| 설계 | 아키텍처 설계 · 데이터 설계(ERD·마스터·코드) · **시스템별 상세설계(ACT ×N, 깊은 시스템은 Subsystem 별 Task)** · I/F 상세설계(**인터페이스를 선언했을 때만** — 인터페이스별 Task) + 보고회 [M] |
| 통합테스트 | 계획·환경·데이터 · 시스템 내 통합 · **선언된 인터페이스마다 연동 테스트(credit:if)** · 결함 관리·회귀 + 완료 [M] |
| 적용 | 데이터 이행 · 사용자 교육·매뉴얼 · 컷오버·오픈 + 가동 [M] · 안정화 |

- 산출물 Task 는 `credit:doc`, 연동 Task 는 `credit:if`. 시스템별 항목은 skeleton.yaml 의 systems 로,
  인터페이스별 항목은 `interfaces` 로 전개한다 — 연동 테스트는 인터페이스마다 WP 하나(`WP-IT-{key}`)에
  `credit:if` Task 하나.
- 보고회·완료 [M] 은 그 Phase 마지막 WP 의 꼬리에 둔다. 설계 Phase 에 I/F 상세설계 WP 가 없으면
  마지막 WP(시스템별 상세설계)가 ACT 로 나뉘어 WP 직속 줄을 쓸 수 없으니, 마일스톤만 담는 `설계 검토` WP 를 둔다.
- 시스템별 요건정의·상세설계 Task 는 골격 파일 소속이다 — **attach 는 단일 노드로 확정**(b안,
  2026-08-22): 모듈 통테 준비·시나리오도 "모듈 검증까지가 구축"으로 build Phase 소속이며, 선행·후행
  Phase 는 골격 전유. 담당 PL 확정 시 @담당으로 배정해 소유를 넘긴다.
