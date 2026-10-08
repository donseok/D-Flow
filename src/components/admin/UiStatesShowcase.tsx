'use client'

import { useState, type CSSProperties, type ReactNode } from 'react'
import { FolderOpen, Inbox, ListChecks, Plus, Save, X } from 'lucide-react'
import type { AccentDerivation, AccentSet } from '@/lib/settings/accent'
import { StatusMessage, STATUS_KINDS, type StatusKind } from '@/components/ui/StatusMessage'
import { StatusPill } from '@/components/ui/StatusPill'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { Field } from '@/components/ui/Field'
import { EmptyState } from '@/components/ui/EmptyState'
import { KpiCard } from '@/components/ui/KpiCard'
import { SectionCard } from '@/components/ui/SectionCard'
import { Modal, ModalCloseButton } from '@/components/ui/Modal'
import { ConflictResolver } from '@/components/ui/ConflictResolver'
import { PageHeader } from '@/components/app/PageHeader'

/**
 * 컴포넌트 상태 쇼케이스(SP3b 스펙 §4.6, 개정 §5.7.3) — 라이트·다크 두 열. 다크 열 컨테이너는 .dark + data-theme-scope 라
 * 유틸이 컨테이너의 재정의를 먹는다. 옛 토큰 이름을 쓰는 컴포넌트는 넣지 않는다(옛 이름의 var() 는 :root 값을 상속한다 — 계획 판정 Q12).
 * 겹쳐 뜨는 것(모달·충돌 비교)은 body 로 나가 열 안에 가둘 수 없다 — 열 밖 '겹침' 구역의 버튼으로 실제 테마에서 연다.
 * 포커스는 정적으로 그릴 수 없어 전역 :focus-visible 과 같은 값의 외곽선으로 흉내 낸다(진짜 포커스는 Tab 눈확인).
 */
export type AccentSample = { name: string; hex: string; result: AccentDerivation }

const STATUS_COPY: Record<StatusKind, { title: string; detail?: string }> = {
  loading: { title: '불러오는 중' },
  empty: { title: '아직 항목이 없습니다', detail: '첫 항목을 만들면 여기에 보입니다.' },
  needs_setup: { title: '설정이 필요합니다', detail: '관리자가 이 기능을 설정해야 합니다.' },
  disabled: { title: '이 프로젝트에서 사용하지 않는 기능입니다' },
  // 'DegradedNotice' 의 문구(일부 정보를 …)와 다르게 — 같으면 캡처·e2e 의 PAGE_MARKERS 가 이 표본을 페이지 열화로 읽는다
  partial_error: { title: '일부 항목을 불러오지 못했습니다', detail: '나머지는 그대로 볼 수 있습니다.' },
  conflict: { title: '다른 사람이 먼저 바꿨습니다', detail: '최신 내용을 확인한 뒤 다시 저장하세요.' },
  offline: { title: '연결이 끊겼습니다', detail: '입력한 내용은 이 기기에 남아 있습니다.' },
  permission_changed: { title: '권한이 바뀌었습니다', detail: '이 화면을 계속 볼 수 없습니다.' },
}
const FOCUS_RING = 'outline-2 outline-offset-2 outline-(--color-border-focus)'

/** D23 매핑 — 저장 세트의 여섯 키 → action 계열 여섯 변수 */
function accentStyle(set: AccentSet): CSSProperties {
  return {
    '--color-action': set.bg, '--color-action-fg': set.fg, '--color-action-hover': set.hover,
    '--color-action-pressed': set.pressed, '--color-action-soft': set.soft, '--color-border-focus': set.focus,
  } as CSSProperties
}

/** 글자 크기 8단계(개정 §5.5.6) — 클래스 이름은 Tailwind 가 읽도록 글자 그대로 적는다. 가장 작은 글자는 보조 메타 12px 이다 */
const TYPE_SCALE: { cls: string; name: string; spec: string }[] = [
  { cls: 'text-title', name: '페이지 제목', spec: '24/32 · 600' },
  { cls: 'text-title-sm', name: '페이지 제목(모바일)', spec: '22/30 · 600' },
  { cls: 'text-kpi', name: 'KPI 숫자', spec: '28/34 · 600' },
  { cls: 'text-section', name: '섹션 제목', spec: '16/24 · 600' },
  { cls: 'text-doc', name: '문서 본문', spec: '16/26 · 400' },
  { cls: 'text-body', name: '본문', spec: '14/22 · 400' },
  { cls: 'text-control', name: '메뉴·버튼·입력', spec: '14/20 · 400~500' },
  { cls: 'text-meta', name: '보조 메타(하한)', spec: '12/18 · 400' },
]

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-section text-fg">{title}</h2>
      {children}
    </section>
  )
}

