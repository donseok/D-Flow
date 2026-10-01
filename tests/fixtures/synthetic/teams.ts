// 합성 구성 셋의 팀(개정 §6.5.8 의 R·C 팀 코드, default 는 이 계획의 합성 이름) — 해석기 getProjectConfig 의 ConfigTeam 모양.
// 모두 그 구성 프로젝트의 전용 팀이다. 색은 TEAM_PALETTE 의 앞자리(생성 순 배정 — src/lib/domain/teamColor.ts). 고객 이름 없음.
import type { ConfigTeam } from '@/lib/settings/projectConfig'
import type { SyntheticConfig } from './configs'

type ConfigId = SyntheticConfig['id']

export const SYNTHETIC_PROJECT_ID: Readonly<Record<ConfigId, string>> = {
  default: 'p-default', research: 'p-research', construction: 'p-construction',
}

const PALETTE = ['#4f46e5', '#0276a8', '#7c3aed'] as const
const team = (cfg: ConfigId, code: string, name: string, i: number): ConfigTeam => ({
  id: `${cfg}-team-${code.toLowerCase()}`, code, name, sortOrder: i, active: true, color: PALETTE[i], progressVisible: true,
  projectId: SYNTHETIC_PROJECT_ID[cfg],
})

export const SYNTHETIC_TEAMS: Readonly<Record<ConfigId, readonly ConfigTeam[]>> = {
  default: [team('default', 'PLN', '기획팀', 0), team('default', 'DEV', '개발팀', 1)],
  research: [team('research', 'RES', '연구팀', 0), team('research', 'OPS', '운영팀', 1)],
  construction: [team('construction', 'CIV', '토목팀', 0), team('construction', 'MEP', '기전팀', 1), team('construction', 'SAF', '안전팀', 2)],
}
