/**
 * 회의록 본문(body_md) 시간대 보정(스펙 SP5 D13 ④).
 *
 * 배경: 외부 AI 전사(녹취) 도구가 회의록 markdown 의 녹음 시각을 UTC 로 기록한다(2026-07 확인).
 * 이 도구 산출물을 업로드할 때 `**시간**:` 한 줄을 **회의록 범위의 시간대**(프로젝트 회의록 = 프로젝트, 무프로젝트 = 워크스페이스)로 옮긴다.
 *
 * 판별(서명 감지): 도구 산출물은 4-마커 메타 헤더(`**날짜**`·`**시간**`·`**상태**`·`**생성자**`)를 가진다. 네 마커가 모두 있을 때만 보정한다.
 * 손으로 쓴 md(이 서명 없음)는 건드리지 않아 이미 올바른 시각의 과보정을 막는다.
 * 이동량은 그 날짜의 오프셋이다(DST) — `**날짜**: YYYY-MM-DD` 가 실재하는 날짜면 그 날, 아니면 fallbackDate(회의록 날짜).
 * 범위 tz 가 UTC 면 이동이 0 이라 보정하지 않는다.
 *
 * 알려진 한계: 외부 도구가 나중에 현지 시각으로 고쳐지면 이 훅이 되레 과보정한다 — 호출부(createMinute/replaceMinuteBody)에서 제거한다.
 */
import { stampIn } from '@/lib/domain/calendar'

/** `- **시간**: HH:MM ~ HH:MM` 한 줄. 캡처: 1=접두, 2=시작, 3=중간, 4=종료, 5=꼬리. */
const TIME_LINE_RE = /^(\s*[-*]\s*\*\*시간\*\*:\s*)(\d{2}:\d{2})(\s*~\s*)(\d{2}:\d{2})(\s*)$/m
/** `- **날짜**: YYYY-MM-DD` — 오프셋을 정할 날짜 */
const DATE_LINE_RE = /^\s*[-*]\s*\*\*날짜\*\*:\s*(\d{4}-\d{2}-\d{2})\s*$/m
/** 녹취툴 메타 헤더 서명 — 네 마커가 모두 있어야 산출물로 판정. */
const SIGNATURE_MARKERS = ['**날짜**:', '**시간**:', '**상태**:', '**생성자**:'] as const

/** 실재하는 달력 날짜인가 — Date.parse 는 '2026-02-30' 을 03-02 로 굴려 받아 주므로 왕복으로 본다 */
function isRealDate(ymd: string): boolean {
  const t = Date.parse(`${ymd}T00:00:00Z`)
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === ymd
}

/** UTC 의 그 날짜 HH:MM 을 tz 의 벽시계 HH:MM 으로(날짜가 넘어가도 시·분만 — 옛 % 24 와 같다) */
function shiftTime(hhmm: string, date: string, timeZone: string): string {
  return stampIn(timeZone, new Date(`${date}T${hhmm}:00Z`)).slice(11, 16)
}

export interface MinuteTimeFix {
  body: string
  corrected: boolean
  /** 보정된 경우 원래 시간 문자열 'HH:MM ~ HH:MM'. */
  from?: string
  /** 보정된 경우 보정 후 시간 문자열 'HH:MM ~ HH:MM'. */
  to?: string
  /** 보정된 경우 옮겨 간 시간대(IANA). 토스트가 꼬리에 적는다 */
  tz?: string
}

/** 녹취툴 산출물이면 `**시간**:` 줄을 UTC → 범위 tz 로 보정. 그 외·UTC 범위는 원본 그대로. */
export function correctMinuteBodyTime(bodyMd: string, opts: { timeZone: string; fallbackDate: string }): MinuteTimeFix {
  const body = bodyMd ?? ''
  if (opts.timeZone === 'UTC') return { body, corrected: false }
  const hasSignature = SIGNATURE_MARKERS.every(mk => body.includes(mk))
  if (!hasSignature) return { body, corrected: false }
  const match = body.match(TIME_LINE_RE)
  if (!match) return { body, corrected: false }
  const fromLine = body.match(DATE_LINE_RE)?.[1]
  const date = fromLine && isRealDate(fromLine) ? fromLine : opts.fallbackDate
  const [, prefix, start, mid, end, tail] = match
  const s = shiftTime(start, date, opts.timeZone)
  const e = shiftTime(end, date, opts.timeZone)
  const next = body.replace(TIME_LINE_RE, `${prefix}${s}${mid}${e}${tail}`)
  return { body: next, corrected: true, from: `${start} ~ ${end}`, to: `${s} ~ ${e}`, tz: opts.timeZone }
}
