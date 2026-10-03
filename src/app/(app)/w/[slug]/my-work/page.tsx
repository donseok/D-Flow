import Link from 'next/link'
import { loadWorkspaceScope } from '@/lib/authz/workspaceScope'
import { getMyWork } from '@/lib/data/portal'
import { MY_WORK_KINDS, type MyWorkKind } from '@/lib/portal/myWork'
import { wsHref } from '@/lib/workspace/paths'
import { PageFrame } from '@/components/app/PageFrame'
import { PageHeader } from '@/components/app/PageHeader'
import { KIND_LABEL, MyWorkList } from '@/components/portal/MyWorkList'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { buttonClass } from '@/components/ui/buttonStyles'

export const metadata = { title: '내 업무' }   // 레이아웃 템플릿이 ' · {워크스페이스} | {제품}' 을 붙인다(V6)
const isKind = (k: string): k is MyWorkKind => (MY_WORK_KINDS as readonly string[]).includes(k)

/**
 * 내 업무 v0 + 홈 요약 칸의 거르기(SP3b UI-3 W7) — 종류는 쉼표 목록(?kind=wbs,issue — '내 담당'), ?due=today 는 작업·이슈 가운데 기한이 그 프로젝트의
 * 오늘인 것(판정 R1). 50행 쪽 나눔. 탭·인스펙터·알림 탭은 SPU2
 */
export default async function MyWorkPage({ params, searchParams }: {
  params: Promise<{ slug: string }>; searchParams: Promise<{ kind?: string; cursor?: string; due?: string }>
}) {
  const { slug } = await params
  const scope = await loadWorkspaceScope(slug)                                   // 첫 await — 비소속 404
  const q = await searchParams
  const kinds = [...new Set((typeof q.kind === 'string' ? q.kind.split(',') : []).map((k) => k.trim()).filter(isKind))]
  const kindKey = kinds.length ? kinds.join(',') : null                          // 정규화한 거르기 — 칩·더 보기 링크가 같은 값을 쓴다
  const dueToday = q.due === 'today'
  const cursor = typeof q.cursor === 'string' ? q.cursor : null
  const res = scope.actor ? await getMyWork(scope.ws.id, scope.actor, { kinds: kinds.length ? kinds : undefined, cursor, limit: 50, dueToday }) : null
  /** 칩 — 그 쿼리와 정확히 같을 때만 현재(aria-current) */
  const chip = (k: string | null, due: boolean, label: string) => (
    <Link key={label} href={wsHref(scope.ws.slug, 'my-work', { kind: k, due: due ? 'today' : null })}
      aria-current={kindKey === k && dueToday === due ? 'page' : undefined}
      className={`chip ${kindKey === k && dueToday === due ? 'bg-surface-selected text-fg' : 'text-fg-secondary'}`}>{label}</Link>
  )
  return (
    <PageFrame width="portal" header={<PageHeader title="내 업무" />}
      toolbar={<nav aria-label="종류" className="flex flex-wrap gap-2">
        {chip(null, false, '전체')}{chip('wbs,issue', false, '내 담당')}{chip(null, true, '오늘 마감')}
        {MY_WORK_KINDS.map((k) => chip(k, false, KIND_LABEL[k]))}
      </nav>}>
      {res?.ok ? (
        <div className="space-y-4 pb-8">
          <MyWorkList rows={res.rows} failedKinds={res.failedKinds} empty={dueToday ? '오늘 마감인 일이 없습니다' : '처리할 일이 없습니다'} />
          {res.nextCursor && <Link href={wsHref(scope.ws.slug, 'my-work', { kind: kindKey, due: dueToday ? 'today' : null, cursor: res.nextCursor })} className={buttonClass('ghost')}>더 보기</Link>}
        </div>
      ) : <StatusMessage kind="partial_error" blocking title="내 업무를 불러오지 못했습니다" detail={res ? '잠시 뒤 새로고침하세요.' : '권한 정보를 읽지 못했습니다.'} />}
    </PageFrame>
  )
}
