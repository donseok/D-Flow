import Link from 'next/link'
import type { ReactNode } from 'react'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { MyWorkList } from './MyWorkList'
import { wsHref } from '@/lib/workspace/paths'
import { LEGACY_PATHS } from '@/lib/nav/legacyPaths'
import type { MyWorkRow, MyWorkKind } from '@/lib/portal/myWork'

/** 로더 결과 — null 은 권한 정보를 읽지 못해(열화) 로더를 부르지 않은 섹션 */
type Res<T> = ({ ok: true } & T) | { ok: false; error: string } | null

function Section({ id, title, more, children }: { id: string; title: string; more?: { href: string; label: string }; children: ReactNode }) {
  return (
    <section data-section={id} aria-labelledby={`home-${id}`} className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 id={`home-${id}`} className="text-section text-fg">{title}</h2>
        {more && <Link href={more.href} className="text-meta font-semibold text-action hover:underline">{more.label}</Link>}
      </div>
      {children}
    </section>
  )
}
/** 섹션 하나의 실패 — 그 섹션만(나머지 섹션은 그대로). 재시도 동작은 포털 v1(UI-3) */
const failed = (r: { ok: false } | null) => (
  <StatusMessage kind="partial_error" title="이 구역을 불러오지 못했습니다" detail={r ? '잠시 뒤 새로고침하세요.' : '권한 정보를 읽지 못했습니다.'} />
)

/** 워크스페이스 홈 v0 의 섹션 셋(D20) — 지금 처리할 일 · 진행 중인 프로젝트 · 공지(UI-2b 가 지우는 티커의 대체 표면) */
export function HomeSections({ slug, work, projects, announcements }: {
  slug: string
  work: Res<{ rows: MyWorkRow[]; failedKinds: MyWorkKind[] }>
  projects: Res<{ rows: { id: string; name: string }[] }>
  announcements: Res<{ rows: { id: string; title: string; projectId: string; projectName: string; isPinned: boolean }[] }>
}) {
  return (
    <div className="space-y-8 pb-8">
      <Section id="work" title="지금 처리할 일" more={{ href: wsHref(slug, 'my-work'), label: '내 업무 전체' }}>
        {work?.ok ? <MyWorkList rows={work.rows} failedKinds={work.failedKinds} empty="지금 처리할 일이 없습니다" /> : failed(work)}
      </Section>
      {/* 전체 목록은 과제 25 가 /w/<slug>/projects 로 옮길 때까지 옛 경로다 — 없는 경로를 걸면 그 링크의 prefetch 가 끝나지 않는다.
          과제 25 가 legacyPaths.ts 를 지우면 여기가 wsHref(slug, 'projects') 로 바뀐다 */}
      <Section id="projects" title="진행 중인 프로젝트" more={{ href: LEGACY_PATHS.projects, label: '전체 보기' }}>
        {projects?.ok ? (projects.rows.length === 0 ? <StatusMessage kind="empty" compact title="진행 중인 프로젝트가 없습니다" /> : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {projects.rows.map((p) => (
              <li key={p.id}><Link href={`/p/${p.id}/dashboard`} className="block truncate rounded-(--radius-panel) border border-border bg-surface px-4 py-3 text-body text-fg hover:bg-surface-hover">{p.name}</Link></li>
            ))}
          </ul>
        )) : failed(projects)}
      </Section>
      <Section id="announcements" title="공지">
        {announcements?.ok ? (announcements.rows.length === 0 ? <StatusMessage kind="empty" compact title="공지가 없습니다" /> : (
          <ul className="divide-y divide-border rounded-(--radius-panel) border border-border bg-surface">
            {announcements.rows.map((a) => (
              <li key={a.id}><Link href={`/p/${a.projectId}/announcements`} className="flex min-h-12 items-center gap-3 px-4 py-3 hover:bg-surface-hover">
                {a.isPinned && <span className="shrink-0 text-meta font-semibold text-action">고정</span>}
                <span className="min-w-0 flex-1 truncate text-body text-fg">{a.title}</span>
                <span className="shrink-0 text-meta text-fg-secondary">{a.projectName}</span>
              </Link></li>
            ))}
          </ul>
        )) : failed(announcements)}
      </Section>
    </div>
  )
}
