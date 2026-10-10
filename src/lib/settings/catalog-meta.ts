// 카탈로그 메타(개정 §2.10) — 레지스트리를 런타임에 가볍게 두려고 소비처·테스트·상태를 옆 파일에 둔다. 상태 어휘: planned·stored·wired·verified.
// 소비처는 설정값을 실제로 읽거나 표시하는 대표 진입점이다. 뒤 SP 가 소비를 배선하면 이 목록과 상태를 함께 갱신한다.
// 상태의 뜻(개정 §2.10): stored = 권한 있는 편집으로 검증·저장·재조회된다 / wired = 모든 소비처가 저장값을 쓴다 / verified = 격리와 기존 데이터·동시성·오류
// 검증까지 끝났다. 아래 stored·wired 행의 주석은 "왜 아직 그 상태인가"(남은 소비처·남은 확인)를 적는다 — 2026-10-09 재점검이 코드로 다시 확인했다.
// 2026-10-10: 아래 표(BASE_META)의 wired 는 "E2E 완주 전의 상태"다. 실제 서버에서 설정 → 화면·동작 → 격리 → 원복을 완주한 키는 파일 끝의
// E2E_EVIDENCE 한 줄이 verified 로 올린다 — 내보내는 CATALOG_META 가 그 결과다(키마다 한 줄이라 단계가 깨진 키만 그 줄을 지워 되돌린다).
import type { SettingKey, SettingScope } from './registry'

export type CatalogStatus = 'planned' | 'stored' | 'wired' | 'verified'
export interface CatalogMeta { consumers: readonly string[]; tests: readonly string[]; status: CatalogStatus; sp: string }

