// 합성 구성 셋의 주간 영역(project_areas kind='weekly_section') — 해석기의 ConfigArea 모양. R 실험·데이터·운영 / C 공정·안전·품질·자재는
// 개정 §6.5.8 의 이름(C 의 '품질' 은 옛 11구분명과 같은 낱말 — 스펙 D8·E9 가 등록 이름으로 센티널에서 뺀다), default 는 이 계획의 합성.
// code 는 이름과 다르게 둔다(code ≠ name — 개명·정렬 동률을 시험할 수 있게).
import type { ConfigArea } from '@/lib/settings/projectConfig'
import type { SyntheticConfig } from './configs'
import { SYNTHETIC_TEAMS } from './teams'

type ConfigId = SyntheticConfig['id']

const teamId = (cfg: ConfigId, code: string): string => {
  const t = SYNTHETIC_TEAMS[cfg].find((x) => x.code === code)
  if (!t) throw new Error(`합성 팀이 없다: ${cfg}/${code}`)
  return t.id
}
const area = (cfg: ConfigId, code: string, name: string, sortOrder: number, teams: [string, 'primary' | 'support'][]): ConfigArea => ({
  id: `${cfg}-area-${code.toLowerCase()}`, kind: 'weekly_section', code, name, sortOrder, active: true,
  teams: teams.map(([c, kind]) => ({ teamId: teamId(cfg, c), kind })),
})

export const SYNTHETIC_WEEKLY_AREAS: Readonly<Record<ConfigId, readonly ConfigArea[]>> = {
  default: [
    area('default', 'PLAN', '기획', 1, [['PLN', 'primary']]),
    area('default', 'BUILD', '개발', 2, [['DEV', 'primary']]),
    area('default', 'CHECK', '검증', 3, [['DEV', 'support']]),
  ],
  research: [
    area('research', 'EXP', '실험', 1, [['RES', 'primary']]),
    area('research', 'DATA', '데이터', 2, [['RES', 'primary'], ['OPS', 'support']]),
    area('research', 'RUN', '운영', 3, [['OPS', 'primary']]),
  ],
  construction: [
    area('construction', 'WORK', '공정', 1, [['CIV', 'primary']]),
    area('construction', 'SAFE', '안전', 2, [['SAF', 'primary']]),
    area('construction', 'QUAL', '품질', 3, [['MEP', 'primary']]),
    area('construction', 'MATL', '자재', 4, [['MEP', 'support']]),
  ],
}
