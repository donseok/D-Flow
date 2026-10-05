import { beforeEach, describe, expect, it, vi } from 'vitest'

// service_role 모듈 초기화 부작용 차단.
// 이 스위트는 활성 팀 목록을 **인자로 주입**하므로 캐시를 건드리지 않는다 — 모킹은 소음 제거용.
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({})) }))

import { parseFolderPathValue } from '@/lib/minutes/externalApi'
import {
  buildFolderSnapshot, folderPathOf, folderPathOfSnapshot,
  normalizeFolderPath, resolveFolderPath,
} from '@/lib/minutes/folders'

const TEAMS = ['PMO', 'ERP', 'MES', '가공', 'MDM']

type QueryResponse = { data?: unknown; error?: { message?: string; code?: string } | null }

/** thenable query builder — external-api.test.ts 관례와 동일. */
function queryBuilder(response: QueryResponse) {
  const builder: Record<string, ReturnType<typeof vi.fn>> & {
    then?: (r: (v: unknown) => unknown, j: (r: unknown) => unknown) => Promise<unknown>
  } = {}
  for (const m of ['select', 'insert', 'eq', 'is', 'in', 'or', 'maybeSingle', 'single']) {
    builder[m] = vi.fn(() => builder)
  }
  builder.then = (resolve, reject) =>
    Promise.resolve({ data: response.data ?? null, error: response.error ?? null }).then(resolve, reject)
  return builder
}

/** minute_folders 응답을 호출 순서대로 소비하는 가짜 클라이언트. */
function fakeDb(queue: QueryResponse[]) {
  const builders: ReturnType<typeof queryBuilder>[] = []
  const from = vi.fn(() => {
    const b = queryBuilder(queue.shift() ?? { data: null, error: null })
    builders.push(b)
    return b
  })
  // resolveFolderPath 는 DbClient 만 쓰므로 최소 표면만 흉내낸다.
  return { db: { from } as never, builders, from }
}

/** 스냅샷이 이미 채워져 있어 DB 왕복이 없는 경로용 최소 스텁. */
function fakeSb() {
  return fakeDb([]).db
}

/** 팀 루트 지연 생성(ensureTeamRoot — SP5 B2) 스텁: 팀 조회(그 code 의 활성 공용 팀) → insert(...).select('id').single() 이 행을 돌려준다 */
function fakeSbInsertReturning(id: string, code = 'PMO') {
  return fakeDb([{ data: [{ id: `t-${code}`, code, name: code, project_id: null, active: true }] }, { data: { id } }]).db
}

/** 폴더 전량 스냅샷 응답을 만든다 — resolveFolderPath 의 첫 질의. */
const rows = (...rs: Array<Record<string, unknown>>) => ({ data: rs })
const SEED_ROOT = { id: 'f-root', name: 'MES', parent_id: null, created_by: null, kind: 'team_root', team_id: 't-MES', team: { code: 'MES', project_id: null }, workspace_id: 'ws-1' }
const QUALITY = { id: 'f-q', name: '품질', parent_id: 'f-root', created_by: 'u-9', workspace_id: 'ws-1' }

beforeEach(() => vi.clearAllMocks())

describe('parseFolderPathValue (§3.1 원소 검증)', () => {
  it('배열이 아니면 거절', () => {
    for (const bad of ['MES', 42, null, {}]) {
      const r = parseFolderPathValue(bad)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toContain('validation_failed')
    }
  })

  it('원소가 문자열이 아니면 거절', () => {
    const r = parseFolderPathValue(['MES', 7])
    expect(r.ok).toBe(false)
  })

  it('btrim 후 빈 문자열은 거절', () => {
    expect(parseFolderPathValue(['MES', '   ']).ok).toBe(false)
  })

  it('btrim 을 적용해 저장한다', () => {
    const r = parseFolderPathValue(['  MES  ', '\t품질\n'])
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.path).toEqual(['MES', '품질'])
  })

  it('60자는 통과, 61자는 400 — 절단하지 않는다(D3)', () => {
    expect(parseFolderPathValue(['가'.repeat(60)]).ok).toBe(true)
    const r = parseFolderPathValue(['가'.repeat(61)])
    expect(r.ok).toBe(false)
    // 배치(§8.2 요건 11)의 reason 형식과 같은 문자열이어야 두 경로가 갈라지지 않는다
    if (!r.ok) expect(r.reason).toBe(`folder_name_too_long: ${'가'.repeat(61)}(61자)`)
  })

  it('NFC 정규화 — macOS NFD 한글이 같은 폴더로 수렴한다(중복 폴더 방지)', () => {
    const nfc = '품질'
    const nfd = nfc.normalize('NFD')                           // macOS 파일시스템이 내주는 형태
    expect(nfd).not.toBe(nfc)                                  // 입력은 서로 다른 코드포인트열
    const r = parseFolderPathValue([nfd])
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.path[0]).toBe(nfc)                      // 저장·비교는 같은 값으로
  })

  it('빈 배열은 유효 — 명시적 "폴더 없음"', () => {
    const r = parseFolderPathValue([])
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.path).toEqual([])
  })
})