const A = (status: CatalogStatus, consumers: string[], tests: string[]): CatalogMeta => ({ consumers, tests, status, sp: 'SP3a' })
const S5A = (status: CatalogStatus, consumers: string[], tests: string[]): CatalogMeta => ({ consumers, tests, status, sp: 'SP5 A' })
const S5B1 = (status: CatalogStatus, consumers: string[], tests: string[]): CatalogMeta => ({ consumers, tests, status, sp: 'SP5 B1' })
const S5B3 = (status: CatalogStatus, consumers: string[], tests: string[]): CatalogMeta => ({ consumers, tests, status, sp: 'SP5 B3' })
const S5B2 = (status: CatalogStatus, consumers: string[], tests: string[]): CatalogMeta => ({ consumers, tests, status, sp: 'SP5 B2' })
const S5B4 = (status: CatalogStatus, consumers: string[], tests: string[]): CatalogMeta => ({ consumers, tests, status, sp: 'SP5 B4' })
const S5BW = (status: CatalogStatus, consumers: string[], tests: string[]): CatalogMeta => ({ consumers, tests, status, sp: 'SP5b W' })
const S5BI = (status: CatalogStatus, consumers: string[], tests: string[]): CatalogMeta => ({ consumers, tests, status, sp: 'SP5b I' })
const S5C = (status: CatalogStatus, consumers: string[], tests: string[]): CatalogMeta => ({ consumers, tests, status, sp: 'SP5c' })
const S6 = (status: CatalogStatus, consumers: string[], tests: string[]): CatalogMeta => ({ consumers, tests, status, sp: 'SP6' })
const BASE_META: Readonly<Record<SettingKey, CatalogMeta>> = {
  'fields.wbs_item': S5C('verified',
    ['src/components/settings/CustomFieldsSettings.tsx', 'src/components/fields/CustomFieldValuesEditor.tsx', 'src/components/wbs/RowDetailPanel.tsx', 'src/components/wbs/WbsGanttSheet.tsx', 'src/lib/excel/exportWithProfile.ts', 'src/lib/excel/parseWithProfile.ts', 'src/lib/ai/index/content.ts', 'supabase/migrations/0027_custom_fields.sql'],
    ['tests/domain/custom-fields.test.ts', 'tests/rls/custom-fields.test.ts', 'tests/ui/custom-fields-settings.test.tsx', 'tests/ui/wbs-custom-columns.test.tsx', 'tests/excel/custom-columns-roundtrip.test.ts', 'tests/ai/index-custom-fields.test.ts'],
  ),
  'fields.issue': S5C('verified',
    ['src/components/settings/CustomFieldsSettings.tsx', 'src/components/fields/CustomFieldValuesEditor.tsx', 'src/components/issues/IssueModals.tsx', 'src/app/(app)/p/[projectId]/issues/page.tsx', 'src/app/actions/issues.ts', 'src/lib/ai/index/content.ts', 'supabase/migrations/0027_custom_fields.sql'],
    ['tests/domain/custom-fields.test.ts', 'tests/rls/custom-fields.test.ts', 'tests/ui/custom-fields-settings.test.tsx', 'tests/actions/custom-fields-actions.test.ts', 'tests/ai/index-custom-fields.test.ts'],
  ),
  'fields.weekly_row': S5C('verified',
    ['src/components/settings/CustomFieldsSettings.tsx', 'src/components/fields/CustomFieldValuesEditor.tsx', 'src/components/weekly/WeeklySheetView.tsx', 'src/app/(app)/p/[projectId]/weekly/page.tsx', 'src/app/actions/weekly.ts', 'src/lib/ai/index/content.ts', 'supabase/migrations/0027_custom_fields.sql'],
    ['tests/domain/custom-fields.test.ts', 'tests/rls/custom-fields.test.ts', 'tests/ui/custom-fields-settings.test.tsx', 'tests/ui/weekly-custom-columns.test.tsx', 'tests/actions/weekly-create.test.ts', 'tests/ai/index-custom-fields.test.ts'],
  ),
  'modules.allowed': A('verified', ['src/lib/modules/effective.ts', 'src/lib/settings/validateConfig.ts'], ['tests/modules/effective.test.ts', 'tests/settings/config-lifecycle.test.ts']),
  'ai.enabled': A('verified', ['src/lib/modules/aiAvailable.ts'], ['tests/modules/effective.test.ts']),
  'invites.allowed_domains': A('verified', ['src/lib/data/inviteDomains.ts'], ['tests/settings/workspace-config.test.ts', 'tests/domain/invites.test.ts']),
  // wired(2026-10-10) — 워크스페이스를 아는 모든 소비처가 저장값을 쓴다: 셸(모노그램·aria)·세 범위의 탭 제목(워크스페이스·프로젝트 레이아웃의
  // generateMetadata, 전역 범위는 셸이 그리는 현재 워크스페이스)·전역 검색 대화상자의 문구·초대 메일·내보내기 파일·외부 회의록 API 의 오류문(인증 뒤 —
  // 자격증명의 워크스페이스)·AI 프롬프트 넷(옛 챗 answer, 회의록 Q&A 문서·보관함, 주간 브리핑 — 프로젝트 행에서 워크스페이스를 풀어 읽는다,
  // 챗 v2 합성 — 라우트가 접근 범위·관문으로 확인한 워크스페이스의 이름을 합성 입력에 싣는다)·wbs.md 검증 오류문(순수 파서가 이름을 인자로 받고
  // 업로드 액션이 가드 결과의 워크스페이스로 읽어 넘긴다). 주간 브리핑은 프로젝트가 공유하는 캐시 문서라 이름을 바꾼 뒤의 반영은 다음 생성부터다
  // (캐시 키·해시에 넣지 않은 까닭은 src/lib/ai/brief.ts 의 weeklySystem 주석). 간트 영향 확인 문구·연동 안내는 제품 이름을 빼서 소비처가 아니다.
  // 공개 화면(로그인·초대·루트 오류)과 인증 전 API 오류의 env 이름은 의도다(워크스페이스를 모른다).
  // 격리 완주: 로컬 E2E setting-product-name(세 범위의 탭 제목이 그 이름, 다른 워크스페이스의 세 화면에는 그 글자가 없다). AI 프롬프트의 이름(브리핑·챗 답변)은
  // 모델 호출이 필요해 E2E 가 보지 않는다 — 프롬프트에 실리는 것까지를 단위 테스트(product-name-remaining 등)가 고정한다
  'branding.product_name': A('wired',
    ['src/lib/settings/displayBranding.ts', 'src/lib/shell/loadShell.ts', 'src/components/app/BrandSlot.tsx', 'src/components/ui/BrandMark.tsx', 'src/app/(app)/w/[slug]/layout.tsx',
      'src/app/(app)/p/[projectId]/layout.tsx', 'src/app/(app)/(global)/layout.tsx', 'src/components/search/GlobalSearchDialog.tsx', 'src/app/actions/projectInvites.ts',
      'src/lib/minutes/externalApi.ts', 'src/lib/ai/answer.ts', 'src/lib/ai/minutes-answer.ts', 'src/lib/ai/brief.ts', 'src/lib/ai/chat/orchestrator.ts',
      'src/app/api/chat/v2/stream/route.ts', 'src/lib/wbsmd/parse.ts', 'src/app/actions/wbsMarkdown.ts'],
    ['tests/settings/display-branding.test.ts', 'tests/shell/scope-layouts.test.tsx', 'tests/app/w-layout.test.tsx', 'tests/actions/project-invites-gate.test.ts', 'tests/components/workspace-fields-editor.test.tsx',
      'tests/shell/scope-branding.test.tsx', 'tests/shell/global-bar-search.test.tsx', 'tests/ui/global-search.test.tsx', 'tests/api/minutes-error-product-name.test.ts',
      'tests/ai/legacy-chat-workspace-scope.test.ts', 'tests/ai/minutes-answer-product-name.test.ts', 'tests/ai/product-name-remaining.test.ts']),
  // wired(2026-10-09) — 세 범위의 셸 로고와 세 범위의 탭 아이콘이 저장값을 쓴다(읽기 라우트는 소속·현재 슬롯만 낸다). 전역 범위(/account·/admin)는
  // 주소가 워크스페이스를 정하지 않아 셸이 그리는 현재 워크스페이스(readCurrentWorkspace — 쿠키 힌트를 소속으로 다시 본 값, 없으면 첫 소속)의 마크를 쓴다.
  // 근거 테스트: scope-branding '(global) 탭 제목·아이콘'(양성·격리·소속 없음), w-layout, scope-layouts(셸 슬롯).
  // 격리 완주: 로컬 E2E setting-logo(세 범위의 탭 아이콘 링크가 읽기 라우트를 가리키고 그 라우트가 올린 바이트를 image/png 로 돌려준다, 다른 워크스페이스
  // 화면에는 로고 주소가 없고 비소속에게는 404). 업로드 액션(파일 인자)은 E2E 가 부르지 못해 픽스처로 올린다 — 형식 검사는 logo-upload 가 고정한다
  'branding.logo': A('wired',
    ['src/app/api/brand/[workspaceId]/[slot]/route.ts', 'src/lib/shell/loadShell.ts', 'src/components/app/BrandSlot.tsx', 'src/components/ui/BrandMark.tsx', 'src/app/(app)/w/[slug]/layout.tsx', 'src/app/(app)/p/[projectId]/layout.tsx', 'src/app/(app)/(global)/layout.tsx'],
    ['tests/settings/logo-upload.test.ts', 'tests/api/brand-route.test.ts', 'tests/shell/scope-layouts.test.tsx', 'tests/shell/brand.test.tsx', 'tests/app/w-layout.test.tsx', 'tests/settings/validate-config.test.ts', 'tests/shell/scope-branding.test.tsx']),
  // wired(2026-10-09) — 저장(hex → 파생 세트) → loadShell 이 스타일 문자열로(accentStyle) → 세 범위 레이아웃이 모두 loadShell 을 거쳐 AppShell 이
  // <style> 한 블록으로 싣는다(action 계열 변수 여섯, 라이트·다크). 근거 테스트: scope-layouts '저장된 강조색(branding.accent)을 셸의 스타일로 싣는다',
  // brand '두 세트 열두 값이 모두 소문자 hex 면 :root 다음 .dark', app-shell 'accent 는 <style> 한 블록', config-lifecycle '저장된 accent 가 red;} 나
  // </style> 이면 읽기에서 invalid 다', accent-editor(409 뒤 새 명령 id). 공개 화면은 워크스페이스를 몰라 제품 기본색이다(의도).
  // 격리 완주: 로컬 E2E setting-accent(세 범위 셸의 :root action 배경 = 저장된 라이트 세트, 다른 워크스페이스 셸에는 강조색 블록이 없다)
  'branding.accent': A('wired',
    ['src/components/settings/AccentEditor.tsx', 'src/lib/shell/loadShell.ts', 'src/lib/settings/accentCss.ts', 'src/components/app/AppShell.tsx'],
    ['tests/settings/accent.test.ts', 'tests/shell/brand.test.tsx', 'tests/shell/scope-layouts.test.tsx', 'tests/shell/app-shell.test.tsx', 'tests/settings/config-lifecycle.test.ts', 'tests/components/accent-editor.test.tsx']),
  'branding.mail_from_name': A('verified', ['src/lib/mail/fromName.ts', 'src/lib/settings/displayBranding.ts'], ['tests/settings/display-branding.test.ts']),
  // wired(2026-10-09) — 사이드 내비(워크스페이스·프로젝트)·모바일 서랍·브레드크럼·전역 검색(⌘K)이 모두 navFor 의 결과를 쓴다. 검색은 손으로 적은
  // 목록을 버리고 셸이 내린 두 메뉴(프로젝트 범위의 groups 와 워크스페이스 층의 workspaceGroups)를 그대로 편다 — 저장한 순서·이름, 모듈·권한으로
  // 걸러진 항목, 같은 주소. 근거 테스트: nav-consumption(네 표면), global-search '메뉴·제품 이름은 셸이 내려 준 워크스페이스의 값이다',
  // scope-branding 'loadShell.workspaceGroups'(양성·격리), global-bar-search, app-shell(searchNav).
  // 격리 완주: 로컬 E2E setting-menu(워크스페이스·전역 범위 사이드 내비의 순서·이름, 같은 계정이 여는 다른 워크스페이스의 내비는 그대로). 전역 검색(⌘K)은
  // 같은 navFor 결과를 받는다 — 대화상자를 여는 것은 단위 테스트(global-search)가 맡는다. 사용 현황 키·봇 경로는 메뉴 이름을 쓰지 않는다
  'navigation.menu': A('wired', ['src/components/settings/MenuOrderEditor.tsx', 'src/lib/shell/loadShell.ts', 'src/lib/nav/registry.ts', 'src/components/app/AppShell.tsx', 'src/components/search/GlobalSearchDialog.tsx'],
    ['tests/settings/registry.test.ts', 'tests/shell/scope-layouts.test.tsx', 'tests/nav/nav-for.test.ts', 'tests/shell/nav-consumption.test.tsx', 'tests/components/menu-order-editor.test.tsx',
      'tests/ui/global-search.test.tsx', 'tests/shell/scope-branding.test.tsx', 'tests/shell/global-bar-search.test.tsx', 'tests/shell/app-shell.test.tsx']),
  'core.level_labels': A('verified', ['src/app/api/v1/wbs/structure/route.ts', 'src/lib/agent/wbsImport.ts'], ['tests/settings/project-config.test.ts', 'tests/settings/create-project.test.ts']),
  // SP4 A2 — 팀 예약어 파생(reservedTeamNames — 팀 추가·개명·가져오기 등록)이 읽는다. 표시 소비도 붙었다: 편집기(설정 화면 '일반' 범주)·
  // WBS 화면(일괄 편집·붙여넣기·변경 이력)·가져오기 마법사·엑셀 머리(내보내기)와 그 머리의 감지 별칭(inspect·execute). 화면 눈확인 전이라 wired.
  // 2026-10-09 재점검: 격리(project-isolation·rls/settings-isolation)·동시성(rls/settings-cas)은 이 키로 시험돼 있다.
  // 화면 완주: 로컬 E2E setting-extra-axis(작업 계획 화면·가져오기 마법사에 그 이름, 엑셀 머리, 그 파일의 재감지, 다른 프로젝트는 감지·표시 없음).
  // 일괄 편집·붙여넣기 대화상자 안의 문구는 열어 보지 않는다(같은 prop — extra-axis-label 단위 테스트). 봇 답변의 고정 이름은 이 키의 범위 밖으로 둔다(미결정)
  'core.extra_axis_label': A('wired',
    ['src/app/(app)/p/[projectId]/settings/page.tsx', 'src/app/(app)/p/[projectId]/wbs/page.tsx', 'src/app/(app)/p/[projectId]/agents/page.tsx', 'src/app/(app)/p/[projectId]/import/page.tsx',
      'src/app/api/export/route.ts', 'src/app/api/import/inspect/route.ts', 'src/app/api/import/execute/route.ts', 'src/app/actions/projectTeams.ts'],
    ['tests/settings/registry.test.ts', 'tests/actions/project-teams-actions.test.ts', 'tests/ui/extra-axis-label.test.tsx', 'tests/excel/extra-axis-label.test.ts']),
  'core.milestone_keywords': A('verified', ['src/app/(app)/p/[projectId]/dashboard/page.tsx', 'src/lib/ai/tools/dashboard.ts'], ['tests/settings/default-keywords.test.ts', 'tests/settings/project-config.test.ts']),
  // SP4 — 표준 레이아웃(저장하지 않는다)·한 경로 내보내기·표기(D48)로 네 연결이 실물이다(개정 §6.1-3): ① 정의·이 행 ② 편집 = 임포트 마법사의
  // 저장(execute 의 양식 저장)·설정 화면의 '저장된 양식 비우기'(ClearExcelProfileButton — 레지스트리 widget, updateProjectSettings)·내보내기 표기
  // ③ 소비 = 내보내기·inspect·execute ④ 테스트(동등성·라우트). 편집 UI 칸은 실재 컴포넌트를 가리킨다(A2 최종 리뷰 완료 P2-3 — 옛 이름
  // ExcelProfilePanel 은 만들어진 적이 없다. catalog-sync 가 custom 컴포넌트의 실재를 본다)
  'wbs.excel_profile': {
    status: 'verified', sp: 'SP4',
    consumers: ['src/app/api/import/inspect/route.ts', 'src/app/api/export/route.ts', 'src/app/api/import/execute/route.ts', 'src/app/(app)/p/[projectId]/settings/page.tsx'],
    tests: ['tests/excel/standard-profile.test.ts', 'tests/api/export-route.test.ts'],
  },
  'modules.enabled': A('verified', ['src/lib/modules/effective.ts', 'src/app/(app)/p/[projectId]/settings/page.tsx'], ['tests/modules/effective.test.ts', 'tests/settings/config-lifecycle.test.ts']),
  'workflow.stage_credits': A('verified', ['src/components/settings/StageCreditSlider.tsx', 'supabase/migrations/0026_workflow_policy.sql'], ['tests/settings/registry.test.ts', 'tests/domain/stage-credits.test.ts', 'tests/rls/workflow-policy.test.ts']),
  // SP5 A(스펙 D44) — 두 스코프 공용 키 이름(메타는 키 이름 하나 — 스코프별 소비처 (나) 꼴은 SP5 B 마감 판정). 워크스페이스 값의 소비처는
  // 새 프로젝트의 초기값(createProject 의 seedFrom — 상속 아님)과 워크스페이스 화면 달력(viewZone — merge 뒤 슬러그 워크스페이스), 프로젝트 값의
  // 소비처는 load.ts·주간·봇 도구 등이다. 과제 29 가 정의·편집(설정 화면 달력 절)·소비처·테스트 네 연결을 확인하고 verified 로 올렸다.
  // a6 리뷰 Q3 정정: data/usage.ts 는 p_timezone 을 받기만 하고 지금 호출부(/w/[slug]/usage)는 usageTimezone(null) = UTC 고정이다
  // (워크스페이스 필터는 SP8) — 소비처에서 뺐다. defs/project.ts 는 정의·편집 파일이라 소비처가 아니다(→ actions/project.ts 의 seedFrom)
  'calendar.timezone': S5A('verified',
    ['src/lib/calendar/load.ts', 'src/lib/settings/workspaceConfig.ts', 'src/app/(app)/p/[projectId]/weekly/page.tsx', 'src/lib/calendar/viewZone.ts', 'src/app/actions/project.ts'],
    ['tests/domain/calendar.test.ts', 'tests/rls/calendar-parity.test.ts', 'tests/calendar/load.test.ts', 'tests/components/time-display-zone.test.tsx', 'tests/scripts/bootstrap-timezone.test.ts'],
  ),
  'calendar.working_days': S5A('verified',
    ['src/lib/domain/calendar.ts', 'src/lib/calendar/load.ts', 'src/lib/domain/progress.ts', 'src/lib/calendar/viewZone.ts', 'src/app/actions/project.ts'],
    ['tests/domain/calendar.test.ts', 'tests/rls/calendar-parity.test.ts', 'tests/components/calendar-first-column.test.tsx', 'tests/settings/calendar-keys.test.ts'],
  ),
  'calendar.week_start': S5A('verified',
    ['src/lib/report/week.ts', 'src/app/actions/weekly.ts', 'src/lib/ai/tools/weekly.ts', 'src/lib/calendar/viewZone.ts', 'src/app/actions/project.ts'],
    ['tests/rls/week-start-transition.test.ts', 'tests/report/week.test.ts', 'tests/ai/bot-week-rules.test.ts', 'tests/actions/settings-week-start.test.ts'],
  ),
  // SP3b UI-3 과제 2·6·10 — 네 연결(정의·편집기 PortalWidgetsEditor·소비처 홈 v1 페이지와 노출 식·테스트) 완료.
  // 2026-10-09 재점검: 소비처는 홈 하나이고 끊긴 자리가 없다(partial-failure 가 끔·순서·판독 실패를 고정).
  // 격리 완주: 로컬 E2E setting-portal-widgets(끈 위젯만 홈에서 사라지고 같은 계정이 여는 다른 워크스페이스 홈에는 남는다).
  // UI-3 의 사용자 화면 확인(docs/baseline/sp3b-ui.md — 대기 중)은 별도 UI 게이트다 — 이 상태가 그 기록을 대신하지 않는다
  'portal.widgets': { consumers: ['src/app/(app)/w/[slug]/page.tsx', 'src/lib/portal/widgets.ts', 'src/components/settings/PortalWidgetsEditor.tsx'], tests: ['tests/settings/portal-widgets-def.test.ts', 'tests/portal/widgets.test.ts', 'tests/settings/portal-widgets-editor.test.tsx', 'tests/portal/partial-failure.test.tsx'], status: 'wired', sp: 'SP3b' },
  // SPU1(개정 §5.8.5) — 정의·편집기 LocalDraftsEditor·소비처(초안 저장소의 정책 판정 + 위키 편집기)·테스트. 다른 편집 표면이 초안을 쓰게 되면 같은 저장소를 지난다
  // SP8(개정 §4.10) — 정의·편집기·발행 관문(emit)·테스트. 합성 S7b(두 워크스페이스 격리)가 근거다(E2E_EVIDENCE).
  // 2026-10-09 재점검: 발행은 emit 한 곳이고 꺼진 유형은 이벤트·수신자 행을 쓰지 않는다(notify-emit '꺼진 유형은 발행하지 않는다',
  // '한 워크스페이스의 정책은 다른 워크스페이스의 발행을 막지 않는다' — 단위 격리). 계정 화면은 워크스페이스가 끈 유형을 표시한다(workspaceOff).
  // 격리 완주: 합성 게이트 S7b-notify-isolation(R 에서 끄면 R 은 이벤트 0행·C 는 그대로 발행, 다시 켜면 R 도 발행). 로컬 E2E 의 notify-policy 는 한 워크스페이스의 끔·켬
  'notify.policy': { consumers: ['src/lib/notify/policy.ts', 'src/lib/notify/emit.ts', 'src/components/settings/NotifyPolicyEditor.tsx', 'src/lib/notify/workspaceOff.ts'], tests: ['tests/settings/notify-policy-def.test.ts', 'tests/lib/notify-emit.test.ts', 'tests/lib/notify-policy.test.ts', 'tests/settings/notify-policy-editor.test.tsx', 'tests/lib/notify-workspace-off.test.ts'], status: 'wired', sp: 'SP8' },
  // 2026-10-09 재점검(security.local_drafts): 초안을 쓰는 표면은 위키 편집기 하나이고 정책 판독은 fail-closed 다(drafts/policy '설정 조회 실패·손상 값·
  // 워크스페이스 모름은 초안을 끈다').
  // 격리 완주: 로컬 E2E setting-local-drafts(끈 워크스페이스의 위키 문서 화면에 allowed:false 가 내려가고 다른 워크스페이스는 켜진 채). 위키 화면이 필요해
  // E2E_WIKI=1(서버 WIKI_SERVICE_ENABLED=true)일 때만 돈다 — 건너뛴 실행은 근거가 아니다. 브라우저 저장소에 실제로 쓰지 않는 것은 단위 테스트(local-drafts)
  'security.local_drafts': { consumers: ['src/lib/drafts/storage.ts', 'src/lib/drafts/policy.ts', 'src/components/wiki/WikiDocumentEditor.tsx', 'src/app/(app)/p/[projectId]/wiki/topics/[topicId]/page.tsx', 'src/components/settings/LocalDraftsEditor.tsx'], tests: ['tests/settings/security-drafts.test.ts', 'tests/drafts/local-drafts.test.ts', 'tests/drafts/policy.test.ts', 'tests/settings/local-drafts-editor.test.tsx', 'tests/ui/wiki-document-editor-draft.test.tsx'], status: 'wired', sp: 'SPU1' },
  // SP3b UI-3 과제 3·7·14 — 정의·보드 교차 검사·편집기·소비처·테스트. 소비처는 작업 계획 화면의 첫 보기다(wbs/page → resolveWbsView:
  // 주소의 보기 → 이 설정 → 표. view-switch 'URL → 설정 → 표'·'기본 보기 손상은 표 + 설정 알림'이 고정). 밀도는 이 키의 범위가 아니다(D43).
  // 격리 완주: 로컬 E2E setting-views-default(첫 진입이 보드, 주소의 보기가 설정을 이긴다, 다른 프로젝트는 표 그대로).
  // UI-3 의 사용자 화면 확인(docs/baseline/sp3b-ui.md 의 "기본 보드 저장 후 재진입" 표본 — 대기 중)은 별도 UI 게이트다
  'views.default': { consumers: ['src/lib/settings/defs/project.ts', 'src/lib/settings/validateConfig.ts', 'src/components/settings/ViewsDefaultEditor.tsx', 'src/app/(app)/p/[projectId]/wbs/page.tsx', 'src/lib/wbs/view.ts'], tests: ['tests/settings/views-default-def.test.ts', 'tests/settings/views-default-editor.test.tsx', 'tests/wbs/view-switch.test.tsx'], status: 'wired', sp: 'SP3b' },
  // SP5 B1 — 정의·편집·소비처·검증이 이어졌다(스펙 D44)
  'issues.id_policy': S5B1('verified', ['src/lib/issues/context.ts', 'src/app/actions/issues.ts', 'src/components/settings/IssuePolicyEditor.tsx'], ['tests/issues/id-policy.test.ts', 'tests/rls/issue-code-policy.test.ts', 'tests/ui/issue-policy-editor.test.tsx']),
  'issues.analysis': S5B1('verified', ['src/lib/issues/rules.ts', 'src/app/actions/issues.ts', 'src/app/(app)/p/[projectId]/settings/page.tsx'], ['tests/issues/rules.test.ts', 'tests/actions/issue-entry-rules.test.ts', 'tests/rls/issue-areas.test.ts']),
  'minutes.attachments': S5B3('verified', ['src/lib/minutes/resolveAttachmentPolicy.ts', 'src/app/actions/minutes.ts', 'src/components/settings/AttachmentPolicyEditor.tsx'], ['tests/minutes/attachment-policy.test.ts', 'tests/rls/minute-attachments-policy.test.ts', 'tests/ui/attachment-policy-editor.test.tsx']),
  // 정본 §3.3 — 배포 env(MINUTES_FOLDER_PATH_ENABLED)의 설정화. 정의·편집기(MinutesAutoFileEditor — 프로젝트 설정 '회의록' 범주)·소비처
  // (외부 업로드 라우트가 쓰기 대상의 프로젝트 값으로 folder_path 를 받을지 정한다 — autoFile.ts, env 가 명시 false 면 배포 전체 끔)·테스트.
  // 업로드 완주: 로컬 E2E setting-auto-file(켠 프로젝트는 folder_path 로 편철, 끈 프로젝트는 폴더를 만들지 않는다, 같은 워크스페이스의 다른 프로젝트는 켜진 채).
  // 편집기 화면은 단위 테스트(minutes-auto-file-editor)가 고정한다
  'minutes.auto_file_by_path': { consumers: ['src/lib/minutes/autoFile.ts', 'src/lib/minutes/externalApi.ts', 'src/app/api/v1/minutes/route.ts', 'src/components/settings/MinutesAutoFileEditor.tsx'], tests: ['tests/minutes/auto-file.test.ts', 'tests/minutes/external-api.test.ts', 'tests/settings/minutes-auto-file-editor.test.tsx', 'tests/settings/registry.test.ts'], status: 'wired', sp: 'SP7' },
  // SP5 B2 — create_team·ensure_team_roots(SQL)가 모드를 읽고, 외부 업로드·배치·재편철의 경로 정규화가 모드별로 갈린다(v2.9 — rootMode·folders).
  // 정의·편집(teams 되돌리기 — 플랫폼 관리자)·소비처·테스트 네 연결로 verified. 화면은 teams 만(D21)
  'minutes.root_folders': S5B2('verified', ['src/lib/minutes/rootMode.ts', 'src/lib/minutes/folders.ts', 'src/app/api/v1/minutes/route.ts', 'src/app/actions/teams.ts', 'src/app/actions/settings.ts', 'src/components/settings/RootFoldersEditor.tsx'], ['tests/minutes/root-folders.test.ts', 'tests/rls/minutes-teams.test.ts', 'tests/minutes/folder-path.test.ts', 'tests/minutes/external-api.test.ts', 'tests/ui/workspace-settings-page.test.tsx']),
  'attendance.types': S5B4('verified', ['src/components/attendance/AttendanceView.tsx', 'src/app/actions/attendance.ts', 'src/lib/report/weekly.ts', 'src/lib/ai/tools/attendance.ts', 'src/lib/ai/chat/router.ts', 'src/components/settings/VocabEditor.tsx'], ['tests/settings/vocab.test.ts', 'tests/rls/config-vocabulary.test.ts', 'tests/report/weekly.test.ts', 'tests/ai/chat-v2-router.test.ts', 'tests/ui/vocab-editor.test.tsx']),
  'meetings.categories': S5B4('verified', ['src/components/meetings/MeetingFormModal.tsx', 'src/components/meetings/MeetingCalendar.tsx', 'src/app/actions/meetings.ts', 'src/lib/data/meetings.ts', 'src/lib/minutes/meetings.ts', 'src/app/actions/meetingNotify.ts'], ['tests/settings/vocab.test.ts', 'tests/rls/config-vocabulary.test.ts', 'tests/minutes/external-api.test.ts', 'tests/ui/meeting-form-announce.test.tsx', 'tests/ui/vocab-editor.test.tsx']),
  'issues.severities': S5B4('verified', ['src/components/issues/IssuesView.tsx', 'src/components/issues/IssueModals.tsx', 'src/app/actions/issues.ts', 'src/lib/domain/issues.ts', 'src/lib/report/issues/model.ts', 'src/components/dashboard/IssueQueueCard.tsx'], ['tests/settings/vocab.test.ts', 'tests/rls/config-vocabulary.test.ts', 'tests/domain/issues.test.ts', 'tests/actions/vocab-migrate.test.ts', 'tests/ui/vocab-editor.test.tsx']),
  'issues.sources': S5B4('verified', ['src/components/issues/IssueModals.tsx', 'src/app/actions/issues.ts', 'src/lib/report/catalog/issueAnalysisBuild.ts', 'src/lib/report/issues/model.ts'], ['tests/settings/vocab.test.ts', 'tests/rls/config-vocabulary.test.ts', 'tests/report/issue-analysis-vocab.test.ts', 'tests/ui/vocab-editor.test.tsx']),
  // SP5b I — 정의·편집기(VocabEditor 범주 칸)·DB 트리거·소비처(목록·모달·이력)·테스트(골든 TS·SQL) 넷이 이어져 verified
  'workflow.issue_statuses': S5BI('verified', ['src/lib/domain/issueWorkflow.ts', 'src/app/actions/issues.ts', 'src/components/issues/IssuesView.tsx', 'src/components/issues/IssueBoard.tsx', 'src/lib/domain/issueBoard.ts', 'src/components/issues/IssueModals.tsx', 'src/components/settings/VocabEditor.tsx', 'supabase/migrations/0025_issue_status_vocab.sql'], ['tests/domain/issue-workflow.test.ts', 'tests/rls/issue-workflow.test.ts', 'tests/actions/issues-gate.test.ts']),
  // SP5b W1 — 정의·SQL 판독(workflow_value_of·apply_workflow_event·guard_workflow_actual)·승인 액션까지. 화면 주입·설정 편집기는 W2, verified 는 Z
  'workflow.credit_policy': S5BW('verified', ['src/lib/settings/validateConfig.ts', 'src/components/settings/StageCreditSlider.tsx', 'supabase/migrations/0026_workflow_policy.sql'], ['tests/domain/stage-credits.test.ts', 'tests/settings/registry.test.ts', 'tests/ui/workflow-settings-editors.test.tsx']),
  'workflow.wbs_stage_labels': S5BW('verified', ['src/components/wbs/StageLabelsProvider.tsx', 'src/lib/agent/predecessorGate.ts', 'src/components/settings/StageLabelsEditor.tsx'], ['tests/ui/stage-labels-injection.test.tsx', 'tests/ui/workflow-settings-editors.test.tsx', 'tests/settings/registry.test.ts']),
  'workflow.approval_steps': S5BW('verified', ['src/lib/domain/approvalSteps.ts', 'src/app/actions/agentWork.ts', 'src/app/actions/wbsAssign.ts', 'src/components/settings/ApprovalStepsEditor.tsx', 'supabase/migrations/0026_workflow_policy.sql'], ['tests/domain/approval-steps.test.ts', 'tests/domain/approval-count.test.ts', 'tests/rls/workflow-policy.test.ts']),
  'workflow.approval_distinct_approvers': S5BW('verified', ['src/lib/domain/approvable.ts', 'src/components/settings/ApprovalStepsEditor.tsx', 'supabase/migrations/0026_workflow_policy.sql'], ['tests/domain/approval-count.test.ts', 'tests/rls/workflow-policy.test.ts']),
  'workflow.predecessor_gate': S5BW('verified', ['src/lib/domain/agentWork.ts', 'src/lib/agent/predecessorGate.ts', 'src/lib/agent/depends.ts', 'supabase/migrations/0026_workflow_policy.sql'], ['tests/agent/predecessor-gate.test.ts', 'tests/agent/claim-gate-final.test.ts', 'tests/rls/workflow-policy.test.ts']),
  'issues.cause_categories': S5B4('verified', ['src/lib/ai/issue-analysis.ts', 'src/lib/report/issues/storedRun.ts', 'src/lib/report/catalog/issueAnalysisBuild.ts', 'src/app/actions/issueAnalysis.ts'], ['tests/settings/vocab.test.ts', 'tests/ai/issue-analysis.test.ts', 'tests/report/issue-analysis-stored-run.test.ts', 'tests/report/issue-analysis-vocab.test.ts']),
  // SP6 S1 — 정의·parse(형태·카탈로그 경로). 업로드·활성화·렌더 소비는 S2·V. verified 는 Z
  'forms.weekly_report_pptx': S6('verified',
    ['src/components/settings/FormTemplatesManager.tsx', 'src/app/actions/formTemplates.ts', 'src/lib/forms/activation.ts', 'src/lib/report/forms/loadTemplate.ts', 'src/lib/report/engine/scan.ts', 'src/lib/report/engine/pptx.ts', 'src/app/api/report/route.ts'],
    ['tests/settings/forms-defs.test.ts', 'tests/ui/form-templates-manager.test.tsx', 'tests/actions/form-templates.test.ts', 'tests/forms/activation.test.ts', 'tests/report/forms/default-assets.test.ts', 'tests/negative/form-engine-outputs.test.ts'],
  ),
  'forms.weekly_report_xlsx': S6('verified',
    ['src/components/settings/FormTemplatesManager.tsx', 'src/app/actions/formTemplates.ts', 'src/lib/forms/activation.ts', 'src/lib/report/forms/loadTemplate.ts', 'src/lib/report/engine/scan.ts', 'src/lib/report/engine/xlsx.ts', 'src/app/api/report/route.ts'],
    ['tests/settings/forms-defs.test.ts', 'tests/ui/form-templates-manager.test.tsx', 'tests/actions/form-templates.test.ts', 'tests/forms/activation.test.ts', 'tests/report/forms/default-assets.test.ts', 'tests/negative/form-engine-outputs.test.ts'],
  ),
  'forms.issue_analysis_pptx': S6('verified',
    ['src/components/settings/FormTemplatesManager.tsx', 'src/app/actions/formTemplates.ts', 'src/lib/forms/activation.ts', 'src/lib/report/forms/loadTemplate.ts', 'src/lib/report/engine/scan.ts', 'src/lib/report/engine/pptx.ts', 'src/app/api/issue-analysis/route.ts'],
    ['tests/settings/forms-defs.test.ts', 'tests/ui/form-templates-manager.test.tsx', 'tests/actions/form-templates.test.ts', 'tests/forms/activation.test.ts', 'tests/report/forms/default-assets.test.ts', 'tests/negative/form-engine-outputs.test.ts'],
  ),
  'forms.wbs_export_xlsx': S6('verified',
    ['src/components/settings/FormTemplatesManager.tsx', 'src/app/actions/formTemplates.ts', 'src/lib/forms/activation.ts', 'src/lib/report/forms/loadTemplate.ts', 'src/lib/report/engine/scan.ts', 'src/lib/report/engine/xlsx.ts', 'src/app/api/export/route.ts'],
    ['tests/settings/forms-defs.test.ts', 'tests/ui/form-templates-manager.test.tsx', 'tests/actions/form-templates.test.ts', 'tests/forms/activation.test.ts', 'tests/report/forms/default-assets.test.ts', 'tests/negative/form-engine-outputs.test.ts'],
  ),
}

