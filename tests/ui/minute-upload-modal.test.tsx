// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { MinuteFolder } from '@/lib/domain/types'
import type { AttachmentPolicy } from '@/lib/minutes/attachmentPolicy'
import { withTeams } from '../fixtures/teams'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (k: string) => k, locale: 'ko' }),
}))
const toastSpy = vi.hoisted(() => vi.fn())
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: toastSpy }) }))
const M = 'cccccccc-3333-4333-8333-333333333333'
// 인자 시그니처를 제네릭으로 명시 — 인자 없는 vi.fn 은 mock.calls 가 빈 튜플로 추론돼 tsc(TS2493)가 깨진다
const createMinute = vi.fn<(input: unknown, folderId: string | null) => Promise<{ ok: boolean; id: string }>>(
  async () => ({ ok: true, id: M }))
const recordMinuteFile = vi.fn<(...a: unknown[]) => Promise<{ ok: boolean }>>(async () => ({ ok: true }))
const fetchMinuteFoldersLite = vi.fn<() => Promise<MinuteFolder[]>>(async () => tree)
type MeetingsLite = { ok: true; meetings: { id: string; title: string; meetingDate: string }[] } | { ok: false; error: string }
const fetchProjectMeetingsLite = vi.fn<(pid: string) => Promise<MeetingsLite>>(async () => ({ ok: true, meetings: [] }))
const POLICY: AttachmentPolicy = { enabled: true, maxFileBytes: 20_971_520, maxCount: 10, maxTotalBytes: 209_715_200, allowedExtensions: null, previewEnabled: true }
type PolicyRes = { ok: true; policy: AttachmentPolicy } | { ok: false; error: string }
const fetchAttachmentPolicyForScope = vi.fn<(scope: unknown) => Promise<PolicyRes>>(async () => ({ ok: true, policy: POLICY }))
vi.mock('@/app/actions/minutes', () => ({
  createMinute: (...a: unknown[]) => createMinute(...(a as [unknown, string | null])),
  recordMinuteFile: (...a: unknown[]) => recordMinuteFile(...a),
  fetchProjectMeetingsLite: (pid: string) => fetchProjectMeetingsLite(pid),
  fetchMinuteFoldersLite: () => fetchMinuteFoldersLite(),
  fetchAttachmentPolicyForScope: (scope: unknown) => fetchAttachmentPolicyForScope(scope),
}))
const upload = vi.fn(async () => ({ error: null }))
vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({ storage: { from: () => ({ upload, remove: vi.fn(async () => ({})) }) } }),
}))

import { MinuteUploadModal } from '@/components/minutes/MinuteUploadModal'
import { MinutesScopeProvider } from '@/components/minutes/MinutesScopeContext'

const WS = 'aaaaaaaa-1111-4111-8111-111111111111'
const P1 = 'bbbbbbbb-1111-4111-8111-111111111111'
const P2 = 'bbbbbbbb-2222-4222-8222-222222222222'
const P3 = 'bbbbbbbb-3333-4333-8333-333333333333'

const F = (
  id: string, name: string, parentId: string | null = null,
  createdBy: string | null = null, sort = 0,
): MinuteFolder => ({
  id, name, parentId, sort, createdBy, projectId: null,
  // SP5 B2 — 시드 루트(옛 created_by null)는 kind = team_root + 팀 code(조인). 이 표본의 루트 이름은 팀 code 와 같다
  ...(parentId === null && createdBy === null ? { kind: 'team_root' as const, teamCode: name } : { kind: 'user' as const }),
})

// sort 는 프로덕션 시드값(0043) — 트리 표시 순서가 이 값에서 유도되므로 순서가 계약
const tree: MinuteFolder[] = [
  F('r-pmo', 'PMO', null, null, 0),
  F('r-erp', 'ERP', null, null, 1),
  F('c-sales', '영업', 'r-erp', null, 0), F('c-buy', '구매', 'r-erp', null, 1), F('c-acc', '관리회계', 'r-erp', null, 2),
  F('r-mes', 'MES', null, null, 2),
  F('c-q', '품질', 'r-mes', null, 0), F('c-plan', '생산계획', 'r-mes', null, 1),
]

