# SP6 — 양식 병합 엔진 구현 계획

정본: `docs/superpowers/specs/2026-09-23-generic-platform-design.md` §4, `docs/superpowers/specs/2026-09-27-platform-revision-configurability-design.md` §4.5·§6 SP6. 기준 커밋 `a85cae77`(SP5c 완료), 개발 브랜치 `sp6/form-engine`.

## 최신 작업 재확인 (2026-10-05)

SP5c(사용자 정의 필드)의 모든 단계(F~Z)가 성공적으로 구현·검증되어 `origin/sp5c/custom-fields`에 푸시되었다. 전체 단위 테스트 930개 파일 12,352건, RLS 46개 파일 869건 전수 통과, 프로덕션 빌드 성공.
본 계획은 플랫폼 개정 로드맵의 다음 임무인 **SP6 양식 병합 엔진 (Form Template Merging Engine)**을 다룬다.

## 구현 단계 (Phases)

- [x] A: 데이터 카탈로그 확장 및 자리표시자 순수 파서 (Data Catalog & Pure Placeholder Scanner)
  - 카탈로그에 `custom.<key>` (SP5c), `status_code` / `status_label` (SP5b), 통일 주차 원자 토큰(`week_year`, `week_month`, `week_ordinal`, `week_end`, `week_days[]`) 확장
  - PPTX/XLSX 순수 자리표시자 스캐너 및 검증기
  - 토큰 단위 및 한국어 고정 서식 라벨 불변식 테스트
- [x] B: 영역 8개 초과 체브론 8칸 창 및 6근무일 렌더링 (Chevron Windowing & Multi-area Rendering)
  - `buildIssueAnalysisProcessSlides` 8칸 창 분할 (`areas.slice(8w, 8w+8)`) 및 제목 접미 `(영역 9–16 / 17)`
  - `FIXED_SLIDE_LIMIT` 제거
  - 주간보고 6일 근무 프로젝트의 `per_day` 6칸 렌더링 지원
  - 영역 0·1·8·9·17개 픽스처 회귀 테스트
- [ ] D: `0031_form_templates.sql` 마이그레이션 + 롤백
  - `form_templates` 테이블 생성 (버전 관리, 활성 유일 인덱스, RLS)
  - `form-templates` Storage 버킷 등록 및 RLS 정책
  - `FORM_MAPPING_IN_USE` 가드: `settings_ref_check` 및 `purge_custom_field`에서 활성 양식이 참조하는 사용자 정의 필드 삭제 차단
  - `copy_project_config`의 `form_templates` 메타 복사 연동
  - 전용 DB(`54522`) 대상 RLS 테스트
- [ ] S: `forms.*` 설정 레지스트리 및 관리 액션
  - [x] S1: `forms.weekly_report_pptx`, `forms.weekly_report_xlsx`, `forms.issue_analysis_pptx`, `forms.wbs_export_xlsx` 설정 정의 및 검증기(형태·카탈로그 경로·options). 편집 화면은 아직 없다
  - [x] S2: 양식 템플릿 업로드 준비(`prepareFormTemplateUpload`), 활성화(`activateFormTemplate`), 활성 해제(`deactivateFormTemplate` — 계획의 삭제. 버전 행을 지우는 액션은 정본에 없다)
  - [x] S2: 액션 관문 및 권한 검증 테스트
  - 활성화의 `engineVersion` 불일치는 재스캔하지 않고 재등록 오류로 막는다(OPC `scan` 미구현).
  - [x] S2 등록: `registerFormTemplate` — 다운로드, 매직바이트·OPC·매크로·zip 한도, `v<n>` 이동, `active=false` 행. 토큰 scan 은 하지 않는다(`tokenScan:false`, 활성화 거부). incoming GC 는 아니다.
- [ ] V: 양식 병합 엔진 및 라우트 연결
  - [x] V1: `capItems`·`lineCost`·`paginateGroups`·`paginateLines` 를 `engine/paginate.ts` 로 이동(정본 §4.3·§4.8). `templateFill.ts` 는 재수출만 한다. 렌더 삭제·라우트 전환은 render 이후
  - [x] V scan: `FormEngine.scan` — pptx 는 `slideN.xml` 의 `<a:p>` 만, xlsx 는 셀 문자열·리치텍스트만(§4.4.1·§4.7.2). 등록은 `ScanReport` 를 저장하고 문법·구조 오류면 incoming 을 지운다. `tokenScan:false` 행은 활성화 거부. 카탈로그 매핑 판정은 활성화에 둔다
  - [x] V render pptx: 값 치환(런 병합·빈 값·개행 문단), `{{#items}}`·`{{#rows}}`·`{{#slide}}`, OPC 배선. §4.4.6 넘침 연속 슬라이드는 아직 없다
  - [ ] XlsxFormEngine.render (`duplicateRow`, 셀 값)
  - [ ] pptx 넘침 연속 슬라이드 (§4.4.6 `max_lines_per_cell`·`max_rows_per_slide`)
  - [ ] 활성화의 `engineVersion` 불일치 재스캔(§4.7.3) — 지금은 재등록 오류다
  - [ ] `/api/report`, `/api/export` 라우트 연동 (활성 템플릿 우선, 미등록 시 기본 템플릿 폴백). 정본 §4.8 은 `/api/issue-analysis` 와 `GET /api/export?form=1` 도 같은 전환
  - [ ] `X-Form-Template: default | custom` 응답 헤더
  - [ ] 중립 기본 템플릿 자산 (`assets/default` 4개 + `assets/fixed/issue-analysis-process.pptx`). CI `scan` error 0·warning 0 은 OPC scan 이 있어야 한다
- [ ] Z: 합성 게이트 S8, 부정 테스트 6, 카탈로그 verified 승격 및 마감
  - 부정 테스트 6 (제조/영업 예시 단어 미노출 검증)
  - `scripts/e2e-synthetic.mjs`에 `S8` 합성 단계 구현 및 `PENDING_STEPS`에서 `S8` 제거
  - `src/lib/settings/catalog-meta.ts`의 `forms.*` 키를 `verified`로 승격
  - 전체 단위, RLS, 타입 검사, 린트, 프로덕션 빌드 통과 후 최종 마감

각 단계가 완료될 때마다 명시적으로 파일들을 스테이징하고 설명적인 한국어 커밋 메시지로 커밋한 뒤 원격에 즉시 푸시한다.
테스트 DB는 A 전용 API 54521 / DB 54522 (`d-flow-sp4`)만 사용하며, 사용자 운영 DB(54321/54322)는 일체 건드리지 않는다.