export interface E2eEvidence { script: string; step: string }
/**
 * E2E 근거 — verified 는 격리와 기존 데이터·동시성·오류 검증까지다(개정 §2.10). 아래 키들은 메타의 단위·RLS 테스트에 더해, 실제 서버에서
 * "설정을 바꾼다 → 화면·동작에 나타난다 → 다른 워크스페이스(프로젝트 키는 다른 프로젝트)에는 나타나지 않는다 → 되돌린다" 를 완주한 단계가 격리의 근거다.
 * **키마다 한 줄** — 그 단계가 통과하지 못했으면 그 줄만 지운다(그 키는 BASE_META 의 wired 로 돌아가고, 문서는
 * `CATALOG_WRITE=1 npx vitest run tests/settings/catalog-sync.test.ts` 로 다시 맞춘다). 단계가 그 스크립트에 실재하는지는 catalog-sync 가 본다 —
 * 단계 이름을 바꾸면 이 표도 같이 바꾼다. 건너뜀으로 기록된 단계(setting-local-drafts 는 E2E_WIKI=1 일 때만 돈다)는 근거가 아니다.
 */
export const E2E_EVIDENCE: Readonly<Partial<Record<SettingKey, E2eEvidence>>> = {
  'core.extra_axis_label': { script: 'scripts/e2e-local.mjs', step: 'setting-extra-axis' },
  'views.default': { script: 'scripts/e2e-local.mjs', step: 'setting-views-default' },
  'portal.widgets': { script: 'scripts/e2e-local.mjs', step: 'setting-portal-widgets' },
  'branding.product_name': { script: 'scripts/e2e-local.mjs', step: 'setting-product-name' },
  'branding.accent': { script: 'scripts/e2e-local.mjs', step: 'setting-accent' },
  'branding.logo': { script: 'scripts/e2e-local.mjs', step: 'setting-logo' },
  'navigation.menu': { script: 'scripts/e2e-local.mjs', step: 'setting-menu' },
  'minutes.auto_file_by_path': { script: 'scripts/e2e-local.mjs', step: 'setting-auto-file' },
  'security.local_drafts': { script: 'scripts/e2e-local.mjs', step: 'setting-local-drafts' },
  'notify.policy': { script: 'scripts/e2e-synthetic.mjs', step: 'S7b-notify-isolation' },
}

