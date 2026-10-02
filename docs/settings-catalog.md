# D-Flow 설정 카탈로그

## 0. 읽는 법

설정 항목이 완료되려면 정의·권한 있는 편집·모든 소비처 연결·격리·기존 데이터와 동시성 및 오류 검증이 모두 필요하다. `planned`는 레지스트리 미등록, `stored`는 검증·저장·재조회 가능, `wired`는 소비처 연결, `verified`는 격리와 회귀 검증 완료를 뜻한다. 운영 설정은 이 상태 어휘 밖에 둔다.

워크스페이스 값과 프로젝트 값은 별도 스코프이며 런타임 상속은 없다. 프로젝트 생성 때만 선택한 원본 설정을 복사한다. 개인 선호는 업무 계산이나 권한 판정에 들어가지 않는다. 설정 쓰기는 revision과 명령 ID를 사용하며, 충돌은 `CONFIG_CONFLICT`, 형식 오류는 `CONFIG_INVALID`, 알 수 없는 키는 `CONFIG_UNKNOWN_KEY`, 앞선 스키마는 `CONFIG_SCHEMA_AHEAD`로 응답한다. 근거: `src/app/actions/settings.ts`의 `updateProjectSettings`·`updateWorkspaceSettings`, `src/lib/settings/registry.ts`의 `settingDef`.

## 1. 워크스페이스 설정

<!-- catalog:auto:1:start -->
| 설정 키 | 스코프 | 편집 주체 | 편집 UI/API | 저장소 | 기본값(출처) | 검증기 | 소비처 | 적용 시점 | 기존 데이터 영향 | 테스트 | 현재 상태 | 담당 SP |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `modules.allowed`<br>허용 모듈 | 워크스페이스 | 플랫폼 관리자 | `ModuleAllowEditor` / `updateWorkspaceSettings` | 설정 JSON 문서 | `[]` (제품 기본값) | parse · validateWorkspaceConfig | `src/lib/modules/effective.ts`, `src/lib/settings/validateConfig.ts` | immediate | 파생 보기 재계산 | `tests/modules/effective.test.ts`, `tests/settings/config-lifecycle.test.ts` | verified | SP3a |
| `ai.enabled`<br>AI 기능 | 워크스페이스 | 워크스페이스 관리자 | `boolean` / `updateWorkspaceSettings` | 설정 JSON 문서 | `true` (제품 기본값) | parse · validateWorkspaceConfig | `src/lib/modules/aiAvailable.ts` | immediate | 없음 | `tests/modules/effective.test.ts` | verified | SP3a |
| `invites.allowed_domains`<br>초대 허용 도메인 | 워크스페이스 | 워크스페이스 관리자 | `text_list` / `updateWorkspaceSettings` | 설정 JSON 문서 | `[]` (배포 `INVITE_ALLOWED_DOMAINS` → 제품 기본값) | parse · validateWorkspaceConfig | `src/lib/data/inviteDomains.ts` | immediate | 없음 | `tests/settings/workspace-config.test.ts`, `tests/domain/invites.test.ts` | verified | SP3a |
| `branding.product_name`<br>제품 이름 | 워크스페이스 | 워크스페이스 관리자 | `text` / `updateWorkspaceSettings` | 설정 JSON 문서 | `"D-Flow"` (배포 `NEXT_PUBLIC_BRAND_NAME` → 제품 기본값) | parse · validateWorkspaceConfig | `src/lib/settings/displayBranding.ts`, `src/app/(app)/projects/page.tsx` | immediate | 없음 | `tests/settings/display-branding.test.ts` | stored | SP3a |
| `branding.logo`<br>로고 | 워크스페이스 | 워크스페이스 관리자 | `LogoEditor` / `updateWorkspaceSettings` | 설정 JSON 문서 | `{"full":null,"full_dark":null,"mark":null}` (제품 기본값) | parse · validateWorkspaceConfig | `src/app/api/brand/[workspaceId]/[slot]/route.ts`, `src/app/(app)/projects/page.tsx` | immediate | 없음 | `tests/settings/logo-upload.test.ts`, `tests/api/brand-route.test.ts` | stored | SP3a |
| `branding.accent`<br>강조색 | 워크스페이스 | 워크스페이스 관리자 | `AccentEditor` / `updateWorkspaceSettings` | 설정 JSON 문서 | `null` (제품 기본값) | parse · validateWorkspaceConfig | `src/components/settings/AccentEditor.tsx` | immediate | 없음 | `tests/settings/accent.test.ts` | stored | SP3a |
| `branding.mail_from_name`<br>메일 발신 표시명 | 워크스페이스 | 워크스페이스 관리자 | `text` / `updateWorkspaceSettings` | 설정 JSON 문서 | `null` (배포 `MAIL_FROM_NAME` → 제품 기본값) | parse · validateWorkspaceConfig | `src/lib/mail/fromName.ts`, `src/lib/settings/displayBranding.ts` | immediate | 없음 | `tests/settings/display-branding.test.ts` | verified | SP3a |
| `navigation.menu`<br>메뉴 순서·이름 | 워크스페이스 | 워크스페이스 관리자 | `MenuOrderEditor` / `updateWorkspaceSettings` | 설정 JSON 문서 | `{"order":[],"labels":{}}` (제품 기본값) | parse · validateWorkspaceConfig | `src/components/settings/MenuOrderEditor.tsx` | immediate | 없음 | `tests/settings/registry.test.ts` | stored | SP3a |
| `calendar.timezone`<br>시간대 | 워크스페이스 | 워크스페이스 관리자 | `TimezoneSelect` / `updateWorkspaceSettings` | 설정 JSON 문서 | `"UTC"` (제품 기본값) | parse · validateWorkspaceConfig | `src/lib/calendar/load.ts`, `src/lib/settings/workspaceConfig.ts`, `src/app/(app)/p/[projectId]/weekly/page.tsx`, `src/lib/data/usage.ts` | immediate | 파생 보기 재계산 | `tests/domain/calendar.test.ts`, `tests/rls/calendar-parity.test.ts`, `tests/calendar/load.test.ts`, `tests/components/time-display-zone.test.tsx`, `tests/scripts/bootstrap-timezone.test.ts` | verified | SP5 A |
| `calendar.working_days`<br>근무 요일 | 워크스페이스 | 워크스페이스 관리자 | `WorkingDaysEditor` / `updateWorkspaceSettings` | 설정 JSON 문서 | `[1,2,3,4,5]` (제품 기본값) | parse · validateWorkspaceConfig | `src/lib/domain/calendar.ts`, `src/lib/calendar/load.ts`, `src/lib/domain/progress.ts` | immediate | 파생 보기 재계산 | `tests/domain/calendar.test.ts`, `tests/rls/calendar-parity.test.ts`, `tests/components/calendar-first-column.test.tsx`, `tests/settings/calendar-keys.test.ts` | verified | SP5 A |
| `calendar.week_start`<br>주 시작 요일 | 워크스페이스 | 워크스페이스 관리자 | `select` / `updateWorkspaceSettings` | 설정 JSON 문서 | `"sunday"` (제품 기본값) | parse · validateWorkspaceConfig | `src/lib/report/week.ts`, `src/app/actions/weekly.ts`, `src/lib/ai/tools/weekly.ts`, `src/lib/settings/defs/project.ts` | immediate | 파생 보기 재계산 | `tests/rls/week-start-transition.test.ts`, `tests/report/week.test.ts`, `tests/ai/bot-week-rules.test.ts`, `tests/actions/settings-week-start.test.ts` | verified | SP5 A |
| `portal.widgets`<br>{ id: PortalWidgetId; enabled: boolean }[] | 워크스페이스 | — | — | 미등록 | — | — | — | — | — | — | planned | SP3b |
| `security.local_drafts`<br>{ allowed: boolean; retention_days: number } | 워크스페이스 | — | — | 미등록 | — | — | — | — | — | — | planned | SPU1 |
| `minutes.root_folders`<br>{ mode: 'teams' } \| { mode: 'custom'; names: string[] } | 워크스페이스 | — | — | 미등록 | — | — | — | — | — | — | planned | SP5 B2 |
| `minutes.attachments`<br>첨부 정책 객체 | 워크스페이스 | — | — | 미등록 | — | — | — | — | — | — | planned | SP5 B3 |
| `notify.policy`<br>{ [type]: { enabled: boolean } } | 워크스페이스 | — | — | 미등록 | — | — | — | — | — | — | planned | SP8 |
<!-- catalog:auto:1:end -->

