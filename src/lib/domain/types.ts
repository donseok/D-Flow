import type { ThemePref } from '@/lib/theme/policy'
import type { VocabByProject } from '@/lib/settings/vocab'

/** DEPRECATED — 깊이 판정에 쓰지 않는다(진실은 parent_id 트리). 프로젝트별 레벨 라벨은 ProjectConfig.levelLabels. */
export type Level = string
/** 팀 코드 — 런타임 기준은 DB teams 마스터(관리자 화면에서 추가/비활성). 컴파일 타임 유니언 금지. */
export type TeamCode = string
export type OwnerKind = 'primary' | 'support'
export type Status = 'not_started' | 'in_progress' | 'delayed' | 'done'
export type DependencyType = 'FS' | 'SS'

export interface WbsRow {
  id: string
  parentId: string | null
  code: string
  sortOrder: number
  name: string
  biz: string | null
  deliverable: string | null
  plannedStart: string | null   // 'YYYY-MM-DD'
  plannedEnd: string | null
  weight: number | null         // null이면 형제 균등
  actualPct: number | null      // leaf만 의미 있음, 0~100
  owners: { team: TeamCode; kind: OwnerKind }[]
  /** 담당별 자동 분리(sub-act) 항목 여부. 레벨·이름이 아니라 이 플래그가 판별 근거(스펙 §5.2). */
  isOwnerSplit: boolean
  /**
   * WBS Task 단계('as'|'ip'|'im'|'xx' — fp 는 0096 에서 ip 로 이관). 에이전트 워크플로 필드라 롤업 계약의 일부가 아니다.
   * 선택 필드인 이유: 필수로 올리면 WbsRow 리터럴을 만드는 테스트 51파일이 한꺼번에 깨진다.
   * 빠뜨렸을 때의 방향은 fail-closed 다 — spec 선행이 '대기'로 보일 뿐 '시작 가능'으로 뒤집히지 않는다.
   */
  stage?: string | null
  /** 에이전트 위임(tags 에 'agent') 여부 — WBS 「단계」 컬럼 표시 조건(스펙 2026-09-15 D9). 선택 필드인 이유는 stage 와 같다. */
  agentDelegated?: boolean
  /**
   * 개인 담당자(project_members.id, §항목1 2026-09-15). team(owners)과 별개 축 — 팀 컬럼을
   * 대체하지 않고 병존한다. stage 와 같은 이유로 선택 필드다: 필수로 올리면 WbsRow 리터럴을
   * 만드는 테스트 수십 파일이 한꺼번에 깨진다. 표시명은 저장하지 않는다 — WbsGanttSheet 가 이미
   * 받는 members prop(project_members)으로 렌더 시점에 해석한다(중복 조회·중복 저장 회피).
   */
  assigneeMemberId?: string | null
  /**
   * 마지막 수정 시각(ISO). 실시간 broadcast 의 **순서 판정** 재료다 — broadcast 는 전송 순서를
   * 보장하지 않으므로, 보유 행의 이 값보다 오래된 페이로드를 버려야 늦게 도착한 옛 값이 새 값을
   * 덮어쓰지 않는다(2026-09-16 실시간 설계 §6-1).
   * stage·assigneeMemberId 와 같은 이유로 선택 필드다: 필수로 올리면 WbsRow 리터럴을 만드는
   * 테스트 수십 파일이 한꺼번에 깨진다. 없으면 '비교할 기준이 없다'는 뜻이고, 그때는 페이로드를
   * 받아들인다 — SSR 직후라 보유 값이 곧 최신이고, 버리면 갱신이 영영 오지 않는다.
   */
  updatedAt?: string | null
}

/** WBS 작업 간 일정 의존성. predecessor → successor 방향. */
export interface TaskDependency {
  id: string
  projectId: string
  predecessorId: string
  successorId: string
  type: DependencyType
  lagDays: number
  /**
   * 이 관계가 어디서 왔는가.
   * 'manual' — task_dependencies 의 실제 행. 화면에서 지울 수 있다.
   * 'spec'   — wbs_items.depends 에서 읽기 시점에 합성. DB 행이 없다(id 가 `spec:` 으로 시작).
   *
   * 선택 필드로 두지 않는다 — 합성 행에 삭제 버튼이 붙는 사고를 타입이 잡아야 한다.
   */
  origin: DependencyOrigin
}

/** @see TaskDependency.origin */
export type DependencyOrigin = 'manual' | 'spec'