/** 승격은 wired 에서만 — 소비처가 다 이어지지 않은 키(stored)를 E2E 한 단계로 건너뛰어 올리지 않는다. 근거 스크립트는 테스트 칸에 함께 적힌다 */
function withEvidence(key: SettingKey, meta: CatalogMeta): CatalogMeta {
  const evidence = E2E_EVIDENCE[key]
  if (!evidence || meta.status !== 'wired') return meta
  return { ...meta, status: 'verified', tests: meta.tests.includes(evidence.script) ? meta.tests : [...meta.tests, evidence.script] }
}

export const CATALOG_META: Readonly<Record<SettingKey, CatalogMeta>> = Object.fromEntries(
  (Object.entries(BASE_META) as [SettingKey, CatalogMeta][]).map(([key, meta]) => [key, withEvidence(key, meta)]),
) as Record<SettingKey, CatalogMeta>

/** E2E 근거를 얹기 전의 상태 — 테스트가 "승격은 wired 에서만, 근거가 있는 키만"을 고정할 때 쓴다 */
export const baseStatusOf = (key: SettingKey): CatalogStatus => BASE_META[key].status

/** 카탈로그에만 있고 레지스트리에는 없는 키(개정 §2.6.1 "등록 시점") — 등록하는 SP 가 이 목록에서 빼고 defs 에 넣는다 */
export const PLANNED_KEYS: readonly { key: string; scope: SettingScope; sp: string; shape: string }[] = []

