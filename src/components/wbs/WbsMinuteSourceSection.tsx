'use client'
// WBS 작업 상세의 「회의록 원문」(설계 docs/superpowers/specs/2026-10-21-minutes-to-wbs-design.md §3 WBS 쪽) — 이 작업을 등록한 회의록 문단들.
// 모양과 링크는 이슈 상세의 원문 카드(IssueModals)와 같다 — 회의록을 그 문단 위치로 연다(minuteSourceHref, 같은 앵커 방식). 연결이 여럿이면 모두.
// 연결이 없으면 아무것도 그리지 않는다 — 회의록에서 오지 않은 작업이 대부분이라 빈 안내는 잡음이다. 읽는 동안도 그리지 않는다(머리가 깜박이지 않게).
// 액션은 산출물 목록(listAttachments)과 같은 로그인 + 세션(RLS) 읽기라 명단 밖 조회 전용도 연결을 본다. 읽기 실패는 '연결 없음'으로 위장하지 않고
// 오류로 보인다(3원칙 ①) — 첨부 구역(RowDetailPanel 의 AttachmentSection)처럼 어떤 실패든 구역을 남기고 오류를 보인다. 거부에 가까운 답은
// 로그인 필요(ERR_ANON)·못 읽거나 없는 항목(ERR_MISSING)이고 이것도 오류다. 단 회의록 모듈이 꺼졌으면(관문의 module_disabled) 구역을 닫는다
// — 꺼진 모듈의 화면은 그리지 않는다(정본 §3.2.4 — 설정을 못 읽은 fail-closed 도 같은 코드이고 사유는 서버 로그에 있다).
import Link from 'next/link'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { ExternalLink, FileText } from 'lucide-react'
import { getWbsItemMinuteSources, type WbsItemMinuteSourcesResult } from '@/app/actions/minuteWbs'
import { guardCodeOf } from '@/lib/authz/errors'
import { fill } from '@/lib/i18n/translate'
import { minuteSourceHref } from '@/lib/minutes/source'
import { useMinuteLinks } from '@/components/minutes/minuteLinks'
import { useLocale } from '@/components/providers/LocaleProvider'
import { LoadErrorNotice } from '@/components/ui/LoadErrorNotice'