## 2. 프로젝트 설정

<!-- catalog:auto:2:start -->
| 설정 키 | 스코프 | 편집 주체 | 편집 UI/API | 저장소 | 기본값(출처) | 검증기 | 소비처 | 적용 시점 | 기존 데이터 영향 | 테스트 | 현재 상태 | 담당 SP |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `core.level_labels`<br>WBS 단계 이름 | 프로젝트 | 프로젝트 관리자 | `LevelSettingsManager` / `updateProjectSettings` | 설정 JSON 문서 | 생성 시 필수 | parse · validateProjectConfig | `src/app/api/v1/wbs/structure/route.ts`, `src/lib/agent/wbsImport.ts` | immediate | 없음 | `tests/settings/project-config.test.ts`, `tests/settings/create-project.test.ts` | verified | SP3a |
| `core.extra_axis_label`<br>추가 축 이름 | 프로젝트 | 프로젝트 관리자 | `text` / `updateProjectSettings` | 설정 JSON 문서 | `null` (제품 기본값) | parse · validateProjectConfig | `src/app/actions/projectTeams.ts`, `src/app/api/import/execute/route.ts` | immediate | 없음 | `tests/settings/registry.test.ts`, `tests/actions/project-teams-actions.test.ts` | stored | SP3a |
| `core.milestone_keywords`<br>마일스톤 키워드 | 프로젝트 | 프로젝트 관리자 | `text_list` / `updateProjectSettings` | 설정 JSON 문서 | `["마일스톤","milestone","킥오프","kick-off","오픈","완료보고"]` (제품 기본값) | parse · validateProjectConfig | `src/app/(app)/p/[projectId]/dashboard/page.tsx`, `src/lib/ai/tools/dashboard.ts` | immediate | 파생 보기 재계산 | `tests/settings/default-keywords.test.ts`, `tests/settings/project-config.test.ts` | verified | SP3a |
| `wbs.excel_profile`<br>저장된 엑셀 양식 | 프로젝트 | 프로젝트 관리자 | `ClearExcelProfileButton` / `updateProjectSettings` | 설정 JSON 문서 | `null` (제품 기본값) | parse · validateProjectConfig | `src/app/api/import/inspect/route.ts`, `src/app/api/export/route.ts`, `src/app/api/import/execute/route.ts`, `src/app/(app)/p/[projectId]/settings/page.tsx` | immediate | 없음 | `tests/excel/standard-profile.test.ts`, `tests/api/export-route.test.ts` | verified | SP4 |
| `modules.enabled`<br>사용 모듈 | 프로젝트 | 프로젝트 관리자 | `ModuleToggleEditor` / `updateProjectSettings` | 설정 JSON 문서 | `["kanban","meetings","weekly","issues","announcements","attendance","agents","wiki","chatbot"]` (제품 기본값) | parse · validateProjectConfig | `src/lib/modules/effective.ts`, `src/app/(app)/p/[projectId]/settings/page.tsx` | immediate | 파생 보기 재계산 | `tests/modules/effective.test.ts`, `tests/settings/config-lifecycle.test.ts` | verified | SP3a |
| `workflow.stage_credits`<br>단계 실적 크레딧 | 프로젝트 | 프로젝트 관리자 | `StageCreditSlider` / `updateProjectSettings` | 설정 JSON 문서 | `{"default":{"as":0,"ip":30,"rw":50,"im":80,"xx":100}}` (제품 기본값) | parse · validateProjectConfig · SQL: apply_workflow_event | `src/components/settings/StageCreditSlider.tsx`, `supabase/migrations/0012_settings.sql` | immediate | 이후 작업부터 | `tests/settings/registry.test.ts` | wired | SP3a |
| `calendar.timezone`<br>시간대 | 프로젝트 | 프로젝트 관리자 | `TimezoneSelect` / `updateProjectSettings` | 설정 JSON 문서 | `"UTC"` (제품 기본값) | parse · validateProjectConfig | `src/lib/calendar/load.ts`, `src/lib/settings/workspaceConfig.ts`, `src/app/(app)/p/[projectId]/weekly/page.tsx`, `src/lib/data/usage.ts` | immediate | 파생 보기 재계산 | `tests/domain/calendar.test.ts`, `tests/rls/calendar-parity.test.ts`, `tests/calendar/load.test.ts`, `tests/components/time-display-zone.test.tsx`, `tests/scripts/bootstrap-timezone.test.ts` | verified | SP5 A |
| `calendar.working_days`<br>근무 요일 | 프로젝트 | 프로젝트 관리자 | `WorkingDaysEditor` / `updateProjectSettings` | 설정 JSON 문서 | `[1,2,3,4,5]` (제품 기본값) | parse · validateProjectConfig · SQL: is_workday | `src/lib/domain/calendar.ts`, `src/lib/calendar/load.ts`, `src/lib/domain/progress.ts` | immediate | 파생 보기 재계산 | `tests/domain/calendar.test.ts`, `tests/rls/calendar-parity.test.ts`, `tests/components/calendar-first-column.test.tsx`, `tests/settings/calendar-keys.test.ts` | verified | SP5 A |
| `calendar.week_start`<br>주 시작 요일 | 프로젝트 | 프로젝트 관리자 | `WeekStartEditor` / `updateProjectSettings` | 설정 JSON 문서 | `[{"day":"sunday","from":null}]` (제품 기본값) | parse · validateProjectConfig · SQL: week_key_of, weekly_reports_week_key_guard, settings_ref_check | `src/lib/report/week.ts`, `src/app/actions/weekly.ts`, `src/lib/ai/tools/weekly.ts`, `src/lib/settings/defs/project.ts` | immediate | 이후 작업부터, 파생 보기 재계산 | `tests/rls/week-start-transition.test.ts`, `tests/report/week.test.ts`, `tests/ai/bot-week-rules.test.ts`, `tests/actions/settings-week-start.test.ts` | verified | SP5 A |
| `workflow.issue_statuses`<br>{ code; label; color; category; sort; active }[] | 프로젝트 | — | — | 미등록 | — | — | — | — | — | — | planned | SP5b |
| `workflow.wbs_stage_labels`<br>Partial<Record<단계, string>> | 프로젝트 | — | — | 미등록 | — | — | — | — | — | — | planned | SP5b |
| `workflow.approval_steps`<br>{ code; label; approver }[] 1~3 | 프로젝트 | — | — | 미등록 | — | — | — | — | — | — | planned | SP5b |
| `workflow.approval_distinct_approvers`<br>boolean | 프로젝트 | — | — | 미등록 | — | — | — | — | — | — | planned | SP5b |
| `workflow.predecessor_gate`<br>'reached' \| 'final' | 프로젝트 | — | — | 미등록 | — | — | — | — | — | — | planned | SP5b |
| `workflow.credit_policy`<br>{ step: 1 \| 5; min_gap: 1..10 } | 프로젝트 | — | — | 미등록 | — | — | — | — | — | — | planned | SP5b |
| `issues.id_policy`<br>{ prefix; pattern; counter_scope; reset } | 프로젝트 | — | — | 미등록 | — | — | — | — | — | — | planned | SP5 B1 |
| `issues.analysis`<br>'optional' \| 'required' | 프로젝트 | — | — | 미등록 | — | — | — | — | — | — | planned | SP5 B1 |
| `issues.severities`<br>어휘 목록 | 프로젝트 | — | — | 미등록 | — | — | — | — | — | — | planned | SP5 B4 |
| `issues.cause_categories`<br>어휘 목록 | 프로젝트 | — | — | 미등록 | — | — | — | — | — | — | planned | SP5 B4 |
| `issues.sources`<br>어휘 목록 | 프로젝트 | — | — | 미등록 | — | — | — | — | — | — | planned | SP5 B4 |
| `attendance.types`<br>어휘 목록 | 프로젝트 | — | — | 미등록 | — | — | — | — | — | — | planned | SP5 B4 |
| `meetings.categories`<br>어휘 목록 | 프로젝트 | — | — | 미등록 | — | — | — | — | — | — | planned | SP5 B4 |
| `fields.wbs_item`<br>FieldDef[] | 프로젝트 | — | — | 미등록 | — | — | — | — | — | — | planned | SP5c |
| `fields.issue`<br>FieldDef[] | 프로젝트 | — | — | 미등록 | — | — | — | — | — | — | planned | SP5c |
| `fields.weekly_row`<br>FieldDef[] | 프로젝트 | — | — | 미등록 | — | — | — | — | — | — | planned | SP5c |
| `forms.weekly_report_pptx`<br>{ template_id; mapping; options } | 프로젝트 | — | — | 미등록 | — | — | — | — | — | — | planned | SP6 |
| `forms.weekly_report_xlsx`<br>{ template_id; mapping; options } | 프로젝트 | — | — | 미등록 | — | — | — | — | — | — | planned | SP6 |
| `forms.issue_analysis_pptx`<br>{ template_id; mapping; options } | 프로젝트 | — | — | 미등록 | — | — | — | — | — | — | planned | SP6 |
| `forms.wbs_export_xlsx`<br>{ template_id; mapping; options } | 프로젝트 | — | — | 미등록 | — | — | — | — | — | — | planned | SP6 |
| `minutes.auto_file_by_path`<br>boolean | 프로젝트 | — | — | 미등록 | — | — | — | — | — | — | planned | SP7 |
| `minutes.attachments`<br>첨부 정책 객체(seedFrom) | 프로젝트 | — | — | 미등록 | — | — | — | — | — | — | planned | SP5 B3 |
| `views.default`<br>{ wbs: 'sheet'\|'timeline'\|'board'; density } | 프로젝트 | — | — | 미등록 | — | — | — | — | — | — | planned | SP3b |
<!-- catalog:auto:2:end -->

