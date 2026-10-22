'use client'
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { CircleAlert, FileText, LayoutTemplate, ListPlus, LoaderCircle } from 'lucide-react'
import { isMarkableBlock, type MinuteBlock } from '@/lib/minutes/blocks'
import {
  MINUTE_SELECTION_MAX_BLOCK_SPAN, MINUTE_SELECTION_MAX_CHARS, MINUTE_SELECTION_MIN_CHARS,
  matchMinuteSelection, stripSelectionWhitespace,
} from '@/lib/minutes/selection'
import { useLocale } from '@/components/providers/LocaleProvider'

export interface MinuteSelectionTarget {
  startIndex: number
  endIndex: number
  startHash: string
  endHash: string
  /**
   * Selection.toString() 원본 — Range.toString() 과 달리 블록 경계 개행을 보존하는
   * 렌더 텍스트 근사라 여러 블록 발췌가 한 줄로 붙지 않는다. 정규화·검증은
   * 서버 계약(selection.ts)이 담당한다.
   */
  text: string
  /**
   * 같은 원문 대조 함수(matchMinuteSelection)를 클라에서 미리 실행해 얻은 서버 파생
   * 발췌 — 미리보기·폴백 초안이 저장될 발췌와 정확히 일치한다. 서버는 이 값을 신뢰하지
   * 않고 독립적으로 재계산한다.
   */
  excerpt: string
}

interface BubbleState {
  target: MinuteSelectionTarget
  rect: { top: number; bottom: number; left: number; width: number }
}

function closestBlockElement(node: Node | null): HTMLElement | null {
  let current: Node | null = node
  while (current) {
    if (current instanceof HTMLElement && current.dataset.mblock !== undefined) return current
    current = current.parentNode
  }
  return null
}

/**
 * 선택 Range 와 단일 블록 요소의 교집합이 실제로 문자를 포함하는지 측정.
 * 트리플클릭·블록 끝까지 드래그 시 브라우저가 `endContainer` 를 다음 블록의 offset 0 에
 * 걸어두는데, 그 블록은 실제로는 0자만 선택된 상태다.
 */
function rangeTextWithin(range: Range, blockEl: HTMLElement): string {
  const probe = document.createRange()
  probe.selectNodeContents(blockEl)
  if (range.compareBoundaryPoints(Range.START_TO_START, probe) > 0) {
    probe.setStart(range.startContainer, range.startOffset)
  }
  if (range.compareBoundaryPoints(Range.END_TO_END, probe) < 0) {
    probe.setEnd(range.endContainer, range.endOffset)
  }
  return probe.toString()
}

/**
 * 본문 드래그 선택 근처에 뜨는 '이슈로 등록'(관리자면 'WBS로 등록'도, 멤버면 '설계서 추출'·'목업 만들기'도) 버블 — 블록 팝오버(클릭)와 상보적인 진입점.
 * 선택 확정은 pointerup/keyup 에서만 판정해 드래그 중 재배치 깜빡임을 피하고,
 * 스크롤·리사이즈는 rAF 로 위치만 추적한다. 선택 해제 시 즉시 소멸.
 */