function Panel({ theme, samples }: { theme: 'light' | 'dark'; samples: AccentSample[] }) {
  return (
    <div
      data-theme-scope
      data-showcase-column={theme}
      className={`${theme === 'dark' ? 'dark ' : ''}space-y-6 rounded-(--radius-panel) border border-border bg-canvas p-4 text-fg`}
    >
      <p className="text-meta font-semibold text-fg-muted">{theme === 'dark' ? '다크' : '라이트'}</p>

      <Section title="상태 8종">
        <div className="grid gap-2">
          {STATUS_KINDS.map((k) => (
            <StatusMessage key={k} kind={k} {...STATUS_COPY[k]} compact={k === 'offline'}
              action={k === 'needs_setup' ? { label: '설정 열기', href: '#' } : undefined} />
          ))}
        </div>
      </Section>

      <Section title="상태 칩·배지">
        <div className="flex flex-wrap items-center gap-2">
          {(['not_started', 'in_progress', 'delayed', 'done'] as const).map((s) => <StatusPill key={s} status={s} />)}
          <span data-badge="notify" className="rounded-full bg-action px-2 py-0.5 text-xs font-bold text-action-fg">3</span>
          <span data-badge="review" className="rounded-full bg-warning px-2 py-0.5 text-xs font-bold text-warning-fg">2</span>
          <span data-badge="urgent" className="rounded-full bg-danger px-2 py-0.5 text-xs font-bold text-danger-fg">1</span>
        </div>
      </Section>

      <Section title="버튼">
        <div className="flex flex-wrap items-center gap-2">
          <Button data-sample="primary" variant="primary" icon={<Save className="h-4 w-4" aria-hidden />}>저장</Button>
          <Button variant="secondary">취소</Button>
          <Button variant="ghost">더 보기</Button>
          <Button variant="danger">삭제</Button>
          <Button variant="primary" busy>저장</Button>
          <Button variant="primary" disabled>저장</Button>
          <Button variant="secondary" disabled disabledReason="관리자만 바꿀 수 있습니다">바꾸기</Button>
          <Button variant="primary" className={FOCUS_RING}>포커스</Button>
          <IconButton icon={<X className="h-4 w-4" aria-hidden />} aria-label="닫기" variant="ghost" />
          <button type="button" data-sample="legacy-btn-primary" className="btn btn-primary">옛 .btn-primary</button>
        </div>
      </Section>

      <Section title="페이지 머리(개정 §5.4.4) — 일반 64~80 · 컴팩트 48">
        <div className="space-y-2">
          <div data-sample="page-header" className="rounded-(--radius-control) border border-dashed border-border px-3">
            <PageHeader preview="default" title="작업 계획" description="설명 한 줄 — 컴팩트에서 가장 먼저 접힌다" meta="기준일 2026-09-01 · 주 시작 일요일"
              secondaryActions={[<Button key="export" variant="secondary">내보내기</Button>]}
              primaryAction={<Button variant="primary" icon={<Plus className="h-4 w-4" aria-hidden />}>작업 추가</Button>} />
          </div>
          <div data-sample="page-header-compact" className="rounded-(--radius-control) border border-dashed border-border px-3">
            <PageHeader preview="compact" title="작업 계획" description="설명 한 줄 — 컴팩트에서 가장 먼저 접힌다" meta="기준일 2026-09-01 · 주 시작 일요일"
              primaryAction={<Button variant="primary" icon={<Plus className="h-4 w-4" aria-hidden />}>작업 추가</Button>} />
          </div>
        </div>
      </Section>

      <Section title="아이콘 버튼 — 보이는 크기 그대로, 누르는 영역 44px">
        <div className="flex flex-wrap items-center gap-4">
          <IconButton data-sample="icon-button" icon={<X className="h-4 w-4" aria-hidden />} aria-label="닫기" variant="ghost" />
          <IconButton icon={<X className="h-4 w-4" aria-hidden />} aria-label="닫기(테두리)" variant="secondary" />
          <IconButton icon={<X className="h-4 w-4" aria-hidden />} aria-label="닫기(비활성)" variant="ghost" disabled />
          <IconButton icon={<X className="h-4 w-4" aria-hidden />} aria-label="닫기(처리 중)" variant="ghost" busy />
          <IconButton icon={<X className="h-4 w-4" aria-hidden />} aria-label="닫기(포커스)" variant="ghost" className={FOCUS_RING} />
          <span data-sample="modal-close" className="inline-flex items-center gap-2 text-meta text-fg-secondary"><ModalCloseButton label="모달 닫기" />모달 닫기(32)</span>
        </div>
      </Section>

      <Section title="타이포 스케일 — 여덟 단계, 하한 12px">
        <div data-sample="type-scale" className="divide-y divide-border rounded-(--radius-control) border border-border bg-surface">
          {TYPE_SCALE.map((row) => (
            <div key={row.cls} data-type-step={row.cls} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2">
              <span className={`${row.cls} min-w-0 text-fg`}>{row.name} 가나다 Abc 123</span>
              <span className="shrink-0 text-meta tabular-nums text-fg-muted">{row.cls} · {row.spec}</span>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2 px-3 py-2">
            <span className="chip bg-surface-subtle text-fg-secondary">칩 12px</span>
            <span className="badge bg-surface-subtle text-fg-secondary">배지 12px</span>
            <span className="lvl-badge bg-surface-subtle text-fg-secondary">단계 12px</span>
            <span className="text-meta text-fg-muted">12px 미만은 차트 눈금·도형 안 글자·키 표시뿐이다</span>
          </div>
        </div>
      </Section>

      <Section title="카드 — KPI·구역·빈 상태">
        <div className="space-y-3">
          <div data-sample="kpi-cards" className="grid gap-3 sm:grid-cols-2">
            <KpiCard label="전체" value={128} sub="이번 주 +4" icon={ListChecks} />
            <KpiCard label="진행" value={42} sub="담당 12명" icon={ListChecks} tone="brand" />
            <KpiCard label="완료" value={71} icon={ListChecks} tone="success" />
            <KpiCard label="지연" value={15} sub="확인 필요" icon={ListChecks} tone="danger" />
            <KpiCard label="모름(조회 실패)" value="—" sub="0 으로 보이지 않는다" tone="warning" />
          </div>
          <div data-sample="section-card">
            <SectionCard eyebrow="일반" title="이름과 메일" icon={FolderOpen} actions={<Button variant="secondary">편집</Button>}>
              <p className="text-body text-fg-secondary">구역 카드의 본문 자리입니다.</p>
            </SectionCard>
          </div>
          <div data-sample="empty-state">
            <EmptyState icon={Inbox} title="아직 항목이 없습니다" description="첫 항목을 만들면 여기에 보입니다."
              action={<Button variant="primary">항목 만들기</Button>} />
          </div>
        </div>
      </Section>

      <Section title="입력">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="이름">{(p) => <input {...p} defaultValue="" placeholder="예: 설계 검토" />}</Field>
          <Field label="설명" description="팀에서 부르는 이름">{(p) => <input {...p} defaultValue="설계 검토" />}</Field>
          <Field label="기한" error="기한은 시작일 뒤여야 합니다">{(p) => <input {...p} defaultValue="2026-09-01" />}</Field>
          <Field label="코드(읽기 전용)" readOnly>{(p) => <input {...p} defaultValue="P.1.2" />}</Field>
          <Field label="담당(비활성)" disabled>{(p) => <input {...p} defaultValue="alice" />}</Field>
        </div>
      </Section>

      <Section title="복합 상태(개정 §5.7.3)">
        <div className="space-y-3">
          <div data-sample="selected-error-focus-row" className={`flex items-center justify-between rounded-(--radius-control) bg-surface-selected px-3 py-2 text-sm ${FOCUS_RING}`}>
            <span className="text-fg">선택 + 오류 + 포커스 행</span>
            <span className="text-danger">저장 실패</span>
          </div>
          <Field label="dirty + invalid 필드 ●" error="숫자만 입력하세요">{(p) => <input {...p} defaultValue="12a" />}</Field>
          <div className="flex flex-wrap items-center gap-3">
            <StatusMessage kind="conflict" title="다른 사람이 먼저 바꿨습니다" compact />
            <Button variant="primary" busy>다시 저장</Button>
          </div>
        </div>
      </Section>

      <Section title="강조색 표본 10종(D23 매핑)">
        <div className="grid gap-2 sm:grid-cols-2">
          {samples.map((s) => (
            <div key={s.hex} data-accent-sample={s.hex} data-accent-ok={String(s.result.ok)}
              data-theme-scope style={s.result.ok ? accentStyle(s.result.value[theme]) : undefined}
              className="space-y-2 rounded-(--radius-control) border border-border bg-surface p-3">
              <p className="text-meta text-fg-secondary">{s.name} <span className="font-mono">{s.hex}</span></p>
              {s.result.ok ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="primary">주 동작</Button>
                  <span className="rounded-full bg-action px-2 py-0.5 text-xs font-bold text-action-fg">3</span>
                  <a href="#" className="text-sm text-action underline">링크</a>
                  <span className="rounded bg-action-soft px-2 py-0.5 text-xs text-fg">선택</span>
                </div>
              ) : (
                <div className="text-meta text-danger">
                  <p>{s.result.error}</p>
                  {s.result.hue && <p>상태색({s.result.hue.status})과 hue 거리 {s.result.hue.distance}° &lt; {s.result.hue.min}°</p>}
                  {s.result.failures.map((f) => <p key={f.pair}>{f.pair}: {f.contrast.toFixed(2)} &lt; {f.min}</p>)}
                </div>
              )}
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}

const CONFLICT_FIELDS = [
  { key: 'name', label: '작업 이름', mine: '설계 검토(2차)', latest: '설계 검토 — 보완', base: '설계 검토' },
  { key: 'end', label: '종료일', mine: '2026-09-12', latest: '2026-09-10', base: '2026-09-10' },
  { key: 'note', label: '비고', mine: '', latest: '외주 일정 확인 필요' },
] as const

/** 겹쳐 뜨는 표본 — body 로 나가므로 지금 화면의 테마로 뜬다(다크는 테마를 바꿔서 본다) */
function Overlays() {
  const [open, setOpen] = useState<'modal' | 'conflict' | null>(null)
  const close = () => setOpen(null)
  return (
    <section data-showcase-overlays className="space-y-2 rounded-(--radius-panel) border border-border bg-canvas p-4">
      <h2 className="text-section text-fg">겹침 — 모달·충돌 비교(지금 테마로 열린다)</h2>
      <div className="flex flex-wrap items-center gap-2">
        <Button data-sample="open-modal" variant="secondary" onClick={() => setOpen('modal')}>모달 열기</Button>
        <Button data-sample="open-conflict" variant="secondary" onClick={() => setOpen('conflict')}>충돌 비교 열기</Button>
      </div>
      <Modal open={open === 'modal'} onClose={close} eyebrow="표본" title="모달 — 닫기 버튼의 누르는 영역 44px"
        footer={<><Button variant="secondary" onClick={close}>취소</Button><Button variant="primary" onClick={close}>확인</Button></>}>
        <p className="text-body text-fg-secondary">오른쪽 위 닫기는 보이는 크기 32px, 누르는 영역 44px 입니다. Esc·바깥 누름으로도 닫힙니다.</p>
      </Modal>
      <ConflictResolver open={open === 'conflict'} target="P.1.2 설계 검토" fields={CONFLICT_FIELDS} onKeepMine={close} onTakeLatest={close} onContinue={close} />
    </section>
  )
}

export function UiStatesShowcase({ samples }: { samples: AccentSample[] }) {
  return (
    <div className="space-y-4">
      <Overlays />
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel theme="light" samples={samples} />
        <Panel theme="dark" samples={samples} />
      </div>
    </div>
  )
}