## 3. 목록형 행 데이터

팀·프로젝트 담당 영역·공휴일·초대는 각각의 행과 권한 규칙을 따른다. 설정 레지스트리의 평면 키가 아니다. 담당 영역은 `project_areas`와 `area_teams`, 팀은 `teams`, 날짜 예외는 `holidays`에 둔다. 근거: `src/lib/settings/projectConfig.ts`의 `getProjectConfig`, `src/components/settings/ScheduleManager.tsx`의 `ScheduleManager`.

## 4. 운영 설정

비밀 설정의 값은 이 문서에 기록하지 않는다. 읽은 알림·사용 이벤트 보존 90일과 회의록 첨부 운영 상한은 현재 코드 상수다. 이 값은 배포 환경 변수로 읽지 않는다. 근거: `src/app/api/cron/inbox-retention/route.ts`의 `GET`, `src/lib/domain/usage.ts`의 보존 상수, `src/lib/domain/minutes.ts`의 첨부 상수.

<!-- catalog:auto:4:start -->
| 설정 키 | 스코프 | 편집 주체 | 편집 UI/API | 저장소 | 기본값(출처) | 검증기 | 소비처 | 적용 시점 | 기존 데이터 영향 | 테스트 | 현재 상태 | 담당 SP |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `SMTP_HOST` | 플랫폼 | 운영자 | 배포 환경 | env | 운영자 설정 | 배포 점검 | `src/lib/mail/transport.ts` | restart | — | — | 운영 설정 | SP3a |
| `SMTP_PORT` | 플랫폼 | 운영자 | 배포 환경 | env | 운영자 설정 | 배포 점검 | `src/lib/mail/transport.ts` | restart | — | — | 운영 설정 | SP3a |
| `SMTP_SECURE` | 플랫폼 | 운영자 | 배포 환경 | env | 운영자 설정 | 배포 점검 | `src/lib/mail/transport.ts` | restart | — | — | 운영 설정 | SP3a |
| `SMTP_AUTH` | 플랫폼 | 운영자 | 배포 환경 | env | 운영자 설정 | 배포 점검 | `src/lib/mail/transport.ts` | restart | — | — | 운영 설정 | SP3a |
| `SMTP_USER` | 플랫폼 | 운영자 | 배포 환경 | env | 운영자 설정 | 배포 점검 | `src/lib/mail/transport.ts` | restart | — | — | 운영 설정 | SP3a |
| `SMTP_PASS` | 플랫폼 | 운영자 | 배포 환경 | env | 운영자 설정 | 배포 점검 | `src/lib/mail/transport.ts` | restart | — | — | 운영 설정 | SP3a |
| `SMTP_FROM_ADDRESS` | 플랫폼 | 운영자 | 배포 환경 | env | 운영자 설정 | 배포 점검 | `src/lib/mail/transport.ts` | restart | — | — | 운영 설정 | SP3a |
| `MAIL_FROM_NAME` | 플랫폼 | 운영자 | 배포 환경 | env | 운영자 설정 | 배포 점검 | `src/lib/mail/fromName.ts`, `src/lib/settings/workspaceConfig.ts` | restart | — | — | 운영 설정 | SP3a |
| `INVITE_ALLOWED_DOMAINS` | 플랫폼 | 운영자 | 배포 환경 | env | 운영자 설정 | 배포 점검 | `src/lib/settings/workspaceConfig.ts` | restart | — | — | 운영 설정 | SP3a |
| `NEXT_PUBLIC_BRAND_NAME` | 플랫폼 | 운영자 | 배포 환경 | env_public | 운영자 설정 | 배포 점검 | `src/lib/branding.ts` | rebuild | — | — | 운영 설정 | SP3a |
| `NEXT_PUBLIC_BRAND_TAGLINE` | 플랫폼 | 운영자 | 배포 환경 | env_public | 운영자 설정 | 배포 점검 | `src/lib/branding.ts` | rebuild | — | — | 운영 설정 | SP3a |
| `NEXT_PUBLIC_BRAND_COPYRIGHT` | 플랫폼 | 운영자 | 배포 환경 | env_public | 운영자 설정 | 배포 점검 | `src/lib/branding.ts` | rebuild | — | — | 운영 설정 | SP3a |
| `NEXT_PUBLIC_APP_URL` | 플랫폼 | 운영자 | 배포 환경 | env_public | 운영자 설정 | 배포 점검 | `src/app/actions/meetingNotify.ts`, `src/app/actions/projectInvites.ts` | rebuild | — | — | 운영 설정 | SP3a |
| `VERCEL_PROJECT_PRODUCTION_URL` | 플랫폼 | 운영자 | 배포 환경 | env | 운영자 설정 | 배포 점검 | `src/app/actions/meetingNotify.ts` | restart | — | — | 운영 설정 | SP3a |
| `VERCEL_ENV` | 플랫폼 | 운영자 | 배포 환경 | env | 운영자 설정 | 배포 점검 | `next.config.ts` | restart | — | — | 운영 설정 | SP3a |
| `STAGING` | 플랫폼 | 운영자 | 배포 환경 | env | 운영자 설정 | 배포 점검 | `src/app/(app)/layout.tsx`, `next.config.ts` | restart | — | — | 운영 설정 | SP3a |
| `USAGE_TRACKING` | 플랫폼 | 운영자 | 배포 환경 | env | 운영자 설정 | 배포 점검 | `src/lib/domain/usageTracking.ts`, `src/app/api/track/route.ts` | restart | — | — | 운영 설정 | SP3a |
| `CRON_SECRET` | 플랫폼 | 운영자 | 배포 환경 | env | 운영자 설정 | 배포 점검 | `src/app/api/cron/ai-index/route.ts`, `src/app/api/cron/inbox-retention/route.ts`, `src/app/api/wiki/worker/route.ts` | restart | — | — | 운영 설정 | SP3a |
| `WIKI_WORKER_SECRET` | 플랫폼 | 운영자 | 배포 환경 | env | 운영자 설정 | 배포 점검 | `src/app/api/wiki/worker/route.ts` | restart | — | — | 운영 설정 | SP3a |
| `CHAT_V2_INDEX_CRON_SECRET` | 플랫폼 | 운영자 | 배포 환경 | env | 운영자 설정 | 배포 점검 | `src/app/api/chat/index/worker/route.ts` | restart | — | — | 운영 설정 | SP3a |
| `AGENT_API_SECRET` | 플랫폼 | 운영자 | 배포 환경 | env | 운영자 설정 | 배포 점검 | `src/lib/agent/externalApi.ts`, `src/lib/minutes/externalApi.ts` | restart | — | — | 운영 설정 | SP3a |
| `MINUTES_API_SECRET` | 플랫폼 | 운영자 | 배포 환경 | env | 운영자 설정 | 배포 점검 | `src/lib/agent/externalApi.ts`, `src/lib/minutes/externalApi.ts` | restart | — | — | 운영 설정 | SP3a |
| `AGENT_API_ENABLED` | 플랫폼 | 운영자 | 배포 환경 | env | 운영자 설정 | 배포 점검 | `src/lib/modules/flags.ts`, `src/lib/agent/externalApi.ts` | restart | — | — | 운영 설정 | SP3a |
| `MINUTES_API_ENABLED` | 플랫폼 | 운영자 | 배포 환경 | env | 운영자 설정 | 배포 점검 | `src/lib/modules/flags.ts`, `src/lib/minutes/externalApi.ts` | restart | — | — | 운영 설정 | SP3a |
| `MINUTES_FOLDER_PATH_ENABLED` | 플랫폼 | 운영자 | 배포 환경 | env | 운영자 설정 | 배포 점검 | `src/lib/modules/flags.ts`, `src/lib/minutes/externalApi.ts` | restart | — | — | 운영 설정 | SP3a |
| `WIKI_SERVICE_ENABLED` | 플랫폼 | 운영자 | 배포 환경 | env | 운영자 설정 | 배포 점검 | `src/lib/modules/flags.ts`, `src/lib/wiki/serviceState.ts` | restart | — | — | 운영 설정 | SP3a |
| `WIKI_WORKER_ENABLED` | 플랫폼 | 운영자 | 배포 환경 | env | 운영자 설정 | 배포 점검 | `src/lib/modules/flags.ts`, `src/lib/wiki/serviceState.ts` | restart | — | — | 운영 설정 | SP3a |
| `CHAT_V2_ENABLED` | 플랫폼 | 운영자 | 배포 환경 | env | 운영자 설정 | 배포 점검 | `src/lib/modules/flags.ts` | restart | — | — | 운영 설정 | SP3a |
| `CHAT_V2_PLANNER_ENABLED` | 플랫폼 | 운영자 | 배포 환경 | env | 운영자 설정 | 배포 점검 | `src/lib/modules/flags.ts` | restart | — | — | 운영 설정 | SP3a |
| `CHAT_V2_LLM_SYNTHESIS_ENABLED` | 플랫폼 | 운영자 | 배포 환경 | env | 운영자 설정 | 배포 점검 | `src/lib/modules/flags.ts` | restart | — | — | 운영 설정 | SP3a |
| `CHAT_V2_INDEX_WORKER_ENABLED` | 플랫폼 | 운영자 | 배포 환경 | env | 운영자 설정 | 배포 점검 | `src/lib/modules/flags.ts` | restart | — | — | 운영 설정 | SP3a |
| `CHAT_V2_INDEX_ENQUEUE_ENABLED` | 플랫폼 | 운영자 | 배포 환경 | env | 운영자 설정 | 배포 점검 | `src/lib/ai/index/enqueue.ts` | restart | — | — | 운영 설정 | SP3a |
| `AI_PROVIDER` | 플랫폼 | 운영자 | 배포 환경 | env | 운영자 설정 | 배포 점검 | `src/lib/ai/provider.ts`, `src/lib/ai/llm.ts`, `src/lib/ai/similarity.ts` | restart | — | — | 운영 설정 | SP3a |
| `LLM_API_KEY` | 플랫폼 | 운영자 | 배포 환경 | env | 운영자 설정 | 배포 점검 | `src/lib/ai/provider.ts`, `src/lib/ai/llm.ts`, `src/lib/ai/similarity.ts` | restart | — | — | 운영 설정 | SP3a |
| `OPENAI_API_KEY` | 플랫폼 | 운영자 | 배포 환경 | env | 운영자 설정 | 배포 점검 | `src/lib/ai/provider.ts`, `src/lib/ai/llm.ts`, `src/lib/ai/similarity.ts` | restart | — | — | 운영 설정 | SP3a |
| `LLM_BASE_URL` | 플랫폼 | 운영자 | 배포 환경 | env | 운영자 설정 | 배포 점검 | `src/lib/ai/provider.ts`, `src/lib/ai/llm.ts`, `src/lib/ai/similarity.ts` | restart | — | — | 운영 설정 | SP3a |
| `LLM_MODEL` | 플랫폼 | 운영자 | 배포 환경 | env | 운영자 설정 | 배포 점검 | `src/lib/ai/provider.ts`, `src/lib/ai/llm.ts`, `src/lib/ai/similarity.ts` | restart | — | — | 운영 설정 | SP3a |
| `EMBED_MODEL` | 플랫폼 | 운영자 | 배포 환경 | env | 운영자 설정 | 배포 점검 | `src/lib/ai/provider.ts`, `src/lib/ai/llm.ts`, `src/lib/ai/similarity.ts` | restart | — | — | 운영 설정 | SP3a |
| `GEMINI_API_KEY` | 플랫폼 | 운영자 | 배포 환경 | env | 운영자 설정 | 배포 점검 | `src/lib/ai/provider.ts`, `src/lib/ai/llm.ts`, `src/lib/ai/similarity.ts` | restart | — | — | 운영 설정 | SP3a |
| `GOOGLE_API_KEY` | 플랫폼 | 운영자 | 배포 환경 | env | 운영자 설정 | 배포 점검 | `src/lib/ai/provider.ts`, `src/lib/ai/llm.ts`, `src/lib/ai/similarity.ts` | restart | — | — | 운영 설정 | SP3a |
| `GEMINI_BASE_URL` | 플랫폼 | 운영자 | 배포 환경 | env | 운영자 설정 | 배포 점검 | `src/lib/ai/provider.ts`, `src/lib/ai/llm.ts`, `src/lib/ai/similarity.ts` | restart | — | — | 운영 설정 | SP3a |
| `GEMINI_MODEL` | 플랫폼 | 운영자 | 배포 환경 | env | 운영자 설정 | 배포 점검 | `src/lib/ai/provider.ts`, `src/lib/ai/llm.ts`, `src/lib/ai/similarity.ts` | restart | — | — | 운영 설정 | SP3a |
| `GEMINI_EMBED_MODEL` | 플랫폼 | 운영자 | 배포 환경 | env | 운영자 설정 | 배포 점검 | `src/lib/ai/provider.ts`, `src/lib/ai/llm.ts`, `src/lib/ai/similarity.ts` | restart | — | — | 운영 설정 | SP3a |
| `GEMINI_FALLBACK_MODELS` | 플랫폼 | 운영자 | 배포 환경 | env | 운영자 설정 | 배포 점검 | `src/lib/ai/provider.ts`, `src/lib/ai/llm.ts`, `src/lib/ai/similarity.ts` | restart | — | — | 운영 설정 | SP3a |
| `ASSISTANT_MIN_SIMILARITY` | 플랫폼 | 운영자 | 배포 환경 | env | 운영자 설정 | 배포 점검 | `src/lib/ai/provider.ts`, `src/lib/ai/llm.ts`, `src/lib/ai/similarity.ts` | restart | — | — | 운영 설정 | SP3a |
| `NEXT_PUBLIC_SUPABASE_URL` | 플랫폼 | 운영자 | 배포 환경 | env_public | 운영자 설정 | 배포 점검 | `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`, `src/lib/supabase/env.ts`, `src/middleware.ts` | rebuild | — | — | 운영 설정 | SP3a |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 플랫폼 | 운영자 | 배포 환경 | env_public | 운영자 설정 | 배포 점검 | `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`, `src/middleware.ts` | rebuild | — | — | 운영 설정 | SP3a |
| `SUPABASE_SERVICE_ROLE_KEY` | 플랫폼 | 운영자 | 배포 환경 | env | 운영자 설정 | 배포 점검 | `src/lib/supabase/env.ts` | restart | — | — | 운영 설정 | SP3a |
| `table:llm_config` | 플랫폼 | 플랫폼 관리자 | `/admin/llm-config` | DB 표 | 운영자 설정 | 관리 화면·DB | `src/lib/ai/llm-override.ts` | immediate | — | — | 운영 설정 | SP3a |
| `table:llm_profiles` | 플랫폼 | 플랫폼 관리자 | `/admin/llm-config` | DB 표 | 운영자 설정 | 관리 화면·DB | `src/lib/ai/llm-override.ts` | immediate | — | — | 운영 설정 | SP3a |
<!-- catalog:auto:4:end -->