export interface ComputedItem extends WbsRow {
  plannedPct: number    // 계산값 0~100
  rolledActualPct: number  // leaf=actualPct, 상위=가중 롤업
  achievement: number | null  // rolledActual/planned, planned=0이면 null
  status: Status
  children: ComputedItem[]
  depth: number
}

/* ── 멤버 관리 — 참여 인력 명단(project_members ⨝ people ⨝ 팀 배열). ──
 * 정본 형·select·매퍼는 `@/lib/data/memberSelect` 한 곳에 있다(RosterMember). 여기의 ProjectMember 는
 * 소비처 이름을 한 번에 바꾸지 않기 위한 별칭이다. 권한은 accessRole(admin|member, null=조회 전용)이고
 * 판정은 `@/lib/domain/authz` 가 한다 — 화면 표기 라벨은 roleLabel/title. */
export type { RosterMember as ProjectMember } from '@/lib/data/memberSelect'

/* ── 산출물 첨부 ── */
export interface DeliverableAttachment {
  id: string
  wbsItemId: string
  fileName: string
  filePath: string
  size: number | null
  mime: string | null
  createdAt: string
}

/* ── 근태현황 ──
 * 유형 code 는 프로젝트 설정 attendance.types(SP5 B4) — 목록·라벨·집계 분류는 설정에서 읽는다(컴파일 타임 유니언 금지). */
export type AttendanceType = string
export interface AttendanceRecord {
  id: string
  projectId: string
  memberId: string
  date: string              // 'YYYY-MM-DD'
  type: AttendanceType
  note: string | null
}

/* ── 공지사항 ── */
export type AnnouncementCategory = 'general' | 'important' | 'event'
export interface Announcement {
  id: string
  projectId: string
  title: string
  body: string
  category: AnnouncementCategory
  isPinned: boolean
  publishFrom: string | null // 'YYYY-MM-DD'(프로젝트 시간대의 날짜) 게시 시작일 · null = 무기한
  publishTo: string | null   // 'YYYY-MM-DD'(프로젝트 시간대의 날짜) 게시 종료일(포함) · null = 무기한
  /**
   * 대시보드 마일스톤 타임라인에 찍을 날짜(0091). null = 표시 안 함(폼 체크 해제).
   * optional 인 이유: 이 타입으로 객체를 만드는 테스트 픽스처 8곳과의 호환(생략 = 미표시).
   * 데이터 계층(getAnnouncements)은 항상 채워 반환한다.
   */
  milestoneDate?: string | null
  createdAt: string          // ISO timestamptz
  updatedAt: string
}

/* ── 회의 (meetings) ── */
/** 회의 범주 code — 프로젝트 설정 meetings.categories(SP5 B4). 컴파일 타임 유니언 금지 */
export type MeetingCategory = string
export type MeetingRecurrence = 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly'

export interface Meeting {
  id: string
  projectId: string
  title: string
  meetingDate: string          // 'YYYY-MM-DD' — 시리즈 앵커(첫 회차)
  startTime: string | null     // 'HH:MM' 또는 null(종일)
  endTime: string | null       // 'HH:MM' 또는 null
  location: string | null
  category: MeetingCategory
  body: string                 // 회의록/메모 (목록 조회에선 '')
  recurrence: MeetingRecurrence
  recurrenceUntil: string | null // 'YYYY-MM-DD' 포함(inclusive)
  createdBy: string | null
  createdByName: string | null
  createdAt: string
  updatedAt: string
  attendeeIds: string[]        // project_members.id (시리즈 단위)
  projectName?: string         // 내 회의 뷰 전용(크로스 프로젝트 표시)
  isMine?: boolean             // 내 회의 뷰 전용(서버 계산)
}

export interface MeetingException {
  meetingId: string
  occurrenceDate: string       // 'YYYY-MM-DD'
  kind: 'cancelled'
}

/** 달력 셀·칩이 필요로 하는 전개된 1회차. body/참석자이름은 상세 모달에서 별도 로드. */
export interface MeetingOccurrence {
  occurrenceId: string         // `${seriesId}:${occurrenceDate}` — React key & 회차 식별
  seriesId: string             // = Meeting.id
  occurrenceDate: string       // 'YYYY-MM-DD'
  projectId: string
  title: string
  startTime: string | null
  endTime: string | null
  location: string | null
  category: MeetingCategory
  isRecurring: boolean
  attendeeCount: number
  projectName?: string
  isMine?: boolean
}

/** 상세 모달용 참석자 표시 정보 */
export interface MeetingAttendeeInfo {
  id: string                   // project_members.id
  name: string
  /** 명단 팀 code — 첫 원소가 대표 팀. 팀이 없으면 빈 배열. */
  teamCodes: TeamCode[]
  email: string | null
}