export function WbsMinuteSourceSection({ itemId }: { itemId: string }) {
  const { t } = useLocale()
  const minutesBase = useMinuteLinks().list
  const uid = useId()
  // 'threw' = 호출 자체가 던졌다(네트워크 등). 문구는 렌더 때 사전에서 고른다(AttachmentSection 과 같다).
  const [loaded, setLoaded] = useState<WbsItemMinuteSourcesResult | 'threw' | null>(null)
  // 재시도 — 버튼은 알림 안에 남겨 포커스를 쥐고 aria-busy 로 도는 중을 알린다. 성공해 알림이 사라지면 포커스를 구역 머리로(AttachmentSection 과 같다).
  // retried = 이 작업에서 재시도를 눌렀다 — 그때부터 결과 알림 영역(sr-only)을 둔다. 재시도가 숨김(연결 없음·모듈 꺼짐)으로 끝나 구역이 사라져
  // 버튼의 포커스가 body 로 떨어져도, 이미 있던 영역의 글자가 바뀌어 결과를 읽어 준다.
  const [retrying, setRetrying] = useState(false)
  const [retried, setRetried] = useState(false)
  const refocus = useRef(false)
  const headingRef = useRef<HTMLDivElement>(null)
  // 요청 번호 — 마지막 요청의 응답만 받는다. 늦게 온 앞 작업(또는 앞 재시도)의 응답이 지금 작업을 덮지 않는다.
  const seq = useRef(0)
  const load = useCallback(() => {
    const mine = (seq.current += 1)
    const done = getWbsItemMinuteSources(itemId).then(
      r => { if (seq.current === mine) setLoaded(r) },
      e => {
        console.error('[WbsMinuteSourceSection] 회의록 원문 호출 실패:', e)
        if (seq.current === mine) setLoaded('threw')
      },
    )
    return { mine, done }
  }, [itemId])
  useEffect(() => {
    // 다른 작업 — 호스트는 패널을 key 없이 다시 쓰므로 앞 작업의 읽기·재시도 상태를 모두 걷는다(앞 재시도가 이 작업의 버튼을 묶거나
    // 이 작업의 머리로 포커스를 당기지 않게).
    setLoaded(null); setRetrying(false); setRetried(false)
    refocus.current = false
    void load().done
    return () => { seq.current += 1 }   // 작업이 바뀌거나 패널이 닫히면 도는 응답을 버린다
  }, [load])

  const retry = () => {
    if (retrying) return
    refocus.current = true
    setRetrying(true); setRetried(true)
    const { mine, done } = load()
    void done.finally(() => { if (seq.current === mine) setRetrying(false) })   // 늦게 끝난 앞 재시도가 지금의 표시를 풀지 않는다
  }
  useEffect(() => {
    if (retrying || !refocus.current) return
    refocus.current = false
    if (!document.activeElement || document.activeElement === document.body) headingRef.current?.focus()
  }, [retrying, loaded])

  if (loaded === null) return null
  const list: WbsItemMinuteSourcesResult = loaded === 'threw' ? { ok: false, error: 'threw' } : loaded
  // 숨김 — 연결이 없거나 회의록 모듈이 꺼졌다. 재시도 전이면 알림 영역도 없으므로 아무것도 그리지 않는다(연결 없는 작업은 정말 빈자리다).
  const hidden = list.ok ? list.rows.length === 0 : guardCodeOf(list) === 'module_disabled'

  return (
    <>
      {!hidden && (
        <section data-wbs-minute-sources>
          <div ref={headingRef} tabIndex={-1} data-minute-source-heading className="mb-2 flex items-center gap-2 text-xs font-semibold text-fg-muted">
            <FileText className="h-3.5 w-3.5" aria-hidden /> {t('wbs.minuteSource.title')}
          </div>
          {!list.ok ? (
            // 던졌든 ok:false 든 화면 문구는 사전의 한 문구 — 액션의 사유(list.error)를 그대로 싣지 않는다
            <LoadErrorNotice message={t('wbs.minuteSource.error')} onRetry={retry} busy={retrying} />
          ) : (
            <ul className="space-y-2">
              {list.rows.map(source => {
                // 링크의 설명 — 이 카드의 회의록 제목·날짜·판. '원문 위치 보기' 링크가 여럿이어도 목적이 갈린다(WCAG 2.4.4, 목록 항목도 문맥이다)
                const meta = `${uid}-${source.linkId}`
                return (
                  <li key={source.linkId} data-minute-source={source.linkId} className="rounded-2xl border border-border bg-surface-subtle p-3">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <FileText className="h-3.5 w-3.5 text-action" aria-hidden />
                      <span id={`${meta}-title`} className="text-sm font-semibold text-fg">{source.minuteTitle}</span>
                      <span id={`${meta}-date`} className="text-xs tabular-nums text-fg-muted">{source.minuteDate}</span>
                      <span id={`${meta}-version`} className="chip bg-surface text-neutral">{fill(t('wbs.minuteSource.version'), { n: source.minuteVersionNo })}</span>
                      <Link
                        href={minuteSourceHref(source.minuteId, {
                          blockIndex: source.blockIndex,
                          blockHash: source.blockHash,
                          bodyHash: source.bodyHash,
                        }, source.minuteVersionId, minutesBase)}
                        aria-describedby={`${meta}-title ${meta}-date ${meta}-version`}
                        className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-action hover:text-action-hover"
                      >
                        {t('wbs.minuteSource.open')}<ExternalLink className="h-3.5 w-3.5" aria-hidden />
                      </Link>
                    </div>
                    <p className="mt-2 line-clamp-3 whitespace-pre-wrap [overflow-wrap:anywhere] text-xs leading-5 text-fg-secondary">
                      {source.excerpt}
                    </p>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}
      {retried && (
        // 재시도의 결과 알림 — 누를 때 빈 채로 먼저 둔다(새로 끼운 영역보다 이미 있는 영역의 글자 변화가 읽힌다). 숨김으로 끝나면 구역 대신 이 글자만 남는다
        <p role="status" aria-live="polite" data-minute-source-live className="sr-only">{hidden ? t('wbs.minuteSource.empty') : ''}</p>
      )}
    </>
  )
}