describe('MinuteUploadModal — 폴더 직접 선택', () => {
  let container: HTMLDivElement, root: Root
  const onSaved = vi.fn()
  beforeEach(() => {
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
    createMinute.mockClear(); recordMinuteFile.mockClear(); upload.mockClear(); onSaved.mockClear(); fetchProjectMeetingsLite.mockClear()
    fetchMinuteFoldersLite.mockImplementation(async () => tree)
    fetchAttachmentPolicyForScope.mockReset()
    fetchAttachmentPolicyForScope.mockImplementation(async () => ({ ok: true, policy: POLICY }))
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  async function mount(over: Partial<Parameters<typeof MinuteUploadModal>[0]> = {}) {
    await act(async () => root.render(withTeams(
      <MinuteUploadModal open onClose={() => {}} onSaved={onSaved} todayIso="2026-07-24"
        projects={[]} folders={tree} defaultFolderId={null}
        projectWorkspaces={{ [P1]: WS, [P2]: WS, [P3]: WS }} noProjectWorkspace={{ ok: true, workspaceId: WS }} {...over} />,
    )))
  }
  const dialogs = () => [...document.querySelectorAll<HTMLElement>('[role="dialog"]')]
  const mainDialog = () => dialogs()[0]
  const pickerDialog = () => dialogs()[dialogs().length - 1]
  const folderFieldBtn = () =>
    [...mainDialog().querySelectorAll<HTMLButtonElement>('button')].find(b => b.getAttribute('type') === 'button')!
  const openPicker = async () => { await act(async () => folderFieldBtn().click()) }
  const pickFolder = async (label: string) => {
    const btn = [...pickerDialog().querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === label)!
    await act(async () => btn.click())
  }
  const attachBodyFile = async (name = '구매정례.md') => {
    const file = new File(['# 회의록 본문'], name, { type: 'text/markdown' })
    const input = mainDialog().querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
  }
  const clickSave = async () => {
    const saveBtn = [...mainDialog().querySelectorAll<HTMLButtonElement>('button')]
      .find(b => b.textContent === 'min.form.save')!
    await act(async () => saveBtn.click())
  }

  it('탐색기에서 보던 폴더(품질)를 보며 열면 폴더 필드가 그 이름으로 초기화', async () => {
    await mount({ defaultFolderId: 'c-q' })
    expect(folderFieldBtn().textContent).toContain('품질')
  })

  it('defaultFolderId 없으면 미분류로 초기화', async () => {
    await mount()
    expect(folderFieldBtn().textContent).toContain('min.fold.unfiled')
  })

  it('폴더 필드 클릭 → 트리 픽커가 뜨고, 하위 폴더 선택 시 필드에 반영되며 픽커가 닫힌다', async () => {
    await mount()
    await openPicker()
    expect(dialogs().length).toBe(2)
    await pickFolder('구매')
    expect(dialogs().length).toBe(1)
    expect(folderFieldBtn().textContent).toContain('구매')
  })

  it('저장 시 createMinute 에 선택한 폴더 id 그대로 전달, 담당은 그 폴더 소속 팀으로 파생', async () => {
    await mount()
    await openPicker()
    await pickFolder('구매')
    await attachBodyFile()
    await clickSave()
    expect(createMinute).toHaveBeenCalledTimes(1)
    expect(createMinute.mock.calls[0][0]).toMatchObject({ teamCode: 'ERP' })
    expect(createMinute.mock.calls[0][1]).toBe('c-buy')
    expect(onSaved).toHaveBeenCalled()
  })

  it('미분류 선택 시 defaultTeam 폴백으로 담당 파생, createMinute 에는 폴더 id null 전달', async () => {
    await mount({ defaultFolderId: 'c-q', defaultTeam: 'MDM' })
    await openPicker()
    await pickFolder('min.fold.unfiled')
    await attachBodyFile()
    await clickSave()
    expect(createMinute.mock.calls[0][0]).toMatchObject({ teamCode: 'MDM' })
    expect(createMinute.mock.calls[0][1]).toBe(null)
  })

  it('defaultTeam 도 없으면 활성 팀 1순위(PMO)로 담당 파생', async () => {
    await mount()   // defaultFolderId=null → 시작부터 미분류
    await attachBodyFile()
    await clickSave()
    expect(createMinute.mock.calls[0][0]).toMatchObject({ teamCode: 'PMO' })
  })

  it.each([
    ['calendar_unavailable', 'min.timeFix.skippedCalendar'],
    ['invalid_time', 'min.timeFix.skippedInvalidTime'],
  ] as const)('업로드 결과의 timeFixWarning=%s 이면 경고 토스트(원문 시각 그대로라는 사실 — A-4 리뷰 N4, A-5 리뷰 O6)', async (warning, description) => {
    toastSpy.mockClear()
    createMinute.mockResolvedValueOnce({ ok: true, id: M, timeFixWarning: warning } as never)
    await mount()
    await attachBodyFile()
    await clickSave()
    expect(toastSpy).toHaveBeenCalledWith({ title: 'min.timeFix.skippedTitle', description, variant: 'info' })
    expect(onSaved).toHaveBeenCalled()
  })

  it('경고가 없으면 경고 토스트가 없다', async () => {
    toastSpy.mockClear()
    await mount()
    await attachBodyFile()
    await clickSave()
    expect(toastSpy).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'min.timeFix.skippedTitle' }))
  })

  it('열림 시 재조회 응답의 새 폴더가 픽커에 반영된다', async () => {
    fetchMinuteFoldersLite.mockImplementation(async () => [...tree, F('u-new', '신규폴더', 'r-mes', 'u1', 100)])
    await mount()
    await openPicker()
    expect([...pickerDialog().querySelectorAll('button')].some(b => b.textContent === '신규폴더')).toBe(true)
  })

  it('회의록 화면 범위가 있으면 재조회 결과를 그 워크스페이스 폴더로 거른다 — 다른 소속 워크스페이스 폴더를 고를 수 없다(D26, V5)', async () => {
    const WB = 'aaaaaaaa-2222-4222-8222-222222222222'
    const inWs = (f: MinuteFolder, w: string): MinuteFolder => ({ ...f, workspaceId: w })
    fetchMinuteFoldersLite.mockImplementation(async () => [
      ...tree.map(f => inWs(f, WS)), inWs(F('u-mine', '이워크스페이스폴더', 'r-mes', 'u1', 100), WS), inWs(F('u-other', '다른워크스페이스폴더', null, 'u1', 101), WB),
    ])
    await act(async () => root.render(withTeams(
      <MinutesScopeProvider scope={{ workspaceId: WS, projectId: null }}>
        <MinuteUploadModal open onClose={() => {}} onSaved={onSaved} todayIso="2026-07-24"
          projects={[]} folders={tree} defaultFolderId={null}
          projectWorkspaces={{ [P1]: WS }} noProjectWorkspace={{ ok: true, workspaceId: WS }} />
      </MinutesScopeProvider>,
    )))
    await openPicker()
    const labels = [...pickerDialog().querySelectorAll('button')].map(b => b.textContent)
    expect(labels).toContain('이워크스페이스폴더')
    expect(labels).not.toContain('다른워크스페이스폴더')
  })

  it('프로젝트가 하나뿐이면 기본 선택 — 고르지 않아 미연결로 쌓이는 것을 막는다', async () => {
    await mount({ projects: [{ id: P1, name: 'Acme 프로젝트' }] })
    await attachBodyFile()
    await clickSave()
    expect(createMinute.mock.calls[0][0]).toMatchObject({ projectId: P1 })
  })

  it('여러 프로젝트 중 내가 멤버인 것이 하나면 그것으로 자동 선택', async () => {
    await mount({
      projects: [{ id: P1, name: 'A' }, { id: P2, name: 'B' }],
      myProjectIds: [P2],
    })
    await attachBodyFile()
    await clickSave()
    expect(createMinute.mock.calls[0][0]).toMatchObject({ projectId: P2 })
  })

  it('내가 여러 프로젝트 멤버면 자동 선택하지 않는다 — 사람이 고른다', async () => {
    await mount({
      projects: [{ id: P1, name: 'A' }, { id: P2, name: 'B' }],
      myProjectIds: [P1, P2],
    })
    await attachBodyFile()
    await clickSave()
    expect(createMinute.mock.calls[0][0]).toMatchObject({ projectId: null })
  })

  it('내 프로젝트가 셀렉트 앞쪽에 온다 — 여럿일 때 고르는 비용을 줄인다', async () => {
    await mount({
      projects: [{ id: P1, name: 'A' }, { id: P2, name: 'B' }, { id: P3, name: 'C' }],
      myProjectIds: [P3, P2],
    })
    // 내 것이 앞으로 오되 그룹 안에서는 원래 목록 순서를 지킨다(sortMyProjectsFirst 계약)
    const opts = [...mainDialog().querySelectorAll('option')].map(o => o.value).filter(Boolean)
    expect(opts).toEqual([P2, P3, P1])
  })

  it('프로젝트가 둘 이상이고 소속 정보가 없으면 기본 선택하지 않는다', async () => {
    await mount({ projects: [{ id: P1, name: 'A' }, { id: P2, name: 'B' }] })
    await attachBodyFile()
    await clickSave()
    expect(createMinute.mock.calls[0][0]).toMatchObject({ projectId: null })
  })

  it('프로젝트가 없으면 종전대로 미연결', async () => {
    await mount()
    await attachBodyFile()
    await clickSave()
    expect(createMinute.mock.calls[0][0]).toMatchObject({ projectId: null })
  })

  /* ── 폴더 픽커 프로젝트 스코프(0076) ── */

  const projectSelect = () => mainDialog().querySelector<HTMLSelectElement>('select')!
  async function chooseProject(pid: string) {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!
      setter.call(projectSelect(), pid)
      projectSelect().dispatchEvent(new Event('change', { bubbles: true }))
    })
  }

  it('폴더 픽커는 선택된 프로젝트 소속 폴더만 보여준다 — 교차 프로젝트 편철은 서버도 거부한다', async () => {
    const scoped: MinuteFolder[] = [
      { id: 'r-a', name: '루트A', parentId: null, sort: 0, createdBy: null, projectId: 'pA' },
      { id: 'r-b', name: '루트B', parentId: null, sort: 1, createdBy: null, projectId: 'pB' },
    ]
    fetchMinuteFoldersLite.mockImplementation(async () => scoped)
    await mount({ folders: scoped, projects: [{ id: 'pA', name: 'A' }, { id: 'pB', name: 'B' }] })
    await chooseProject('pA')
    await openPicker()
    expect([...pickerDialog().querySelectorAll('button')].some(b => b.textContent === '루트A')).toBe(true)
    expect([...pickerDialog().querySelectorAll('button')].some(b => b.textContent === '루트B')).toBe(false)
  })

  it('프로젝트를 바꾸면 스코프 밖 폴더 선택이 미분류로 해제된다', async () => {
    const scoped: MinuteFolder[] = [
      { id: 'r-a', name: '루트A', parentId: null, sort: 0, createdBy: null, projectId: 'pA' },
      { id: 'r-b', name: '루트B', parentId: null, sort: 1, createdBy: null, projectId: 'pB' },
    ]
    fetchMinuteFoldersLite.mockImplementation(async () => scoped)
    // myProjectIds로 pA를 자동 선택시켜 폴더(r-a)·프로젝트(pA)가 처음부터 정합하게 시작한다
    await mount({
      folders: scoped, defaultFolderId: 'r-a', myProjectIds: ['pA'],
      projects: [{ id: 'pA', name: 'A' }, { id: 'pB', name: 'B' }],
    })
    expect(folderFieldBtn().textContent).toContain('루트A')
    await chooseProject('pB')
    expect(folderFieldBtn().textContent).toContain('min.fold.unfiled')
  })

  it('같은 프로젝트를 유지하거나 스코프 안의 폴더면 선택을 건드리지 않는다', async () => {
    const scoped: MinuteFolder[] = [
      { id: 'r-a', name: '루트A', parentId: null, sort: 0, createdBy: null, projectId: 'pA' },
    ]
    fetchMinuteFoldersLite.mockImplementation(async () => scoped)
    await mount({
      folders: scoped, defaultFolderId: 'r-a', myProjectIds: ['pA'],
      projects: [{ id: 'pA', name: 'A' }, { id: 'pB', name: 'B' }],
    })
    expect(folderFieldBtn().textContent).toContain('루트A')
    await chooseProject('pA')   // 이미 그 프로젝트 소속 — 무접촉
    expect(folderFieldBtn().textContent).toContain('루트A')
  })

  it('탐색기에서 보던 폴더가 자동 선택된 프로젝트 밖이면 초기값으로 쓰지 않는다', async () => {
    const scoped: MinuteFolder[] = [
      { id: 'r-a', name: '루트A', parentId: null, sort: 0, createdBy: null, projectId: 'pA' },
      { id: 'r-b', name: '루트B', parentId: null, sort: 1, createdBy: null, projectId: 'pB' },
    ]
    fetchMinuteFoldersLite.mockImplementation(async () => scoped)
    // pB가 자동 선택(내 유일 소속)되는데 탐색기에서 보던 폴더는 pA 소속 — 어긋난 채로 보여주지 않는다
    await mount({
      folders: scoped, defaultFolderId: 'r-a', myProjectIds: ['pB'],
      projects: [{ id: 'pA', name: 'A' }, { id: 'pB', name: 'B' }],
    })
    expect(folderFieldBtn().textContent).toContain('min.fold.unfiled')
  })
  /* ── 저장 경로 규약(SP2 B1) — ws/<wid>/p/<pid|_>/<entity>/<id>/<파일> ── */

  const attachFiles = async (files: File[]) => {
    const input = mainDialog().querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(input, 'files', { value: files, configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
  }
  const uploadedPaths = () => (upload.mock.calls as unknown as [string][]).map(c => c[0])

  it('무프로젝트: 본문은 p/_/minutes/<후보 id>, 첨부는 p/_/minute-files/<회의록 id> — 후보 id 가 createMinute 로 간다', async () => {
    await mount()
    await attachFiles([new File(['# 본문'], 'a.md', { type: 'text/markdown' }), new File(['x'], '첨부 파일.pdf')])
    await clickSave()
    const [bodyPath, attPath] = uploadedPaths()
    const cand = (createMinute.mock.calls[0] as unknown as [unknown, unknown, { minuteId: string; file: { filePath: string } }])[2]
    expect(bodyPath).toMatch(new RegExp(`^ws/${WS}/p/_/minutes/${cand.minuteId}/\\d+-a\\.md$`))
    expect(cand.file.filePath).toBe(bodyPath)
    expect(attPath).toMatch(new RegExp(`^ws/${WS}/p/_/minute-files/${M}/\\d+-`))
    expect(recordMinuteFile).toHaveBeenCalledWith(M, expect.objectContaining({ role: 'attachment', filePath: attPath }))
  })

  // SP5 B3 — 새 회의록도 저장할 범위의 유효 정책으로 사전 확인한다(상세 패널과 같은 판정, 최종은 DB 가드)
  it('정책은 저장할 범위(워크스페이스 + 선택 프로젝트)로 묻는다', async () => {
    await mount({ projects: [{ id: P1, name: 'A' }] })
    expect(fetchAttachmentPolicyForScope).toHaveBeenLastCalledWith({ workspaceId: WS, projectId: P1 })
  })
  it('범위 정책의 개수 한도를 넘는 첨부는 고를 때 거부 — 회의록을 만들지 않는다', async () => {
    fetchAttachmentPolicyForScope.mockImplementation(async () => ({ ok: true, policy: { ...POLICY, maxCount: 1, maxTotalBytes: POLICY.maxFileBytes } }))
    await mount()
    await attachFiles([new File(['# 본문'], 'a.md', { type: 'text/markdown' }), new File(['x'], 'b.pdf'), new File(['y'], 'c.pdf')])
    expect(mainDialog().textContent).toContain('c.pdf: min.att.reject.LIMIT')
    await clickSave()
    expect(createMinute).not.toHaveBeenCalled()
  })
  it('범위 정책의 허용 형식 밖이면 거부', async () => {
    fetchAttachmentPolicyForScope.mockImplementation(async () => ({ ok: true, policy: { ...POLICY, allowedExtensions: ['png'] } }))
    await mount()
    await attachFiles([new File(['x'], 'b.pdf')])
    expect(mainDialog().textContent).toContain('b.pdf: min.att.reject.EXTENSION')
  })
  it('정책을 못 읽으면 첨부만 막는다 — 본문만인 회의록은 저장된다', async () => {
    fetchAttachmentPolicyForScope.mockImplementation(async () => ({ ok: false, error: '첨부 설정을 불러오지 못했습니다.' }))
    await mount()
    await attachFiles([new File(['# 본문'], 'a.md', { type: 'text/markdown' }), new File(['x'], 'b.pdf')])
    expect(mainDialog().textContent).toContain('첨부 설정을 불러오지 못했습니다.')
    await attachBodyFile()
    await clickSave()
    expect(createMinute).toHaveBeenCalledTimes(1)
    expect(recordMinuteFile).not.toHaveBeenCalled()
  })

  it('프로젝트 회의록: 경로의 워크스페이스·프로젝트는 그 프로젝트의 것', async () => {
    const W2 = 'dddddddd-4444-4444-8444-444444444444'
    await mount({ projects: [{ id: P1, name: 'A' }], projectWorkspaces: { [P1]: W2 } })
    await attachBodyFile()
    await clickSave()
    expect(uploadedPaths()[0]).toMatch(new RegExp(`^ws/${W2}/p/${P1}/minutes/`))
  })

  it('저장 경로를 만들 수 없으면(워크스페이스 id 불량) 조용히 멈추지 않고 사유를 보인다 — 업로드·생성 미도달', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await mount({ noProjectWorkspace: { ok: true, workspaceId: 'not-a-uuid' } })
    await attachBodyFile()
    await clickSave()
    expect(mainDialog().textContent).toContain('저장 경로 입력이 올바르지 않습니다.')
    expect(upload).not.toHaveBeenCalled()
    expect(createMinute).not.toHaveBeenCalled()
    // 저장 중 표시가 풀려 다시 시도할 수 있다
    const saveBtn = [...mainDialog().querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'min.form.save')
    expect(saveBtn).toBeDefined()
    spy.mockRestore()
  })

  it('무프로젝트 워크스페이스를 못 정하면 저장을 막고 사유를 보인다', async () => {
    await mount({ noProjectWorkspace: { ok: false, error: '워크스페이스를 지정해야 합니다.' } })
    await attachBodyFile()
    expect(mainDialog().textContent).toContain('워크스페이스를 지정해야 합니다.')
    const saveBtn = [...mainDialog().querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'min.form.save')!
    expect(saveBtn.disabled).toBe(true)
    await clickSave()
    expect(upload).not.toHaveBeenCalled()
    expect(createMinute).not.toHaveBeenCalled()
  })

  const meetingsAlert = () =>
    [...mainDialog().querySelectorAll('[role="alert"]')].find(e => e.textContent === 'min.meetingsLoadFailed')

  it('기본 프로젝트의 회의 목록 조회 실패는 드롭다운 아래 사유로 알린다 — 연결할 회의가 없는 것처럼 보이지 않게', async () => {
    fetchProjectMeetingsLite.mockResolvedValueOnce({ ok: false, error: '회의 일정을 불러오지 못했습니다.' })
    await mount({ projects: [{ id: P1, name: 'A' }], myProjectIds: [P1] })
    expect(fetchProjectMeetingsLite).toHaveBeenCalledWith(P1)
    expect(meetingsAlert()).toBeDefined()
  })

  it('회의 목록 정상 조회면 사유가 없다', async () => {
    await mount({ projects: [{ id: P1, name: 'A' }], myProjectIds: [P1] })
    expect(fetchProjectMeetingsLite).toHaveBeenCalledWith(P1)
    expect(meetingsAlert()).toBeUndefined()
  })

  it('프로젝트를 바꿀 때 회의 목록 액션이 던져도 사유로 알린다 — 처리되지 않은 rejection 으로 새지 않는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await mount({ projects: [{ id: P1, name: 'A' }, { id: P2, name: 'B' }], myProjectIds: [P1] })
    expect(meetingsAlert()).toBeUndefined()
    fetchProjectMeetingsLite.mockRejectedValueOnce(new Error('network'))
    const projectSelect = mainDialog().querySelector<HTMLSelectElement>('select')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!.call(projectSelect, P2)
      projectSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(fetchProjectMeetingsLite).toHaveBeenLastCalledWith(P2)
    expect(meetingsAlert()).toBeDefined()
    expect(spy).toHaveBeenCalledWith('[MinuteUploadModal] 회의 목록 조회 실패:', expect.any(Error))
    spy.mockRestore()
  })
})
