import Link from 'next/link'
import { BRAND } from '@/lib/branding'
import { loadWorkspaceScope } from '@/lib/authz/workspaceScope'
import { getMyWork } from '@/lib/data/portal'
import { MY_WORK_KINDS, type MyWorkKind } from '@/lib/portal/myWork'
import { wsHref } from '@/lib/workspace/paths'
import { PageFrame } from '@/components/app/PageFrame'
import { PageHeader } from '@/components/app/PageHeader'
import { KIND_LABEL, MyWorkList } from '@/components/portal/MyWorkList'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { buttonClass } from '@/components/ui/buttonStyles'

export const metadata = { title: `내 업무 | ${BRAND.productName}` }

/** 내 업무 v0(D20) — 종류 칩 + 50행 쪽 나눔. 탭·인스펙터·알림 탭은 SPU2 */
export default async function MyWorkPage({ params, searchParams }: {
  params: Promise<{ slug: string }>; searchParams: Promise<{ kind?: string; cursor?: string }>
}) {
  const { slug } = await params
  const scope = await loadWorkspaceScope(slug)                                   // 첫 await — 비소속 404
  const q = await searchParams
  const kind = MY_WORK_KINDS.includes(q.kind as MyWorkKind) ? (q.kind as MyWorkKind) : null
  const cursor = typeof q.cursor === 'string' ? q.cursor : null
  const res = scope.actor ? await getMyWork(scope.ws.id, scope.actor, { kinds: kind ? [kind] : undefined, cursor, limit: 50 }) : null
  const chip = (k: MyWorkKind | null, label: string) => (
    <Link key={label} href={wsHref(scope.ws.slug, 'my-work', { kind: k })} aria-current={kind === k ? 'page' : undefined}
      className={`chip ${kind === k ? 'bg-surface-selected text-fg' : 'text-fg-secondary'}`}>{label}</Link>
  )
  return (
    <PageFrame width="portal" header={<PageHeader title="내 업무" />}
      toolbar={<nav aria-label="종류" className="flex flex-wrap gap-2">{chip(null, '전체')}{MY_WORK_KINDS.map((k) => chip(k, KIND_LABEL[k]))}</nav>}>
      {res?.ok ? (
        <div className="space-y-4 pb-8">
          <MyWorkList rows={res.rows} failedKinds={res.failedKinds} empty="처리할 일이 없습니다" />
          {res.nextCursor && <Link href={wsHref(scope.ws.slug, 'my-work', { kind, cursor: res.nextCursor })} className={buttonClass('ghost')}>더 보기</Link>}
        </div>
      ) : <StatusMessage kind="partial_error" blocking title="내 업무를 불러오지 못했습니다" detail={res ? '잠시 뒤 새로고침하세요.' : '권한 정보를 읽지 못했습니다.'} />}
    </PageFrame>
  )
}
