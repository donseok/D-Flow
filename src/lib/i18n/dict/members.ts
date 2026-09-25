// members 화면 사전 — 이 파일은 members 영역 담당만 수정한다.
// en은 Record<keyof ko, string> 타입으로 ko와의 키 패리티를 컴파일 타임에 강제한다.
// 명단 표·추가 폼(components/roster/*)의 문구는 컴포넌트에 있다 — 서버 액션·RPC 오류 문구와 같은 한국어 원문이라서.

export const membersKo = {
  // 히어로(page.tsx)
  'members.projectFallback': '프로젝트',
  // 프로젝트명 뒤에 붙는 접미사 — JSX에서 `${projectName} ${t(...)}` 로 조합
  'members.heroTitleSuffix': '팀 구성',
  'members.heroDesc': '근태·회의 참석자의 기준이 되는 참여 인력 명단입니다.',
  // KPI 는 활성 명단 행 기준
  'members.kpiTeamSizeSub': '활성 참여자',
  'members.kpiAdminsSub': '관리자 권한',
  'members.kpiUnlinkedSub': '계정 미연결(외부 인력)',
  // 명단 섹션
  'members.sectionManage': '명단 · 권한',
  'members.sectionRoster': '참여자 명단',
  'members.manageHint': '한 사람이 한 행입니다. 팀은 여러 개를 고를 수 있고 대표 팀이 맨 앞에 옵니다. 권한(없음/멤버/관리자)도 같은 행에서 정하고, 행마다 저장합니다. 기록이 있어 삭제할 수 없는 사람은 비활성으로 바꾸세요.',
} as const