/** 개인 설정(개정 §2.8.5) — 계정 키는 계정 행, 워크스페이스 키는 그 워크스페이스의 개인 행(SP3b D9 — 키 목록의 정본은 prefs 의 split.ts).
 *  표 이름을 여기 적지 않는다 — 설정 해석기 쪽 파일은 개인 설정 저장소 이름을 원문에 두지 않는다(tests/settings/project-isolation) */
export const PERSONAL_PREFS: readonly { key: string; desc: string; scope: '계정' | '워크스페이스' }[] = [
  { key: 'theme', desc: '시스템·라이트·다크', scope: '계정' },
  { key: 'sidebarCollapsed', desc: '사이드바 접기', scope: '계정' }, { key: 'dashSections', desc: '대시보드 구역', scope: '계정' },
  { key: 'minutesView', desc: '회의록 보기', scope: '계정' }, { key: 'minuteFontSize', desc: '회의록 글자 크기', scope: '계정' },
  { key: 'minutesExplorerLayout', desc: '회의록 탐색기 배치', scope: '계정' }, { key: 'wbsHideDone', desc: 'WBS 완료 숨김', scope: '계정' },
  { key: 'wbsOutline', desc: 'WBS 아웃라인', scope: '계정' }, { key: 'wbsGanttScale', desc: '간트 축척', scope: '계정' },
  { key: 'notif', desc: '알림 토글', scope: '계정' }, { key: 'projectsView', desc: '프로젝트 목록 보기(행·카드)', scope: '계정' },
  { key: 'startPage', desc: '시작 화면', scope: '워크스페이스' }, { key: 'favoriteProjectIds', desc: '즐겨찾기 프로젝트(최대 20)', scope: '워크스페이스' },
  { key: 'recentProjects', desc: '최근 방문 프로젝트(최대 10)', scope: '워크스페이스' }, { key: 'notifRead', desc: '읽은 알림', scope: '워크스페이스' },
  { key: 'portalHiddenWidgets', desc: '홈에서 숨긴 위젯', scope: '워크스페이스' },
]