describe('normalizeFolderPath (§3.2 정규화 3분기)', () => {
  it('① path[0] === team → 경로 그대로', () => {
    const r = normalizeFolderPath('MES', ['MES', '품질', '주간정례'], TEAMS)
    expect(r).toEqual({ ok: true, path: ['MES', '품질', '주간정례'], truncated: false })
  })

  it('② 팀코드가 아닌 자유 루트 → [team, ...path] 한 칸 내림', () => {
    const r = normalizeFolderPath('MES', ['신규TF', '킥오프', '1차'], TEAMS)
    expect(r).toEqual({ ok: true, path: ['MES', '신규TF', '킥오프', '1차'], truncated: false })
  })

  it('③ 다른 팀의 팀코드 → 거절', () => {
    const r = normalizeFolderPath('MES', ['ERP', '영업'], TEAMS)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('validation_failed')
  })

  it('[] → 팀 루트([team])', () => {
    expect(normalizeFolderPath('MES', [], TEAMS)).toEqual({ ok: true, path: ['MES'], truncated: false })
  })

  it('정규화 후 깊이 5 초과는 절단하고 truncated 를 세운다', () => {
    const r = normalizeFolderPath('MES', ['신규TF', 'A', 'B', 'C', 'D'], TEAMS)   // 내림 후 6단
    expect(r).toEqual({ ok: true, path: ['MES', '신규TF', 'A', 'B', 'C'], truncated: true })
  })

  it('비활성 팀 — path[0] === team 이면 캐시와 무관하게 ① (루트 세그먼트 중복 없음)', () => {
    // MDM 이 비활성이라 활성 목록에 없다. ①이 캐시를 봤다면 ②로 떨어져 ["MDM","MDM","품질"]가 된다.
    const active = ['PMO', 'ERP', 'MES', '가공']
    const r = normalizeFolderPath('MDM', ['MDM', '품질'], active)
    expect(r).toEqual({ ok: true, path: ['MDM', '품질'], truncated: false })
  })

  it('캐시 stale — 모르는 값은 ②(자유 폴더)로 degrade 하지 ③(거절)으로 가지 않는다', () => {
    const r = normalizeFolderPath('MES', ['신설팀', '킥오프'], TEAMS)   // 신설팀이 캐시에 없음
    expect(r).toEqual({ ok: true, path: ['MES', '신설팀', '킥오프'], truncated: false })
  })
})