## 5. 개인 설정

개인 선호는 `user_preferences.prefs`에 저장한다. 저장 위치와 범위가 바뀌는 개인 키는 담당 SP에서 이 행의 편집·상태를 갱신한다.

<!-- catalog:auto:5:start -->
| 설정 키 | 스코프 | 편집 주체 | 편집 UI/API | 저장소 | 기본값(출처) | 검증기 | 소비처 | 적용 시점 | 기존 데이터 영향 | 테스트 | 현재 상태 | 담당 SP |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `theme` | 개인 | 본인 | 계정·화면 | 개인 선호 저장소 | 시스템·라이트·다크 | 개인 설정 API | 사용자 화면 | immediate | 표시만 | — | stored | SP3b / SPU1 |
| `locale` | 개인 | 본인 | 계정·화면 | 개인 선호 저장소 | ko·en | 개인 설정 API | 사용자 화면 | immediate | 표시만 | — | stored | SP3b / SPU1 |
| `heroCollapsed` | 개인 | 본인 | 계정·화면 | 개인 선호 저장소 | 머리 접기 | 개인 설정 API | 사용자 화면 | immediate | 표시만 | — | stored | SP3b / SPU1 |
| `sidebarCollapsed` | 개인 | 본인 | 계정·화면 | 개인 선호 저장소 | 사이드바 접기 | 개인 설정 API | 사용자 화면 | immediate | 표시만 | — | stored | SP3b / SPU1 |
| `dashSections` | 개인 | 본인 | 계정·화면 | 개인 선호 저장소 | 대시보드 구역 | 개인 설정 API | 사용자 화면 | immediate | 표시만 | — | stored | SP3b / SPU1 |
| `minutesView` | 개인 | 본인 | 계정·화면 | 개인 선호 저장소 | 회의록 보기 | 개인 설정 API | 사용자 화면 | immediate | 표시만 | — | stored | SP3b / SPU1 |
| `minuteFontSize` | 개인 | 본인 | 계정·화면 | 개인 선호 저장소 | 회의록 글자 크기 | 개인 설정 API | 사용자 화면 | immediate | 표시만 | — | stored | SP3b / SPU1 |
| `minutesExplorerLayout` | 개인 | 본인 | 계정·화면 | 개인 선호 저장소 | 회의록 탐색기 배치 | 개인 설정 API | 사용자 화면 | immediate | 표시만 | — | stored | SP3b / SPU1 |
| `notifRead` | 개인 | 본인 | 계정·화면 | 개인 선호 저장소 | 읽은 알림 | 개인 설정 API | 사용자 화면 | immediate | 표시만 | — | stored | SP3b / SPU1 |
| `lastProjectId` | 개인 | 본인 | 계정·화면 | 개인 선호 저장소 | 마지막 프로젝트 | 개인 설정 API | 사용자 화면 | immediate | 표시만 | — | stored | SP3b / SPU1 |
| `wbsHideDone` | 개인 | 본인 | 계정·화면 | 개인 선호 저장소 | WBS 완료 숨김 | 개인 설정 API | 사용자 화면 | immediate | 표시만 | — | stored | SP3b / SPU1 |
| `wbsOutline` | 개인 | 본인 | 계정·화면 | 개인 선호 저장소 | WBS 아웃라인 | 개인 설정 API | 사용자 화면 | immediate | 표시만 | — | stored | SP3b / SPU1 |
| `wbsGanttScale` | 개인 | 본인 | 계정·화면 | 개인 선호 저장소 | 간트 축척 | 개인 설정 API | 사용자 화면 | immediate | 표시만 | — | stored | SP3b / SPU1 |
| `notif` | 개인 | 본인 | 계정·화면 | 개인 선호 저장소 | 알림 토글 | 개인 설정 API | 사용자 화면 | immediate | 표시만 | — | stored | SP3b / SPU1 |
<!-- catalog:auto:5:end -->

