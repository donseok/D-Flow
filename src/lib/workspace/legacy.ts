/**
 * 옛 경로 → 새 경로 변환표(스펙 §5.3, D5·D6·D36) — 순수. 스텁 열한 개(src/app/(legacy)/**\/route.ts)와 tests/routes/legacy-redirects.test.ts 가
 * 이 표 하나를 쓴다. 워크스페이스 해석(쿠키·회의록 행·?project=)은 스텁 쪽(legacyStub.ts)이 하고 여기는 슬러그를 받는다.
 * 영구 표다 — 옛 링크(색인·봇 출처·외부 API·북마크)가 남아 있는 한 지우지 않는다. 이 파일은 route-literals 의 영구 허용 항목이다.
 */
export type LegacyKind = 'projects' | 'meetings' | 'minutes' | 'minute' | 'agents' | 'portfolio' | 'usage' | 'adminAccounts' | 'adminTeams' | 'kanban' | 'gantt'

export const LEGACY_ROUTES: Readonly<Record<LegacyKind, { oldPath: string; resolve: 'current' | 'minuteRow' | 'accountsProject' | 'none' }>> = {
  projects: { oldPath: '/projects', resolve: 'current' },
  meetings: { oldPath: '/meetings', resolve: 'current' },
  minutes: { oldPath: '/minutes', resolve: 'current' },
  minute: { oldPath: '/minutes/[id]', resolve: 'minuteRow' },
  agents: { oldPath: '/agents', resolve: 'current' },
  portfolio: { oldPath: '/portfolio', resolve: 'current' },
  usage: { oldPath: '/usage', resolve: 'current' },
  adminAccounts: { oldPath: '/admin/accounts', resolve: 'accountsProject' },
  adminTeams: { oldPath: '/admin/teams', resolve: 'current' },
  kanban: { oldPath: '/p/[projectId]/kanban', resolve: 'none' },
  /** 간트는 WBS 타임라인에 합쳐졌다. page.tsx 의 redirect() 는 로딩 경계 안이라 200 + meta refresh 였다(스파이크 S-1 ①) — 스펙 §5.1 대안대로 스텁으로 */
  gantt: { oldPath: '/p/[projectId]/gantt', resolve: 'none' },
}

const SEGMENT: Readonly<Record<Exclude<LegacyKind, 'minute' | 'kanban' | 'gantt'>, string>> = {
  projects: 'projects', meetings: 'meetings', minutes: 'minutes', agents: 'agents', portfolio: 'portfolio', usage: 'usage',
  adminAccounts: 'admin/accounts', adminTeams: 'admin/teams',
}
/** RSC·Next 내부 쿼리 — 대상 URL 로 옮기지 않는다(비평 feasibility m20) */
const DROP = new Set(['_rsc', '__nextDataReq'])

export function carryQuery(search: string): string {
  const src = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const out = new URLSearchParams()
  for (const [k, v] of src) if (!DROP.has(k)) out.append(k, v)
  const s = out.toString()
  return s ? `?${s}` : ''
}

export function legacyTarget(kind: LegacyKind, pathname: string, search: string, slug: string | null): { path: string; search: string } {
  if (kind === 'kanban') {
    const pid = pathname.split('/')[2] ?? ''
    const src = new URLSearchParams(carryQuery(search).slice(1))
    const out = new URLSearchParams({ view: 'board' })
    const group = src.get('view')
    if (group) out.set('group', group)
    for (const [k, v] of src) if (k !== 'view') out.append(k, v)
    return { path: `/p/${pid}/wbs`, search: `?${out.toString()}` }
  }
  if (kind === 'gantt') {
    // ?view=timeline 고정, 나머지 쿼리 보존(비평 ui-risk m4). 옛 간트에는 view 쿼리가 없었다 — 들어온 view 는 타임라인으로 덮는다
    const pid = pathname.split('/')[2] ?? ''
    const out = new URLSearchParams({ view: 'timeline' })
    for (const [k, v] of new URLSearchParams(carryQuery(search).slice(1))) if (k !== 'view') out.append(k, v)
    return { path: `/p/${pid}/wbs`, search: `?${out.toString()}` }
  }
  if (!slug) return { path: '/', search: '' }
  const base = `/w/${encodeURIComponent(slug)}`
  if (kind === 'minute') {
    const id = pathname.split('/')[2] ?? ''
    return { path: `${base}/minutes/${id}`, search: carryQuery(search) }
  }
  return { path: `${base}/${SEGMENT[kind]}`, search: carryQuery(search) }
}
