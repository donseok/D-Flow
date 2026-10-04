import type { FieldDef } from '@/lib/domain/customFields'
import { TEST_AREAS, REQUIRED_ENTRY_CONTEXT, TEST_ENTRY_CONTEXT } from '../fixtures/issue-areas'
// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const router = { refresh: vi.fn() }
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/p/p1/issues' }))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ locale: 'ko', t: (key: string) => key }),
}))
const { fetchIssueMajorProcesses } = vi.hoisted(() => ({
  fetchIssueMajorProcesses: vi.fn(),
}))
vi.mock('@/app/actions/issues', () => ({
  createIssue: vi.fn(async () => ({ ok: true, id: 'default-issue' })),
  updateIssue: vi.fn(async () => ({ ok: true })),
  updateIssueProgress: vi.fn(async () => ({ ok: true })),
  deleteIssue: vi.fn(async () => ({ ok: true })),
  fetchIssueMajorProcesses,
}))
// 상세 모달이 조치 경과 이력을 조회한다(0087). 서버 액션이라 여기서 막지 않으면
// 아래 IssueDetailModal 렌더 테스트가 멈춘다 — deep-link-params 와 같은 이유다.
vi.mock('@/app/actions/issueUpdates', () => ({
  listIssueUpdates:     vi.fn(async () => ({ ok: true, items: [] })),
  addIssueUpdate:       vi.fn(async () => ({ ok: true })),
  archiveIssueUpdate:   vi.fn(async () => ({ ok: true })),
  unarchiveIssueUpdate: vi.fn(async () => ({ ok: true })),
  purgeIssueUpdate:     vi.fn(async () => ({ ok: true })),
}))

import { DeleteIssueModal, IssueDetailModal, IssueFormModal } from '@/components/issues/IssueModals'
import type { Issue } from '@/lib/domain/issues'
import { SEVERITIES, SOURCES } from '../fixtures/vocab'