/** 계정별로 동기화되는 전역 UI 설정. 각 키는 서버에 없을 수 있음(부분 저장). */
export interface UiPrefs {
  sidebarCollapsed?: boolean
  theme?: ThemePref        // 선호 — 형식 밖 저장값은 읽는 쪽(isThemePref)이 '없음'으로 본다
  locale?: 'ko' | 'en'
  dashSections?: string[]   // 대시보드 상세 아코디언에서 펼쳐 둔 그룹 id
  minutesView?: 'list' | 'calendar' | 'tree'   // 회의록 보관함 뷰 토글
  minuteFontSize?: number   // 회의록 뷰어 본문 글자크기(px, 12~28)
  minutesExplorerLayout?: 'grid' | 'list'  // 회의록 탐색기 우측 카드 레이아웃
  notifRead?: Record<string, string[]> // 프로젝트 id → 읽음 처리한 알림 id('모두 읽음' 시점 피드)
  wbsHideDone?: boolean     // WBS 완료 숨김 토글 — 전 프로젝트 공통(스펙 2026-08-10-wbs-hide-completed)
  wbsOutline?: boolean      // WBS 개요 번호 열 표시 토글 — 전 프로젝트 공통(2026-08-21 구분 열 개편)
  wbsGanttScale?: number    // WBS 간트 일 폭(px, 프리셋 12/24/48) — 전 프로젝트 공통
  notif?: Record<string, boolean> // 알림 타입 → on/off (조회 시점 필터, REQUIRED 는 무시)
  startPage?: 'home' | 'my_work' | 'projects' | 'last_project'   // 워크스페이스 키 — 루트 리졸버의 시작 화면(D44)
  favoriteProjectIds?: string[]                                   // 워크스페이스 키 — 즐겨찾기(최대 20)
  recentProjects?: { id: string; at: string }[]                   // 워크스페이스 키 — 최근 방문(최대 10, 셸이 쓴다)
}

/* ── 회의록 (minutes) ── */
export interface Minute {
  id: string
  minuteDate: string           // 'YYYY-MM-DD'
  teamCode: TeamCode
  /** SP5 B2 — 담당 팀 id(code 단위 해석 결과 — minutes.team_id). 맞는 팀이 없으면 null */
  teamId?: string | null
  title: string
  bodyMd: string               // 목록 조회에선 ''
  meetingId: string | null
  projectId?: string | null          // Wiki 귀속 프로젝트(회의 연결 없이도 지정 가능)
  projectName?: string | null        // 목록/상세 표시용 프로젝트명
  meetingOccurrenceDate?: string | null // 반복 회의의 실제 개최일
  meetingProjectId?: string | null  // 연결된 회의의 프로젝트(meetings 조인) — 회의 달력 링크 대상
  createdBy: string | null
  createdByName: string | null
  createdAt: string
  updatedAt: string
  archivedAt?: string | null       // 보관본은 직접/Wiki 근거 링크에서 읽기 전용으로 열 수 있음
  fileCount?: number           // 목록 뷰 전용(첨부 수, 서버 계산)
  bodyPreview?: string              // 카드 요약(0039 생성 컬럼, 목록/트리 조회 전용)
  meetingCategory?: MeetingCategory | null  // 연결 회의 유형(meetings 임베드, 미연결 null)
  folderId?: string | null  // 소속 폴더(0040, 목록 조회 전용 — null=미분류)
  /** 외부 연동 멱등 키(또박또박 `ddobak:<uuid>`, opaque — 파싱 금지). 상세 조회 전용 — null=연동 없음. */
  externalId?: string | null
  /** 소속 워크스페이스(minutes.workspace_id). 상세 조회 전용 — 업로드 경로 scope. */
  workspaceId?: string | null
  /** minutes.project_id 그대로(projectId 와 달리 회의 프로젝트 폴백 없음). 상세 조회 전용 — 업로드 경로 scope. */
  ownProjectId?: string | null
}

/* ── 탐색기 v2: 실제 폴더 디렉토리 (스펙 2026-07-23-minutes-folders-design.md) ── */