## 6. 제품 고정

이 항목들은 업무 의미 또는 외부 계약과 연결되어 현재 설정 키로 열지 않는다. 근거는 파일과 심볼이며, 뒤 SP에서 바뀌면 이 표의 개정 칸을 갱신한다.

| 항목 | 고정 이유 | 근거 | 개정 |
| --- | --- | --- | --- |
| WBS 단계 의미와 크레딧 키 | 에이전트 단계 전이 계약 | `src/lib/domain/stageCredits.ts` `CREDIT_KEYS` | 표시 라벨은 SP5b |
| 에이전트 주문 상태·우선순위·좌석 TTL | 외부 러너와 좌석 상태 프로토콜 | `src/lib/domain/seatState.ts` `deriveSeatState` | SP3a: 유지 |
| 진척 집계와 WBS 상태 | 업무 계산의 동일한 의미 | `src/lib/domain/progress.ts` `statusOf`·`src/lib/domain/rollup.ts` `weightOf` | SP4: null 가중치 = 1(루트·하위 동일), 위험 신호는 유지 |
| 위험 신호 임계값 | 한 제품 위험 모델 | `src/lib/domain/dashboard.ts` `riskModel` | SP3a: 유지 |
| 프로젝트 생애 상태 | 시작일·종료일·완료율 공통 판정 | `src/lib/domain/project-status.ts` `projectLifecycleStatus` | SP3a: 유지 |
| 주간 시트 핵심 열 | 보고서의 기본 구조 | `src/lib/domain/weeklySheet.ts` `WEEKLY_CELL_KEYS` | 사용자 필드는 SP5c |
| 담당 종류·영역 종류 | 엑셀·보고서·모듈 공통 분류 | `src/lib/domain/areas.ts` `AreaKind` | SP3a: 유지 |
| 회의록 공개 공유 범위 | 공유 토큰이 여는 자료 범위 | `src/app/share/minutes/[token]/page.tsx` `SharedMinutePage` | 첨부 제외 유지 |

