'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { getSettingsCommandOutcome, updateWorkspaceSettings, type SettingsCommandResult, type SettingsPatch } from '@/app/actions/settings'
import { NAV_GROUP_OF, NAV_ITEM_IDS, type NavGroupId, type NavItemId } from '@/lib/nav/ids'
import type { NavMenuSetting } from '@/lib/settings/defs/workspace'
import { newUuid } from '@/lib/domain/uuid'

const GROUPS: readonly { id: NavGroupId; label: string }[] = [
  { id: 'ws.main', label: '워크스페이스 · 기본' }, { id: 'ws.shared', label: '워크스페이스 · 협업' },
  { id: 'ws.ops', label: '워크스페이스 · 운영' }, { id: 'ws.platform', label: '워크스페이스 · 플랫폼' },
  { id: 'p.overview', label: '프로젝트 · 개요' }, { id: 'p.plan', label: '프로젝트 · 계획' },
  { id: 'p.collab', label: '프로젝트 · 협업' }, { id: 'p.team', label: '프로젝트 · 팀' },
  { id: 'p.settings', label: '프로젝트 · 설정' },
]
const NAMES: Record<NavItemId, string> = {
  'ws.home': '홈', 'ws.my_work': '내 작업', 'ws.projects': '프로젝트',
  'ws.meetings': '회의', 'ws.minutes': '회의록', 'ws.agents': '에이전트',
  'ws.portfolio': '포트폴리오', 'ws.usage': '사용 현황', 'ws.members': '구성원', 'ws.teams': '팀', 'ws.settings': '설정',
  'ws.llm': 'LLM 설정', 'ws.ui_states': '화면 상태',
  'p.dashboard': '대시보드', 'p.wbs': 'WBS', 'p.issues': '이슈', 'p.weekly': '주간보고',
  'p.meetings': '회의', 'p.wiki': '위키', 'p.announcements': '공지',
  'p.members': '구성원', 'p.attendance': '근태', 'p.agents': '에이전트', 'p.settings': '설정',
}
const EMPTY: NavMenuSetting = { order: [], labels: {} }

function ordered(menu: NavMenuSetting): NavItemId[] {
  const rank = new Map(menu.order.map((id, i) => [id, i]))
  return GROUPS.flatMap(group => NAV_ITEM_IDS.filter(id => NAV_GROUP_OF[id] === group.id).sort((a, b) => {
    const ar = rank.get(a), br = rank.get(b)
    if (ar !== undefined && br !== undefined) return ar - br
    if (ar !== undefined) return -1
    if (br !== undefined) return 1
    return NAV_ITEM_IDS.indexOf(a) - NAV_ITEM_IDS.indexOf(b)
  }))
}
const same = (a: NavMenuSetting, b: NavMenuSetting) => JSON.stringify(a) === JSON.stringify(b)
function fromLatest(value: unknown): NavMenuSetting | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const v = value as Partial<NavMenuSetting>
  return Array.isArray(v.order) && typeof v.labels === 'object' && v.labels !== null ? v as NavMenuSetting : null
}