describe('resolveFolderPath (경로 해석·생성)', () => {
  const opts = { actorId: 'u-1', activeTeamCodes: TEAMS, projectId: null, workspaceId: 'ws-1' }

  it('시드 팀 루트가 없으면 no_team_root — 호출자가 처리를 정한다', async () => {
    const { db } = fakeDb([rows()])
    const r = await resolveFolderPath(db, 'MES', ['MES', '품질'], opts)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.kind).toBe('no_team_root')
  })

  it('동명 사용자 루트 폴더(스쿼팅)는 팀 루트로 인정하지 않는다', async () => {
    const { db } = fakeDb([rows({ id: 'f-fake', name: 'MES', parent_id: null, created_by: 'u-9', workspace_id: 'ws-1' })])
    const r = await resolveFolderPath(db, 'MES', ['MES'], opts)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.kind).toBe('no_team_root')
  })

  it('스냅샷 로드 실패도 no_team_root — 조용히 미분류로 흘리지 않는다', async () => {
    const { db } = fakeDb([{ data: null, error: { message: 'down' } }])
    const r = await resolveFolderPath(db, 'MES', ['MES', '품질'], opts)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.kind).toBe('no_team_root')
  })

  it('[] → 팀 루트. 질의는 스냅샷 1회뿐', async () => {
    const { db, from } = fakeDb([rows(SEED_ROOT)])
    const r = await resolveFolderPath(db, 'MES', [], opts)
    expect(r).toMatchObject({
      ok: true, folderId: 'f-root', resolvedPath: ['MES'], targetPath: ['MES'], complete: true, failed: false,
    })
    expect(from).toHaveBeenCalledTimes(1)
  })

  it('기존 하위 폴더가 있으면 재사용하고 생성하지 않는다', async () => {
    const { db, from } = fakeDb([rows(SEED_ROOT, QUALITY)])
    const r = await resolveFolderPath(db, 'MES', ['MES', '품질'], opts)
    expect(r).toMatchObject({ ok: true, folderId: 'f-q', resolvedPath: ['MES', '품질'], complete: true })
    expect(from).toHaveBeenCalledTimes(1)          // insert 없음
  })

  it('부족분만 순차 생성하고 created_by 에 전송 사용자를 넣는다(C4)', async () => {
    const { db, builders } = fakeDb([rows(SEED_ROOT, QUALITY), { data: { id: 'f-w' } }])
    const r = await resolveFolderPath(db, 'MES', ['MES', '품질', '주간정례'], opts)
    expect(r).toMatchObject({
      ok: true, folderId: 'f-w', resolvedPath: ['MES', '품질', '주간정례'], complete: true,
    })
    expect(builders[1].insert).toHaveBeenCalledWith({
      name: '주간정례', parent_id: 'f-q', created_by: 'u-1', project_id: null,
    })
  })

  it('동시 전송 경합 — 23505 면 재조회로 흡수한다(C3, ON CONFLICT 금지)', async () => {
    const { db } = fakeDb([
      rows(SEED_ROOT),
      { data: null, error: { code: '23505', message: 'dup' } },   // insert 충돌
      { data: { id: 'f-raced' } },                                // 재조회 성공
    ])
    const r = await resolveFolderPath(db, 'MES', ['MES', '품질'], opts)
    expect(r).toMatchObject({ ok: true, folderId: 'f-raced', resolvedPath: ['MES', '품질'], complete: true })
  })

  it('생성 실패는 조상까지만 + failed — 등록을 막지 않는다', async () => {
    const { db } = fakeDb([rows(SEED_ROOT), { data: null, error: { code: '42501', message: 'denied' } }])
    const r = await resolveFolderPath(db, 'MES', ['MES', '품질'], opts)
    expect(r).toMatchObject({
      ok: true, folderId: 'f-root', resolvedPath: ['MES'], targetPath: ['MES', '품질'],
      complete: false, failed: true,
    })
  })

  it('create:false(dry run)는 아무것도 만들지 않고 complete:false·failed:false 로 보고한다', async () => {
    const { db, from } = fakeDb([rows(SEED_ROOT)])
    const r = await resolveFolderPath(db, 'MES', ['MES', '품질'], { ...opts, create: false })
    expect(r).toMatchObject({
      ok: true, folderId: 'f-root', resolvedPath: ['MES'], targetPath: ['MES', '품질'],
      complete: false, failed: false,
    })
    expect(from).toHaveBeenCalledTimes(1)          // 스냅샷만 — insert 0
  })

  it('60자 초과는 DB 를 건드리기 전에 거절한다', async () => {
    const { db, from } = fakeDb([])
    const r = await resolveFolderPath(db, 'MES', ['MES', '가'.repeat(61)], opts)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.kind).toBe('validation_failed')
    expect(from).not.toHaveBeenCalled()
  })

  it('§3.2 ③(타 팀 루트)도 DB 를 건드리기 전에 거절한다', async () => {
    const { db, from } = fakeDb([])
    const r = await resolveFolderPath(db, 'MES', ['ERP', '영업'], opts)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.kind).toBe('validation_failed')
    expect(from).not.toHaveBeenCalled()
  })

  it('한 칸 내림 경로도 팀 루트 아래에 만든다(C2 — 루트를 만들지 않는다)', async () => {
    const { db, builders } = fakeDb([
      rows(SEED_ROOT), { data: { id: 'f-tf' } }, { data: { id: 'f-kick' } },
    ])
    const r = await resolveFolderPath(db, 'MES', ['신규TF', '킥오프'], opts)
    expect(r).toMatchObject({ ok: true, folderId: 'f-kick', resolvedPath: ['MES', '신규TF', '킥오프'] })
    expect(builders[1].insert).toHaveBeenCalledWith(
      expect.objectContaining({ name: '신규TF', parent_id: 'f-root' }),
    )
  })

  it('같은 이름이 다른 부모 아래 있어도 parent_id 로 갈린다', async () => {
    const { db } = fakeDb([rows(
      SEED_ROOT,
      { id: 'f-other', name: '품질', parent_id: 'f-elsewhere', created_by: 'u-9', workspace_id: 'ws-1' },
      QUALITY,
    )])
    const r = await resolveFolderPath(db, 'MES', ['MES', '품질'], opts)
    expect(r).toMatchObject({ ok: true, folderId: 'f-q' })
  })

  it('스냅샷을 주면 질의 0회 — 배치가 항목마다 왕복하지 않게 하는 계약', async () => {
    const { db, from } = fakeDb([])
    const snapshot = buildFolderSnapshot([
      { id: 'f-root', name: 'MES', parentId: null, createdBy: null, kind: 'team_root' as const, teamCode: 'MES', projectId: null, workspaceId: 'ws-1' },
      { id: 'f-q', name: '품질', parentId: 'f-root', createdBy: 'u-9', projectId: null, workspaceId: 'ws-1' },
    ])
    const r = await resolveFolderPath(db, 'MES', ['MES', '품질'], { ...opts, snapshot })
    expect(r).toMatchObject({ ok: true, folderId: 'f-q', complete: true })
    expect(from).not.toHaveBeenCalled()
  })

  it('생성한 폴더는 스냅샷에 반영돼 다음 항목이 재사용한다(배치 멱등·중복 생성 없음)', async () => {
    const { db, from } = fakeDb([{ data: { id: 'f-new' } }])
    const snapshot = buildFolderSnapshot([
      { id: 'f-root', name: 'MES', parentId: null, createdBy: null, kind: 'team_root' as const, teamCode: 'MES', projectId: null, workspaceId: 'ws-1' },
    ])
    const a = await resolveFolderPath(db, 'MES', ['MES', '품질'], { ...opts, snapshot })
    const b = await resolveFolderPath(db, 'MES', ['MES', '품질'], { ...opts, snapshot })
    expect(a).toMatchObject({ ok: true, folderId: 'f-new' })
    expect(b).toMatchObject({ ok: true, folderId: 'f-new' })
    expect(from).toHaveBeenCalledTimes(1)          // 두 번째는 insert 조차 없다
  })
})