export function MinuteSelectionBubble({
  bodyRef, blocks, disabled, busy, wbsBusy = false, specBusy = false, mockupBusy = false,
  canCreateIssue = true, canCreateWbs = true, canCreateBlueprint = true,
  onCreateIssue, onCreateWbs, onExtractSpec, onCreateMockup, onDismiss,
  onTargetChange,
}: {
  bodyRef: RefObject<HTMLDivElement | null>
  blocks: MinuteBlock[]
  disabled: boolean
  busy: boolean
  /** WBS 초안 준비 중 — 단추를 막고 WBS 단추가 「작업 초안 준비 중…」(busy 는 이슈 쪽) */
  wbsBusy?: boolean
  /** 프로그램 설계서 추출 중 — 모든 단추를 막고 설계서 단추가 「설계서 추출 중…」 */
  specBusy?: boolean
  /** 목업 생성 중 — 모든 단추를 막고 목업 단추가 「목업 만드는 중…」 */
  mockupBusy?: boolean
  /** false = 이슈 단추를 보이되 막는다(문구는 그대로 — 다른 흐름이 준비 중일 때) */
  canCreateIssue?: boolean
  /** false = WBS 단추를 보이되 막는다 */
  canCreateWbs?: boolean
  /** false = 설계서·목업 단추를 보이되 막는다 */
  canCreateBlueprint?: boolean
  onCreateIssue: (target: MinuteSelectionTarget) => void
  /** 있으면 「WBS로 등록」을 첫 줄 옆에 둔다(첫 줄 폭 180 → 300) — 뷰어가 WBS 등록을 열 수 있을 때만 넘긴다 */
  onCreateWbs?: (target: MinuteSelectionTarget) => void
  /** 있으면 둘째 줄에 「설계서 추출」을 둔다 */
  onExtractSpec?: (target: MinuteSelectionTarget) => void
  /** 있으면 둘째 줄에 「목업 만들기」를 둔다 */
  onCreateMockup?: (target: MinuteSelectionTarget) => void
  /** 현재 선택된 블록 범위를 본문에 임시 하이라이트로 반영한다. */
  onTargetChange?: (target: MinuteSelectionTarget | null) => void
  /** 표출 중이던 버블이 바깥 클릭·선택 해제로 사라질 때 — 진행 중 요청 취소의 신호. */
  onDismiss?: () => void
}) {
  const { t } = useLocale()
  const [state, setState] = useState<BubbleState | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const visibleRef = useRef(false)
  const onDismissRef = useRef(onDismiss)
  const onTargetChangeRef = useRef(onTargetChange)
  useEffect(() => {
    visibleRef.current = state !== null
  }, [state])
  useEffect(() => {
    onDismissRef.current = onDismiss
  }, [onDismiss])
  useEffect(() => {
    onTargetChangeRef.current = onTargetChange
  }, [onTargetChange])

  const readTarget = useCallback((): BubbleState | null => {
    const selection = window.getSelection()
    // Firefox 는 표 열 드래그 등에서 다중 Range 를 만든다 — 비연속 선택은 지원하지 않는다.
    if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null
    const range = selection.getRangeAt(0)
    const body = bodyRef.current
    if (!body || !body.contains(range.commonAncestorContainer)) return null
    const startEl = closestBlockElement(range.startContainer)
    const endEl = closestBlockElement(range.endContainer)
    if (!startEl || !endEl) return null
    let startIndex = Number(startEl.dataset.mblock)
    let endIndex = Number(endEl.dataset.mblock)
    if (!Number.isInteger(startIndex) || !Number.isInteger(endIndex) || endIndex < startIndex) {
      return null
    }
    const text = selection.toString()
    if (text.length > MINUTE_SELECTION_MAX_CHARS) return null
    if (stripSelectionWhitespace(text).length < MINUTE_SELECTION_MIN_CHARS) return null

    // 트리플클릭·문단 끝 넘김 드래그는 끝 앵커를 다음 블록의 offset 0 에 두는데(Chrome 계열
    // 통상 동작), 그 블록은 선택 문자를 1자도 기여하지 않아 서버 걸침 판정에서 거절된다.
    // 문자를 실제로 기여하는 블록까지 양 끝을 당겨서 보낸다.
    const contributionAt = (index: number): string => {
      const el = body.querySelector<HTMLElement>(`[data-mblock="${index}"]`)
      return el ? rangeTextWithin(range, el) : ''
    }
    while (endIndex > startIndex && !stripSelectionWhitespace(contributionAt(endIndex))) {
      endIndex -= 1
    }
    while (startIndex < endIndex && !stripSelectionWhitespace(contributionAt(startIndex))) {
      startIndex += 1
    }
    if (endIndex - startIndex > MINUTE_SELECTION_MAX_BLOCK_SPAN) return null

    const start = blocks[startIndex]
    const end = blocks[endIndex]
    if (!start || !end || !isMarkableBlock(start) || !isMarkableBlock(end)) return null
    // 제목만의 선택은 이슈가 될 수 없다 — 서버 규칙(선택 범위에 non-heading 필요)과 동일 게이트.
    let hasBody = false
    for (let index = startIndex; index <= endIndex; index += 1) {
      const candidate = blocks[index]
      if (candidate && isMarkableBlock(candidate) && !candidate.headingDepth) {
        hasBody = true
        break
      }
    }
    if (!hasBody) return null
    // 서버와 같은 대조를 미리 실행 — 렌더 전용 텍스트(머메이드·이미지 alt 등)가 낀 선택은
    // 어차피 서버가 거절하므로 버블 자체를 띄우지 않고, 통과하면 저장될 발췌를 얻는다.
    const match = matchMinuteSelection(blocks, startIndex, start.hash, endIndex, end.hash, text)
    if (!match.ok) return null
    const rect = range.getBoundingClientRect()
    return {
      target: {
        startIndex, endIndex, startHash: start.hash, endHash: end.hash, text,
        excerpt: match.excerpt,
      },
      rect: { top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width },
    }
  }, [blocks, bodyRef])

  useEffect(() => {
    if (disabled) {
      setState(null)
      onTargetChangeRef.current?.(null)
      return
    }
    let frame = 0
    const evaluate = () => {
      const next = readTarget()
      setState(next)
      onTargetChangeRef.current?.(next?.target ?? null)
    }
    const evaluateSoon = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(evaluate)
    }
    const dismiss = () => {
      if (visibleRef.current) onDismissRef.current?.()
      setState(null)
      onTargetChangeRef.current?.(null)
    }
    const onPointerDown = (event: Event) => {
      // 버블 내부 pointerdown(버튼 클릭)은 선택을 유지해야 하므로 숨기지 않는다.
      if (event.target instanceof Node && boxRef.current?.contains(event.target)) return
      dismiss()
    }
    const onSelectionChange = () => {
      const selection = document.getSelection()
      if (!selection || selection.isCollapsed) dismiss()
    }
    document.addEventListener('pointerup', evaluate)
    document.addEventListener('keyup', evaluate)
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('selectionchange', onSelectionChange)
    window.addEventListener('scroll', evaluateSoon, true)
    window.addEventListener('resize', evaluateSoon)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('pointerup', evaluate)
      document.removeEventListener('keyup', evaluate)
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('selectionchange', onSelectionChange)
      window.removeEventListener('scroll', evaluateSoon, true)
      window.removeEventListener('resize', evaluateSoon)
    }
  }, [disabled, readTarget])

  if (!state) return null
  // 첫 줄은 이슈·WBS 단추(단추 둘이면 300, 하나면 180). 둘째 줄은 설계서 추출·화면 목업(폭 300)으로 쌓아 좁은 화면에서도 넘치지 않게 한다.
  const twoButtons = onCreateWbs !== undefined
  const hasBlueprintRow = Boolean(onExtractSpec || onCreateMockup)
  const W = twoButtons ? 300 : 180
  const boxW = hasBlueprintRow ? 300 : W
  const H = hasBlueprintRow ? 86 : 44
  const center = state.rect.left + state.rect.width / 2
  const left = Math.min(Math.max(8, center - boxW / 2), window.innerWidth - boxW - 8)
  const below = state.rect.bottom + 6 + H < window.innerHeight
  const top = below ? state.rect.bottom + 6 : Math.max(8, state.rect.top - 6 - H)
  const pad = twoButtons ? ' px-3' : ''
  // 단추 둘이면 반쪽 폭에 준비 중 문구(「작업 초안 준비 중…」·「핵심 내용 정리 중…」)가 들어가도록 글자를 줄인다
  const label = twoButtons ? 'truncate text-xs' : 'truncate'
  // 막힌 단추 — 본문 위에 떠 있어 .btn 의 불투명도(disabled:opacity-50)로 흐리면 밑의 글이 비친다. 불투명한 막힌 표면·글자색으로 바꾼다
  const solidDisabled = ' disabled:opacity-100 disabled:border-border disabled:bg-surface-disabled disabled:text-fg-disabled'
  const anyBusy = busy || wbsBusy || specBusy || mockupBusy
  return (
    <div
      ref={boxRef}
      style={{ position: 'fixed', top, left }}
      className="z-[95] flex flex-col gap-1.5"
      // 버튼 mousedown 이 브라우저 기본 동작으로 선택을 해제하는 것을 막는다.
      onPointerDown={event => event.preventDefault()}
    >
      <div style={{ width: W }} className="flex gap-1.5">
        <button
          onClick={() => onCreateIssue(state.target)}
          disabled={anyBusy || !canCreateIssue}
          className={`btn btn-primary h-9 min-w-0 flex-1 shadow-[var(--shadow-lg)]${pad}${solidDisabled}`}
        >
          {busy
            ? <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" />
            : <CircleAlert className="h-4 w-4 shrink-0" />}
          <span className={label}>{busy ? t('min.issue.summarizing') : t('min.sel.create')}</span>
        </button>
        {onCreateWbs && (
          <button
            onClick={() => onCreateWbs(state.target)}
            disabled={anyBusy || !canCreateWbs}
            className={`btn btn-ghost h-9 min-w-0 flex-1 shadow-[var(--shadow-lg)]${pad}${solidDisabled}`}
          >
            {wbsBusy
              ? <LoaderCircle aria-hidden className="h-4 w-4 shrink-0 animate-spin" />
              : <ListPlus aria-hidden className="h-4 w-4 shrink-0" />}
            <span className={label}>{wbsBusy ? t('min.wbs.preparing') : t('min.wbs.create')}</span>
          </button>
        )}
      </div>
      {hasBlueprintRow && (
        <div style={{ width: 300 }} className="flex gap-1.5">
          {onExtractSpec && (
            <button
              onClick={() => onExtractSpec(state.target)}
              disabled={anyBusy || !canCreateBlueprint}
              className={`btn btn-ghost h-9 min-w-0 flex-1 px-3 shadow-[var(--shadow-lg)]${solidDisabled}`}
            >
              {specBusy
                ? <LoaderCircle aria-hidden className="h-4 w-4 shrink-0 animate-spin" />
                : <FileText aria-hidden className="h-4 w-4 shrink-0" />}
              <span className="truncate text-xs">{specBusy ? t('min.spec.preparing') : t('min.spec.create')}</span>
            </button>
          )}
          {onCreateMockup && (
            <button
              onClick={() => onCreateMockup(state.target)}
              disabled={anyBusy || !canCreateBlueprint}
              className={`btn btn-ghost h-9 min-w-0 flex-1 px-3 shadow-[var(--shadow-lg)]${solidDisabled}`}
            >
              {mockupBusy
                ? <LoaderCircle aria-hidden className="h-4 w-4 shrink-0 animate-spin" />
                : <LayoutTemplate aria-hidden className="h-4 w-4 shrink-0" />}
              <span className="truncate text-xs">{mockupBusy ? t('min.mockup.preparing') : t('min.mockup.create')}</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