## 7. 지원 제한

지원 제한은 설정화율 분모에서 제외한다. 상한의 UI·API·저장소 일치 여부는 해당 담당 SP가 확인한다.

| 제한 | 현재 값 | 근거 | 재검토 조건 |
| --- | --- | --- | --- |
| UI 언어 | 한국어·영어 | `src/lib/i18n/dict.ts` `Locale` | 번역 추가 |
| 보고서 생성 문구 | 한국어 | `src/lib/report/weekly.ts` | 출력 언어 요구 |
| 보고 주기 | 주간 | `src/lib/report/week.ts` | 격주·월간 요구 |
| WBS 단수 | 1~10 | `src/lib/domain/levelSettings.ts` `LEVEL_LABELS_MAX` | 깊이 정책 요구 |
| 회의록 첨부 | 개당 20MB·10개 | `src/lib/domain/minutes.ts` | SP5 첨부 정책 범위 안에서 조정 |
| 이슈 첨부 | 개당 50MB·10개 | `src/app/actions/issueAttachments.ts` | 업로드 정책 변경 |
| 회의록 폴더 깊이 | 5 | `src/lib/domain/minutes.ts` | 트리 UX 변경 |
| 주간 셀 | 20,000자 | `src/lib/domain/weeklySheet.ts` | 양식 요구 |
| 임베딩 차원 | 768 | `src/lib/ai/ingest.ts` | 마이그레이션·재색인 설계 |
| 워크스페이스별 LLM 키 | 없음 | `src/lib/ai/llm-override.ts` | 공급자 격리 요구 |
| 권한 모델 | 고정 역할 격자 | `src/lib/domain/authz.ts` | 역할 모델 개정 |

## 8. 구현 세부 상수

XML 네임스페이스, 렌더 여유 픽셀, 밀리초 환산은 저장할 사용자 선택이 아니며 이 카탈로그의 설정 키로 등록하지 않는다.

## 9. 예약 네임스페이스

`notify.*`는 관리자 알림 정책(`notify.policy`, SP8), `views.*`는 보기 기본값(`views.default`, SP3b), `portal.*`는 홈 위젯(`portal.widgets`, SP3b)을 위해 예약한다. 다른 용도로 사용하지 않는다.

## 10. 변경 절차·개정 이력

새 키는 정의·편집·소비·검증을 같은 담당 SP에서 연결한다. 키의 저장 형태를 제자리에서 바꾸지 않고 새 키와 이행 절차를 만든다(`src/lib/settings/registry.ts`의 `assertRegistry`). 제품 고정 항목의 설정 승격은 설계 §6 개정으로 검토한다.

- 2026-09-30: SP3a 설정 레지스트리와 운영 설정에서 자동 절 생성 시작.