describe('folderPathOf / folderPathOfSnapshot (응답 에코용 역해석)', () => {
  const TREE = rows(
    SEED_ROOT,
    QUALITY,
    { id: 'f-w', name: '주간정례', parent_id: 'f-q', created_by: 'u-9', workspace_id: 'ws-1' },
  )

  it('null 폴더는 null(미분류) — 질의도 하지 않는다', async () => {
    const { db, from } = fakeDb([])
    expect(await folderPathOf(db, null)).toBeNull()
    expect(from).not.toHaveBeenCalled()
  })

  it('root-first 경로를 돌려준다', async () => {
    const { db } = fakeDb([TREE])
    expect(await folderPathOf(db, 'f-w')).toEqual(['MES', '품질', '주간정례'])
  })

  it('끊긴 체인은 추측하지 않고 null', () => {
    const snap = buildFolderSnapshot([
      { id: 'f-x', name: 'X', parentId: 'f-missing', createdBy: null, projectId: null, workspaceId: 'ws-1' },
    ])
    expect(folderPathOfSnapshot(snap, 'f-x')).toBeNull()
  })

  it('순환 참조는 가드로 끊는다(무한 루프 없음)', () => {
    const snap = buildFolderSnapshot([
      { id: 'a', name: 'A', parentId: 'b', createdBy: null, projectId: null, workspaceId: 'ws-1' },
      { id: 'b', name: 'B', parentId: 'a', createdBy: null, projectId: null, workspaceId: 'ws-1' },
    ])
    expect(folderPathOfSnapshot(snap, 'a')).toEqual(['B', 'A'])
  })

  it('조회 실패는 null(에코 생략)', async () => {
    const { db } = fakeDb([{ data: null, error: { message: 'down' } }])
    expect(await folderPathOf(db, 'f-w')).toBeNull()
  })
})