export function MenuOrderEditor({ workspaceId, revision, initialMenu, invalidReason }: {
  workspaceId: string; revision: number; initialMenu: NavMenuSetting | null; invalidReason?: string
}) {
  const router = useRouter()
  const [baseline, setBaseline] = useState<NavMenuSetting>(initialMenu ?? EMPTY)
  const [draft, setDraft] = useState<NavMenuSetting>(initialMenu ?? EMPTY)
  const [displayOrder, setDisplayOrder] = useState<NavItemId[]>(() => ordered(initialMenu ?? EMPTY))
  const [baseRevision, setBaseRevision] = useState(revision)
  const [needsRepair, setNeedsRepair] = useState(initialMenu === null)
  const [conflict, setConflict] = useState<{ revision: number; menu: NavMenuSetting | null } | null>(null)
  const [uncertainPatch, setUncertainPatch] = useState<SettingsPatch | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const dirty = needsRepair || !same(baseline, draft)
  const badLabel = Object.entries(draft.labels).find(([, label]) => !label || label.length > 20 || /[<>]/.test(label))

  function move(id: NavItemId, step: -1 | 1) {
    const group = NAV_GROUP_OF[id]
    const siblings = displayOrder.filter(x => NAV_GROUP_OF[x] === group)
    const from = siblings.indexOf(id), to = from + step
    if (to < 0 || to >= siblings.length) return
    const next = [...displayOrder]
    const a = next.indexOf(id), b = next.indexOf(siblings[to])
    ;[next[a], next[b]] = [next[b], next[a]]
    setDisplayOrder(next)
    setDraft(current => ({ ...current, order: next }))
  }

  async function submit(patch: SettingsPatch, resendCount = 0): Promise<void> {
    let result: SettingsCommandResult | null = null
    try { result = await updateWorkspaceSettings(workspaceId, patch) } catch { /* 이력으로 결과 판정 */ }
    if (result?.ok) {
      setBaseline(draft); setBaseRevision(result.revision); setNeedsRepair(false); setUncertainPatch(null)
      setNotice('메뉴 설정을 저장했습니다.'); router.refresh(); return
    }
    if (result?.kind === 'conflict') {
      setConflict({ revision: result.latest.revision, menu: fromLatest(result.latest.values['navigation.menu']) })
      setUncertainPatch(null); return
    }
    if (result && result.kind !== 'unavailable') {
      setError(result.kind === 'invalid' ? (result.fieldErrors[0]?.message ?? result.error) : result.error)
      setUncertainPatch(null); return
    }
    try {
      const found = await getSettingsCommandOutcome({ workspaceId }, patch.commandId)
      if (found.ok && found.outcome.status === 'applied') {
        setBaseline(draft); setBaseRevision(found.outcome.revision); setNeedsRepair(false); setUncertainPatch(null)
        setNotice('저장된 명령을 확인했습니다.'); router.refresh(); return
      }
    } catch { /* 같은 명령으로 재전송 */ }
    if (resendCount === 0) return submit(patch, 1)
    setUncertainPatch(patch); setError('저장 결과를 확인하지 못했습니다. 같은 명령으로 다시 확인하세요.')
  }

  function save() {
    if ((!dirty && !uncertainPatch) || badLabel) return
    setError(null); setNotice(null)
    const patch = uncertainPatch ?? { expectedRevision: baseRevision, commandId: newUuid(), set: { 'navigation.menu': draft }, unset: [] }
    startTransition(async () => submit(patch))
  }

  return <div className="space-y-5">
    <p className="text-xs leading-5 text-ink-muted">그룹 안의 순서를 바꾸거나 이름을 입력하세요. 빈 이름은 기본 이름을 사용합니다. 실제 메뉴 반영은 다음 셸 갱신부터 적용됩니다.</p>
    {invalidReason && needsRepair && <p role="alert" className="text-xs text-delayed">설정 손상: {invalidReason}. 새 값을 저장해 복구하세요.</p>}
    {GROUPS.map(group => <section key={group.id} className="rounded-xl border border-line p-3">
      <h3 className="mb-3 text-sm font-semibold text-ink">{group.label}</h3>
      <div className="space-y-2">
        {displayOrder.filter(id => NAV_GROUP_OF[id] === group.id).map((id, index, siblings) => <div key={id} className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 p-2">
          <span className="min-w-24 text-sm text-ink">{NAMES[id]}</span>
          <span className="text-[11px] text-ink-subtle">{id}</span>
          <input aria-label={`${NAMES[id]} 메뉴 이름`} className="input ml-auto w-36 text-sm" maxLength={20}
            placeholder={NAMES[id]} value={draft.labels[id] ?? ''} disabled={pending || !!uncertainPatch}
            onChange={event => { const value = event.target.value; setDraft(current => {
              const labels = { ...current.labels }; if (value) labels[id] = value; else delete labels[id]
              return { ...current, labels }
            }) }} />
          <button type="button" className="btn btn-ghost" aria-label={`${NAMES[id]} 위로`} disabled={pending || !!uncertainPatch || index === 0} onClick={() => move(id, -1)}>↑</button>
          <button type="button" className="btn btn-ghost" aria-label={`${NAMES[id]} 아래로`} disabled={pending || !!uncertainPatch || index === siblings.length - 1} onClick={() => move(id, 1)}>↓</button>
        </div>)}
      </div>
    </section>)}
    {badLabel && <p role="alert" className="text-xs text-delayed">{badLabel[0]}의 이름은 1~20자이며 꺾쇠를 쓸 수 없습니다.</p>}
    {conflict && <div role="alert" className="space-y-2 rounded-xl border border-pending/30 bg-pending-weak p-4 text-sm">
      <strong>다른 사용자가 메뉴를 바꿨습니다.</strong>
      <p>내 순서: {draft.order.join(', ') || '기본 순서'}</p>
      <p>최신 순서: {conflict.menu?.order.join(', ') || '설정 손상 또는 기본 순서'}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-ghost" onClick={() => { setBaseline(conflict.menu ?? EMPTY); setBaseRevision(conflict.revision); setNeedsRepair(conflict.menu === null); setConflict(null) }}>내 값 다시 적용</button>
        {conflict.menu && <button type="button" className="btn btn-ghost" onClick={() => { setDraft(conflict.menu!); setBaseline(conflict.menu!); setDisplayOrder(ordered(conflict.menu!)); setBaseRevision(conflict.revision); setNeedsRepair(false); setConflict(null) }}>최신 값 사용</button>}
      </div>
    </div>}
    {error && <p role="alert" className="text-sm text-delayed">{error}</p>}
    {notice && <p role="status" className="text-sm text-done">{notice}</p>}
    <button type="button" className="btn btn-primary" disabled={pending || (!dirty && !uncertainPatch) || !!badLabel || !!conflict} onClick={save}>
      {uncertainPatch ? '저장 결과 확인 및 재시도' : '메뉴 설정 저장'}
    </button>
  </div>
}
