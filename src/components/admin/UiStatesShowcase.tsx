'use client'

import type { CSSProperties, ReactNode } from 'react'
import { Save, X } from 'lucide-react'
import type { AccentDerivation, AccentSet } from '@/lib/settings/accent'
import { StatusMessage, STATUS_KINDS, type StatusKind } from '@/components/ui/StatusMessage'
import { StatusPill } from '@/components/ui/StatusPill'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { Field } from '@/components/ui/Field'

/**
 * 컴포넌트 상태 쇼케이스(SP3b 스펙 §4.6, 개정 §5.7.3) — 라이트·다크 두 열. 다크 열 컨테이너는 .dark + data-theme-scope 라
 * 유틸이 컨테이너의 재정의를 먹는다. 옛 토큰 이름을 쓰는 컴포넌트는 넣지 않는다(옛 이름의 var() 는 :root 값을 상속한다 — 계획 판정 Q12).
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

export function UiStatesShowcase({ samples }: { samples: AccentSample[] }) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel theme="light" samples={samples} />
      <Panel theme="dark" samples={samples} />
    </div>
  )
}