export interface MinuteFolder {
  id: string
  name: string
  parentId: string | null
  sort: number
  createdBy: string | null           // 작성자(계정 삭제·시스템 생성이면 null) — 폴더 종류 판정에 쓰지 않는다(kind)
  projectId: string | null           // 0076 — 귀속 프로젝트. null = 미지정
  /** 0006 — 소속 워크스페이스. 폴더 관리 판정(작성자 ∨ 그 워크스페이스 관리자)의 근거. 없으면 작성자만(fail-closed). */
  workspaceId?: string | null
  /** SP5 B2 — 폴더 종류. 없으면 일반 폴더로 본다(루트 특권을 주지 않는 쪽). team_root·custom_root 는 세션이 바꾸거나 지우지 못한다(DB 가드) */
  kind?: MinuteFolderKind
  /** team_root 의 팀 id. 그 밖은 null */
  teamId?: string | null
  /** team_root 의 팀 code(teams 조인). 못 읽으면 null — 팀을 파생하지 않는다(fail-closed) */
  teamCode?: string | null
}
export type MinuteFolderKind = 'user' | 'team_root' | 'custom_root'

/** 탐색기 리프 — 목록 조회 shape 에 폴더 소속 부착. */
export interface ExplorerLeaf {
  id: string
  minuteDate: string                 // 'YYYY-MM-DD'
  teamCode: TeamCode
  /** SP5 B2 — 담당 팀 id(code 단위 해석 결과). 맞는 팀이 없으면 null */
  teamId?: string | null
  title: string
  fileCount: number
  createdBy: string | null           // 이동 버튼 노출 판정(작성자 or 관리자)
  createdByName: string | null
  bodyPreview: string
  meetingCategory: MeetingCategory | null
  folderId: string | null            // null = 미분류
  projectId?: string | null          // Wiki 귀속 프로젝트
  projectName?: string | null
  meetingId?: string | null          // 연결된 회의(없으면 null)
  /** 연결 회의가 속한 프로젝트 — 회의 달력 링크 대상. 회의가 지워졌거나 볼 권한이 없으면 null 이라
   *  meetingId 만으로 링크를 만들지 않는다(상세 뷰어와 같은 fail-closed 판정). */
  meetingProjectId?: string | null
  /** SP5 B2(D40) — 이 회의록을 고칠(이동·일괄 지정) 수 있는가. 서버가 canEditMinute(회의록의 project_id 그대로 — 회의 폴백 아님)로
   *  판정해 싣는다. 없으면 거짓(fail-closed) */
  canEdit?: boolean
}

export interface FolderNode {
  folder: MinuteFolder
  children: FolderNode[]
  directLeaves: ExplorerLeaf[]       // 직계 소속(입력 순서 = 날짜 내림차순)
  totalCount: number                 // 하위 포함 재귀 합계
}

export interface ExplorerData {
  folders: MinuteFolder[]
  leaves: ExplorerLeaf[]             // 전 기간 flat, 날짜 내림차순
  total: number
  truncated: boolean
  /** 연결 회의의 프로젝트(meetingProjectId)별 회의 범주(설정 meetings.categories, SP5 B4). 없거나 null = 못 읽음 → 칩은 code */
  meetingCategories?: VocabByProject<'meetings.categories'>
}

export interface MinuteFile {
  id: string
  minuteId: string
  role: 'body' | 'attachment'
  fileName: string
  filePath: string
  size: number | null
  mime: string | null
  createdAt: string
  /** 올린 계정. 계정이 지워졌으면 null(FK set null). */
  uploadedBy?: string | null
  /** 올린 계정의 표시 이름 — 같은 워크스페이스 공유 계정만 읽힌다(profiles_read). 못 읽으면 null. */
  uploadedByName?: string | null
  url?: string | null          // 서명 URL(요청 시 발급)
}

/** AI 분류 카테고리 (블록 앵커 공유 모듈과 동일 값 — import 순환 방지 위해 여기 재선언). */
export type InsightKind = 'decision' | 'action' | 'deadline' | 'risk'

export interface MinuteHighlight {
  id: string
  minuteId: string
  blockIndex: number
  blockHash: string
  createdBy: string
  createdByName: string | null
  createdAt: string
}

export interface MinuteInsight {
  id: string
  minuteId: string
  bodyHash: string             // 생성 시점 fnv1a64(body_md) — 신선도 캐시 키
  kind: InsightKind | 'none'   // 'none' = 분석 성공·항목 없음 마커(blockIndex -1)
  label: string
  blockIndex: number
  blockHash: string
}

/** 회의 제목·일자를 붙인 인사이트 — getProjectMinuteSignals 의 행. PPT 브리핑 팩트(ai/projectFacts)가 소비한다.
 *  (대시보드 '주요 이슈·의사결정' 카드는 2026-08-28 제거 — 타입은 데이터 계층 계약이라 도메인에 남긴다.) */
export interface MinuteSignal extends MinuteInsight {
  minuteTitle: string
  minuteDate: string
}