describe('프로젝트 스코프 경로 해석 (0076)', () => {
  const P1 = 'aaaaaaaa-0000-0000-0000-000000000001'
  const rows = [
    { id: 'g-pmo', name: 'PMO', parentId: null, createdBy: null, kind: 'team_root' as const, teamCode: 'PMO', projectId: null, workspaceId: 'ws-1' },
    { id: 'p1-pmo', name: 'PMO', parentId: null, createdBy: null, kind: 'team_root' as const, teamCode: 'PMO', projectId: P1, workspaceId: 'ws-1' },
    { id: 'p1-sub', name: '주간회의', parentId: 'p1-pmo', createdBy: 'u1', projectId: P1, workspaceId: 'ws-1' },
  ]

  it('seedRoots 는 (projectId, 팀코드) 로 분리된다 — 동명 루트가 프로젝트별로 공존', () => {
    const snap = buildFolderSnapshot(rows)
    expect(snap.seedRoots.get(`p:${P1} PMO`)).toBe('p1-pmo')
    expect(snap.seedRoots.get('w:ws-1 PMO')).toBe('g-pmo')
  })

  it('resolveFolderPath 는 opts.projectId 트리의 루트를 쓴다', async () => {
    const snap = buildFolderSnapshot(rows)
    const res = await resolveFolderPath(fakeSb(), 'PMO', ['PMO', '주간회의'], {
      actorId: 'u1', activeTeamCodes: ['PMO'], snapshot: snap, create: false, projectId: P1, workspaceId: null,
    })
    expect(res.ok && res.folderId).toBe('p1-sub')
  })

  it('미지정(projectId null) 해석은 그 워크스페이스의 미지정 루트를 쓴다', async () => {
    const snap = buildFolderSnapshot(rows)
    const res = await resolveFolderPath(fakeSb(), 'PMO', [], {
      actorId: 'u1', activeTeamCodes: ['PMO'], snapshot: snap, create: false, projectId: null, workspaceId: 'ws-1',
    })
    expect(res.ok && res.folderId).toBe('g-pmo')
  })

  it('프로젝트 루트 부재 + create 시 ensureTeamRoot 로 지연 생성한다(팀 = code 단위 해석, 이름 = 팀 이름)', async () => {
    const snap = buildFolderSnapshot([rows[0]])
    const res = await resolveFolderPath(fakeSbInsertReturning('new-root'), 'PMO', ['PMO'], {
      actorId: 'u1', activeTeamCodes: ['PMO'], snapshot: snap, projectId: P1, workspaceId: 'ws-1',
    })
    expect(res.ok && res.folderId).toBe('new-root')
    expect(snap.seedRoots.get(`p:${P1} PMO`)).toBe('new-root')  // 스냅샷에도 반영
    expect(snap.byId.get('new-root')).toMatchObject({ workspaceId: 'ws-1', kind: 'team_root' as const, teamCode: 'PMO' })
  })

  it('워크스페이스를 모르면 지연 생성하지 않는다(팀을 고를 범위가 없다) — no_team_root', async () => {
    const snap = buildFolderSnapshot([rows[0]])
    const res = await resolveFolderPath(fakeSbInsertReturning('new-root'), 'PMO', ['PMO'], {
      actorId: 'u1', activeTeamCodes: ['PMO'], snapshot: snap, projectId: P1, workspaceId: null,
    })
    expect(!res.ok && res.kind).toBe('no_team_root')
  })

  it('프로젝트 루트 부재 + create:false 는 no_team_root — 생성하지 않는다', async () => {
    const snap = buildFolderSnapshot([rows[0]])
    const res = await resolveFolderPath(fakeSb(), 'PMO', ['PMO'], {
      actorId: 'u1', activeTeamCodes: ['PMO'], snapshot: snap, create: false, projectId: P1, workspaceId: null,
    })
    expect(!res.ok && res.kind).toBe('no_team_root')
  })

  it('스냅샷 로드 실패는 지연 생성을 시도하지 않고 no_team_root — 쓰기 전 선행 조회 실패는 중단한다', async () => {
    // snapshot 미지정 → resolveFolderPath 가 내부에서 loadFolderSnapshot(sb) 를 부른다.
    // 그 조회가 실패(data:null,error)하면 snap 은 null. 두 번째 큐 응답(insert 성공)이
    // 소비되면(=지연 생성을 시도했다는 뜻) addToFolderSnapshot(snap!, …) 이 널 역참조로
    // 크래시한다 — 고쳐지지 않았다면 이 테스트는 assertion 이 아니라 uncaught TypeError 로 죽는다.
    const { db, from } = fakeDb([
      { data: null, error: { message: 'boom' } },   // 스냅샷 로드 실패
      { data: { id: 'new-root' } },                  // (버그 상태에서만 소비되는) insert 성공
    ])
    const res = await resolveFolderPath(db, 'PMO', ['PMO'], {
      actorId: 'u1', activeTeamCodes: ['PMO'], create: true, projectId: P1, workspaceId: null,
    })
    expect(!res.ok && res.kind).toBe('no_team_root')
    expect(from).toHaveBeenCalledTimes(1)   // 스냅샷 조회 1회뿐 — insert 시도 없음
  })
})