describe('IssueFormModal 회의록 초안', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    router.refresh.mockClear()
    fetchIssueMajorProcesses.mockReset().mockResolvedValue({ ok: true, majors: [] })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.querySelectorAll('[role="dialog"]').forEach(node => node.remove())
  })

  function labelInput(labelKey: string): HTMLInputElement {
    const label = [...document.querySelectorAll('label')]
      .find(node => node.textContent?.includes(labelKey))
    const input = label?.querySelector('input')
    if (!(input instanceof HTMLInputElement)) throw new Error(`${labelKey} input not found`)
    return input
  }

  function labelSelect(labelKey: string): HTMLSelectElement {
    const label = [...document.querySelectorAll('label')]
      .find(node => node.textContent?.includes(labelKey))
    const select = label?.querySelector('select') ?? (label?.htmlFor ? document.getElementById(label.htmlFor) : null)
    if (!(select instanceof HTMLSelectElement)) throw new Error(`${labelKey} select not found`)
    return select
  }

  const analysisDraft = { areaId: '02' as const, analysis: { majorName: ' 주문관리 ', subProcess: ' 주문접수/등록 ', ownerDepartment: ' 영업관리팀 ', relatedSystems: [' SAP ', 'MES', 'SAP'] } }

  const issue = (over: Partial<Issue> = {}): Issue => ({
    codeAreaId: '02',
    id: 'issue-1',
    issueNo: 17,
    projectId: 'project-1',
    title: '주문 처리 지연',
    body: '주문 승인 대기 시간이 길다.',
    status: 'open',
    severity: 'high',
    assigneeMemberIds: [],
    startDate: null,
    dueDate: null,
    minuteSources: [],
    resolutionNote: '',
    resolvedAt: null,
    createdBy: 'user-1',
    createdByName: '홍길동',
    createdAt: '2026-07-27T00:00:00Z',
    updatedAt: '2026-07-27T00:00:00Z',
    areaId: '02',

    code: 'PI-I-02-03',
    majorId: 'major-1',
    majorSeq: 1,
    majorName: '주문관리',
    subProcess: '주문접수/등록',
    ownerDepartment: '영업관리팀',
    relatedSystems: ['SAP', 'MES'],
    sourceType: 'interview',
    sourceDetail: '영업관리팀 인터뷰',
    ...over,
  })

  it('선택 블록·기간 초안을 표시하고 커스텀 생성 액션으로 전달한다', async () => {
    const onCreate = vi.fn(async () => ({ ok: true, id: 'linked-issue' }))
    const onCreated = vi.fn()
    const onClose = vi.fn()
    await act(async () => {
      root.render(
        <IssueFormModal entryContext={REQUIRED_ENTRY_CONTEXT}
          open
          onClose={onClose}
          projectId="project-1"
          workspaceId={null}
          initial={null}
          members={[]}
          draft={{ ...analysisDraft, title: '전환 지연 위험', body: '인터페이스 전환 지연 위험을 확인한다.', severity: 'high', startDate: '2026-07-27', dueDate: '2026-08-03', analysis: { ...analysisDraft.analysis, sourceType: 'other' } }}
          sourcePreview={{
            title: '주간회의',
            date: '2026-07-27',
            excerpt: '인터페이스 전환 지연 위험을 확인한다.',
            organizedDraft: true,
            classificationRecommended: true,
          }}
          onCreate={onCreate}
          onCreated={onCreated}
        />,
      )
    })

    expect(document.body.textContent).toContain('주간회의')
    expect(document.body.textContent).toContain('인터페이스 전환 지연 위험을 확인한다.')
    expect(labelInput('issue.form.title').value).toBe('전환 지연 위험')
    expect(labelInput('issue.form.start').value).toBe('2026-07-27')
    expect(labelInput('issue.form.due').value).toBe('2026-08-03')
    expect(labelSelect('issue.analysis.area').value).toBe('02')
    expect(labelInput('issue.analysis.majorProcess').value).toBe(' 주문관리 ')
    expect(labelSelect('issue.analysis.sourceType').value).toBe('minutes')
    expect(labelSelect('issue.analysis.sourceType').disabled).toBe(true)
    expect(labelInput('issue.analysis.sourceDetail').value).toBe('주간회의 · 2026-07-27')
    expect(document.body.textContent).toContain('issue.analysis.minuteAutoLinked')
    expect(document.body.textContent).toContain('issue.analysis.organizedDraft')
    expect(document.body.textContent).toContain('issue.analysis.classificationRecommended')
    expect(document.body.textContent).toContain('issue.analysis.areaRecommended')
    expect(document.body.textContent).toContain('issue.analysis.majorProcessRecommended')
    expect(document.body.textContent).toContain('issue.analysis.subProcessRecommended')

    await act(async () => {
      const mega = labelSelect('issue.analysis.area')
      mega.value = '07'
      mega.dispatchEvent(new Event('change', { bubbles: true }))
      const process = labelInput('issue.analysis.subProcess')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!
        .set!.call(process, '원가손익분석')
      process.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(document.body.textContent).not.toContain('issue.analysis.areaRecommended')
    expect(document.body.textContent).not.toContain('issue.analysis.majorProcessRecommended')
    expect(document.body.textContent).not.toContain('issue.analysis.subProcessRecommended')

    const save = [...document.querySelectorAll('button')]
      .find(button => button.textContent === 'issue.form.save') as HTMLButtonElement
    await act(async () => {
      save.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(onCreate).toHaveBeenCalledWith('project-1', expect.objectContaining({ title: '전환 지연 위험', body: '인터페이스 전환 지연 위험을 확인한다.', severity: 'high', startDate: '2026-07-27', dueDate: '2026-08-03', areaId: '07', analysis: { majorName: '주문관리', subProcess: '원가손익분석', ownerDepartment: '영업관리팀', relatedSystems: ['SAP', 'MES'], sourceType: 'minutes', sourceDetail: '주간회의 · 2026-07-27' } }))
    expect(onCreated).toHaveBeenCalledWith('linked-issue', { ok: true, id: 'linked-issue' })
    expect(onClose).toHaveBeenCalled()
  })

  it('역전된 기간은 서버 호출 전에 막는다', async () => {
    const onCreate = vi.fn(async () => ({ ok: true, id: 'should-not-create' }))
    await act(async () => {
      root.render(
        <IssueFormModal entryContext={REQUIRED_ENTRY_CONTEXT}
          open
          onClose={() => undefined}
          projectId="project-1"
          workspaceId={null}
          initial={null}
          members={[]}
          draft={{
            title: '기간 확인',
            startDate: '2026-08-04',
            dueDate: '2026-08-03',
          }}
          onCreate={onCreate}
        />,
      )
    })

    const save = [...document.querySelectorAll('button')]
      .find(button => button.textContent === 'issue.form.save') as HTMLButtonElement
    act(() => save.click())

    expect(onCreate).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('issue.err.dateRange')
  })

  it('저장 요청 중에는 취소로 닫거나 같은 요청을 중복 전송하지 않는다', async () => {
    let finish!: (value: { ok: true; id: string }) => void
    const onCreate = vi.fn(() => new Promise<{ ok: true; id: string }>(resolve => {
      finish = resolve
    }))
    const onClose = vi.fn()
    await act(async () => {
      root.render(
        <IssueFormModal entryContext={REQUIRED_ENTRY_CONTEXT}
          open
          onClose={onClose}
          projectId="project-1"
          workspaceId={null}
          initial={null}
          members={[]}
          draft={{ ...analysisDraft, title: '중복 생성 방지' }}
          onCreate={onCreate}
        />,
      )
    })

    const save = [...document.querySelectorAll('button')]
      .find(button => button.textContent === 'issue.form.save') as HTMLButtonElement
    const cancel = [...document.querySelectorAll('button')]
      .find(button => button.textContent === 'issue.form.cancel') as HTMLButtonElement
    await act(async () => {
      save.click()
      save.click()
      cancel.click()
      await Promise.resolve()
    })

    expect(onCreate).toHaveBeenCalledOnce()
    expect(onClose).not.toHaveBeenCalled()

    await act(async () => {
      finish({ ok: true, id: 'linked-issue' })
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('일반 신규는 기타 원천으로 시작하고 필수 분석 정보와 관련 시스템을 정규화한다', async () => {
    const onCreate = vi.fn(async () => ({ ok: true, id: 'manual-issue' }))
    await act(async () => {
      root.render(
        <IssueFormModal entryContext={REQUIRED_ENTRY_CONTEXT}
          open
          onClose={() => undefined}
          projectId="project-1"
          workspaceId={null}
          initial={null}
          members={[]}
          draft={{ ...analysisDraft, title: '수기 등록 이슈' }}
          onCreate={onCreate}
        />,
      )
    })

    expect(labelSelect('issue.analysis.sourceType').value).toBe('other')
    expect(labelSelect('issue.analysis.sourceType').disabled).toBe(false)

    const save = [...document.querySelectorAll('button')]
      .find(button => button.textContent === 'issue.form.save') as HTMLButtonElement
    await act(async () => {
      save.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(onCreate).toHaveBeenCalledWith('project-1', expect.objectContaining({ areaId: '02', analysis: { majorName: '주문관리', subProcess: '주문접수/등록', ownerDepartment: '영업관리팀', relatedSystems: ['SAP', 'MES'], sourceType: 'other', sourceDetail: '' } }))
  })

  it('열릴 때 프로젝트 Major 정본을 불러와 선택 Mega의 후보만 자동완성으로 보여준다', async () => {
    fetchIssueMajorProcesses.mockResolvedValue({
      ok: true,
      majors: [
        { id: 'major-1', projectId: 'project-1', areaId: '02', majorSeq: 1, name: '주문관리' },
        { id: 'major-2', projectId: 'project-1', areaId: '07', majorSeq: 2, name: '원가배부' },
      ],
    })
    await act(async () => {
      root.render(
        <IssueFormModal entryContext={REQUIRED_ENTRY_CONTEXT}
          open
          onClose={() => undefined}
          projectId="project-1"
          workspaceId={null}
          initial={null}
          members={[]}
          draft={{ ...analysisDraft, title: 'Major 자동완성' }}
        />,
      )
    })

    expect(fetchIssueMajorProcesses).toHaveBeenCalledWith('project-1')
    const options = () => [...document.querySelectorAll('#issue-major-process-options option')]
      .map(option => ({ value: (option as HTMLOptionElement).value, label: option.textContent }))
    // Mega '02' 선택 상태 — 같은 Mega의 정본만 '코드 · 이름' 표기로 노출된다.
    expect(options()).toEqual([{ value: '주문관리', label: '02.01 · 주문관리' }])

    await act(async () => {
      const mega = labelSelect('issue.analysis.area')
      mega.value = '07'
      mega.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(options()).toEqual([{ value: '원가배부', label: '07.02 · 원가배부' }])
  })

  it('Mega·Sub Process·주관 부서·원천 누락은 서버 호출 전에 막는다', async () => {
    const onCreate = vi.fn(async () => ({ ok: true, id: 'should-not-create' }))
    await act(async () => {
      root.render(
        <IssueFormModal entryContext={REQUIRED_ENTRY_CONTEXT}
          open
          onClose={() => undefined}
          projectId="project-1"
          workspaceId={null}
          initial={null}
          members={[]}
          draft={{ title: '분석 정보 누락' }}
          onCreate={onCreate}
        />,
      )
    })

    const save = [...document.querySelectorAll('button')]
      .find(button => button.textContent === 'issue.form.save') as HTMLButtonElement
    act(() => save.click())

    expect(onCreate).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('issue.err.areaRequired')
  })

  it('Major Process 누락은 Mega 다음·Sub Process 이전 순서로 서버 호출 전에 막는다', async () => {
    const onCreate = vi.fn(async () => ({ ok: true, id: 'should-not-create' }))
    await act(async () => {
      root.render(
        <IssueFormModal entryContext={REQUIRED_ENTRY_CONTEXT}
          open
          onClose={() => undefined}
          projectId="project-1"
          workspaceId={null}
          initial={null}
          members={[]}
          draft={{ ...analysisDraft, title: 'Major 누락', analysis: { ...analysisDraft.analysis, majorName: '   ', subProcess: '' } }}
          onCreate={onCreate}
        />,
      )
    })

    const save = [...document.querySelectorAll('button')]
      .find(button => button.textContent === 'issue.form.save') as HTMLButtonElement
    act(() => save.click())

    expect(onCreate).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('issue.err.majorRequired')
    expect(document.body.textContent).not.toContain('issue.err.subProcessRequired')
  })

  it('100자를 넘는 Major Process는 서버 호출 전에 막는다', async () => {
    const onCreate = vi.fn(async () => ({ ok: true, id: 'should-not-create' }))
    await act(async () => {
      root.render(
        <IssueFormModal entryContext={REQUIRED_ENTRY_CONTEXT}
          open
          onClose={() => undefined}
          projectId="project-1"
          workspaceId={null}
          initial={null}
          members={[]}
          draft={{ ...analysisDraft, title: 'Major 길이 초과', analysis: { ...analysisDraft.analysis, majorName: '가'.repeat(101) } }}
          onCreate={onCreate}
        />,
      )
    })

    const save = [...document.querySelectorAll('button')]
      .find(button => button.textContent === 'issue.form.save') as HTMLButtonElement
    act(() => save.click())

    expect(onCreate).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('issue.err.majorTooLong')
  })

  it('발급된 PI ID가 있으면 Mega를 잠그고 상세에서 분석 메타와 기존 번호를 함께 표시한다', async () => {
    const current = issue()
    await act(async () => {
      root.render(
        <IssueFormModal entryContext={REQUIRED_ENTRY_CONTEXT}
          open
          onClose={() => undefined}
          projectId="project-1"
          workspaceId={null}
          initial={current}
          members={[]}
        />,
      )
    })

    expect(labelSelect('issue.analysis.area').disabled).toBe(true)
    expect(labelInput('issue.analysis.majorProcess').value).toBe('주문관리')

    await act(async () => {
      root.render(
        <IssueDetailModal areas={TEST_AREAS} timeZone="Asia/Seoul"
          issue={current}
          members={[]}
          memberName={() => null}
          canEdit={false}
          canWrite={false}
          currentUserId={null}
          isProjectAdmin={false}
          today="2026-07-31"
          onClose={() => undefined}
          onEdit={() => undefined}
          onDelete={() => undefined} severities={SEVERITIES} sources={SOURCES} />,
      )
    })

    expect(document.body.textContent).toContain('PI-I-02-03')
    expect(document.body.textContent).not.toContain('#17')
    expect(document.body.textContent).toContain('02 · 영업')
    expect(document.body.textContent).toContain('02.01 · 주문관리')
    expect(document.body.textContent).toContain('주문접수/등록')
    expect(document.body.textContent).toContain('영업관리팀')
    expect(document.body.textContent).toContain('SAP')
    expect(document.body.textContent).toContain('issue.source.type.interview')
    expect(document.body.textContent).toContain('영업관리팀 인터뷰')

    await act(async () => {
      root.render(<DeleteIssueModal issue={current} onClose={() => undefined} />)
    })
    expect(document.body.textContent).toContain('PI-I-02-03')
    expect(document.body.textContent).not.toContain('#17')
  })

  it('기존 미분류 이슈는 편집에서 최초 Mega 분류가 가능하다', async () => {
    await act(async () => {
      root.render(
        <IssueFormModal entryContext={REQUIRED_ENTRY_CONTEXT}
          open
          onClose={() => undefined}
          projectId="project-1"
          workspaceId={null}
          initial={issue({ codeAreaId: null, areaId: null, code: 'PI-U001', majorId: null, majorSeq: null, majorName: null, subProcess: '', ownerDepartment: '', relatedSystems: [], sourceType: null, sourceDetail: '' })}
          members={[]}
        />,
      )
    })

    expect(labelSelect('issue.analysis.area').value).toBe('')
    expect(labelSelect('issue.analysis.area').disabled).toBe(false)
    expect(document.querySelector('input[list="issue-major-process-options"]')).toBeNull()
    await act(async () => { (document.querySelector('input[type=checkbox]') as HTMLInputElement).click() })
    expect(labelInput('issue.analysis.majorProcess').value).toBe('')
    expect(labelSelect('issue.analysis.sourceType').value).toBe('')
  })
  it('creates typed custom values in the same issue request with zero/false required defaults', async () => {
    const {createIssue}=await import('@/app/actions/issues');vi.mocked(createIssue).mockClear()
    const defs:FieldDef[]=[{key:'quantity',label:'Quantity',description:'',type:'number',required:true,default:0,active:true,editable_by:'member',show_in_list:false,searchable:false,sort:0},
      {key:'verified',label:'Verified',description:'',type:'boolean',required:true,default:false,active:true,editable_by:'member',show_in_list:false,searchable:false,sort:1}]
    await act(async()=>root.render(<IssueFormModal open onClose={()=>{}} projectId="project-1" workspaceId="ws" initial={null} members={[]} entryContext={{...TEST_ENTRY_CONTEXT,rules:{areaRequired:false,analysis:'off'},customFields:defs}} />))
    expect(labelInput('Quantity').value).toBe('0');expect(labelSelect('Verified').value).toBe('false')
    await act(async()=>{const el=labelInput('issue.form.title');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,'Typed create');el.dispatchEvent(new Event('input',{bubbles:true}))})
    await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='issue.form.save')!.click())
    expect(createIssue).toHaveBeenCalledWith('project-1',expect.objectContaining({title:'Typed create',custom:{quantity:0,verified:false}}))
    expect(vi.mocked(createIssue).mock.calls[0][1]).not.toHaveProperty('expectedCustom')
  })
  it('retains a dirty custom draft on refresh and adopts the newest base only on explicit discard', async () => {
    const {updateIssue}=await import('@/app/actions/issues');vi.mocked(updateIssue).mockClear()
    const defs:FieldDef[]=[{key:'quantity',label:'Quantity',description:'',type:'number',required:false,active:true,editable_by:'member',show_in_list:false,searchable:false,sort:0}]
    const ctx={...TEST_ENTRY_CONTEXT,rules:{areaRequired:false,analysis:'off' as const},customFields:defs}
    const render=(quantity:number)=>act(async()=>root.render(<IssueFormModal open onClose={()=>{}} projectId="project-1" workspaceId="ws" initial={issue({custom:{quantity},areaId:null})} members={[]} entryContext={ctx} />))
    await render(0)
    await act(async()=>{const el=labelInput('Quantity');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,'2');el.dispatchEvent(new Event('input',{bubbles:true}))})
    await render(3);expect(labelInput('Quantity').value).toBe('2')
    expect(([...document.querySelectorAll('button')].find(b=>b.textContent==='issue.form.save') as HTMLButtonElement).disabled).toBe(true)
    await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='추가 정보 초안 취소')!.click())
    expect(labelInput('Quantity').value).toBe('3')
    await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='issue.form.save')!.click())
    expect(updateIssue).toHaveBeenCalledWith(expect.any(String),expect.objectContaining({custom:{quantity:3},expectedCustom:{quantity:3}}))
  })

  it('keeps a core-only save conflict locked even when the custom draft was pristine',async()=>{
    const {updateIssue}=await import('@/app/actions/issues');vi.mocked(updateIssue).mockResolvedValueOnce({ok:false,conflict:true,error:'Conflict'})
    const defs:FieldDef[]=[{key:'quantity',label:'Quantity',description:'',type:'number',required:false,active:true,editable_by:'member',show_in_list:false,searchable:false,sort:0}]
    const ctx={...TEST_ENTRY_CONTEXT,rules:{areaRequired:false,analysis:'off' as const},customFields:defs}
    const render=(quantity:number,title?:string)=>act(async()=>root.render(<IssueFormModal open onClose={()=>{}} projectId="project-1" workspaceId="ws" initial={issue({custom:{quantity},areaId:null,...(title ? {title} : {})})} members={[]} entryContext={ctx} />))
    await render(0)
    await act(async()=>{const el=labelInput('issue.form.title');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,'Core draft');el.dispatchEvent(new Event('input',{bubbles:true}))})
    await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='issue.form.save')!.click())
    await render(3,'Server title')
    expect(labelInput('Quantity').value).toBe('0');expect(labelInput('issue.form.title').value).toBe('Core draft')
    expect(([...document.querySelectorAll('button')].find(b=>b.textContent==='issue.form.save') as HTMLButtonElement).disabled).toBe(true)
    await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='추가 정보 초안 취소')!.click())
    expect(labelInput('Quantity').value).toBe('3');expect(labelInput('issue.form.title').value).toBe('Core draft')
  })

})