describe('워크스페이스 스코프 미지정 트리 (0006)', () => {
  const W1 = 'ws-1', W2 = 'ws-2'
  const twoWs = [
    { id: 'w1-mes', name: 'MES', parentId: null, createdBy: null, kind: 'team_root' as const, teamCode: 'MES', projectId: null, workspaceId: W1 },
    { id: 'w1-q', name: '품질', parentId: 'w1-mes', createdBy: 'u1', projectId: null, workspaceId: W1 },
    { id: 'w2-mes', name: 'MES', parentId: null, createdBy: null, kind: 'team_root' as const, teamCode: 'MES', projectId: null, workspaceId: W2 },
  ]

  it('두 워크스페이스의 동명 미지정 루트가 스냅샷에 공존한다(덮어쓰지 않는다)', () => {
    const snap = buildFolderSnapshot(twoWs)
    expect(snap.seedRoots.get(`w:${W1} MES`)).toBe('w1-mes')
    expect(snap.seedRoots.get(`w:${W2} MES`)).toBe('w2-mes')
  })

  it('workspaceId 로 루트를 고른다 — 다른 워크스페이스 트리로 새지 않는다', async () => {
    const snap = buildFolderSnapshot(twoWs)
    const base = { actorId: 'u1', activeTeamCodes: ['MES'], snapshot: snap, create: false, projectId: null }
    const r1 = await resolveFolderPath(fakeSb(), 'MES', ['MES', '품질'], { ...base, workspaceId: W1 })
    expect(r1).toMatchObject({ ok: true, folderId: 'w1-q', complete: true })
    const r2 = await resolveFolderPath(fakeSb(), 'MES', ['MES', '품질'], { ...base, workspaceId: W2 })
    // W2 에는 '품질' 이 없다 — W1 의 것을 재사용하지 않고 W2 루트까지만 실재한다고 보고한다.
    expect(r2).toMatchObject({ ok: true, folderId: 'w2-mes', complete: false })
  })

  it('W2 에 생성한 하위 폴더는 W2 로 스냅샷에 반영된다', async () => {
    const snap = buildFolderSnapshot(twoWs)
    const { db } = fakeDb([{ data: { id: 'w2-q' } }])
    const r = await resolveFolderPath(db, 'MES', ['MES', '품질'], {
      actorId: 'u1', activeTeamCodes: ['MES'], snapshot: snap, projectId: null, workspaceId: W2,
    })
    expect(r).toMatchObject({ ok: true, folderId: 'w2-q', complete: true })
    expect(snap.byId.get('w2-q')?.workspaceId).toBe(W2)
  })

  it('미지정 트리에 workspaceId 가 없으면 루트를 고르지 않는다(no_team_root, fail-closed)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const snap = buildFolderSnapshot(twoWs)
    const r = await resolveFolderPath(fakeSb(), 'MES', ['MES'], {
      actorId: 'u1', activeTeamCodes: ['MES'], snapshot: snap, create: false, projectId: null, workspaceId: null,
    })
    expect(!r.ok && r.kind).toBe('no_team_root')
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('custom 모드 정규화(계약 v2.9 — SP5 B2)', () => {
  const CUSTOM = { mode: 'custom' as const, names: ['외부 연동', '본부 회의'] }
  const ROOT = { id: 'c-ext', name: '외부 연동', parentId: null, createdBy: null, projectId: null, workspaceId: 'ws-1', kind: 'custom_root' as const }
  const base = { actorId: 'u1', activeTeamCodes: TEAMS, projectId: null, workspaceId: 'ws-1', rootMode: CUSTOM }
  it('path[0] 이 그 범위의 지정 루트면 그 아래로 — 한 칸 내림·다른 팀 code 거절이 없다', async () => {
    const snap = buildFolderSnapshot([ROOT, { id: 'c-sub', name: 'MES', parentId: 'c-ext', createdBy: 'u9', projectId: null, workspaceId: 'ws-1', kind: 'user' }])
    const res = await resolveFolderPath(fakeSb(), 'PMO', ['외부 연동', 'MES'], { ...base, snapshot: snap, create: false })
    expect(res).toMatchObject({ ok: true, folderId: 'c-sub', resolvedPath: ['외부 연동', 'MES'], complete: true })
  })
  it('지정 루트가 아직 없어도 설정 names 에 있으면 그 이름의 지정 루트를 만든다', async () => {
    const snap = buildFolderSnapshot([])
    const res = await resolveFolderPath(fakeDb([{ data: { id: 'c-new' } }]).db, 'PMO', ['본부 회의'], { ...base, snapshot: snap })
    expect(res).toMatchObject({ ok: true, folderId: 'c-new', resolvedPath: ['본부 회의'] })
    expect(snap.customRoots.get('w:ws-1 본부 회의')).toBe('c-new')
  })
  it('루트 불일치·빈 경로는 unmatched_root(호출부가 미분류로 저장) — 팀 code 를 루트로 보내도 같다', async () => {
    const snap = buildFolderSnapshot([ROOT])
    for (const path of [['신규TF', '킥오프'], [], ['PMO']]) {
      const res = await resolveFolderPath(fakeSb(), 'PMO', path, { ...base, snapshot: snap })
      expect(!res.ok && res.kind, path.join('/')).toBe('unmatched_root')
    }
  })
  it('깊이 절단은 v2.8 그대로(5단)', async () => {
    const snap = buildFolderSnapshot([ROOT])
    const res = await resolveFolderPath(fakeSb(), 'PMO', ['외부 연동', 'a', 'b', 'c', 'd', 'e'], { ...base, snapshot: snap, create: false })
    expect(res).toMatchObject({ ok: true, truncated: true, targetPath: ['외부 연동', 'a', 'b', 'c', 'd'] })
  })
  it('팀 루트는 code 로 에코하고 지정 루트는 이름으로 — api 경로 언어(v2.9 R1), 화면은 이름', () => {
    const snap = buildFolderSnapshot([
      { id: 'r', name: '품질보증팀', parentId: null, createdBy: null, projectId: null, workspaceId: 'ws-1', kind: 'team_root', teamCode: 'QA' },
      { id: 's', name: '정기', parentId: 'r', createdBy: 'u9', projectId: null, workspaceId: 'ws-1', kind: 'user' },
      ROOT,
    ])
    expect(folderPathOfSnapshot(snap, 's')).toEqual(['QA', '정기'])
    expect(folderPathOfSnapshot(snap, 's', 'display')).toEqual(['품질보증팀', '정기'])
    expect(folderPathOfSnapshot(snap, 'c-ext')).toEqual(['외부 연동'])
  })
})
