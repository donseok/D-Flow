'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ChevronDown, ChevronUp, Download, FileText, History } from 'lucide-react'
import { useLocale } from '@/components/providers/LocaleProvider'
import { LoadErrorNotice } from '@/components/ui/LoadErrorNotice'
import { KO_LOCALE } from '@/lib/i18n/format'

export type MinuteVersionListItem = {
  id: string
  versionNo: number
  /** 이 버전이 생성될 당시의 불변 회의록 메타데이터. */
  title?: string | null
  minuteDate?: string | null
  createdAt: string
  createdByName?: string | null
  fileName?: string | null
  /** 업로드된 원본 파일이 있다. URL 은 목록에 싣지 않는다 — 누를 때 onDownload 로 발급한다(서명 TTL 이 짧다). */
  hasFile?: boolean
  viewHref?: string | null
}

export type MinuteVersionPanelProps = {
  versions: MinuteVersionListItem[]
  currentVersionNo?: number | null
  selectedVersionNo?: number | null
  embedded?: boolean
  /** 원본 파일 서명 URL 발급(getMinuteVersionFileUrl). 없으면 받기 버튼을 두지 않는다. */
  onDownload?: (versionId: string) => Promise<{ ok: true; url: string } | { ok: false; error: string }>
  /** 버전 목록 조회 실패 문구 — 있으면 목록 대신 사유와 재시도를 보인다. 접힘과 무관하게 보인다. */
  loadError?: string | null
  /** 버전 시각의 시간대 — 서버가 내려준 회의록 범위 tz(계획 P8, A-4 리뷰 N7). null 이면 범위 달력을 읽지 못한 것 — 시각은 '—' */
  timeZone: string | null
}

function versionDate(value: string, timeZone: string | null) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  if (timeZone === null) return '—'
  return new Intl.DateTimeFormat(KO_LOCALE, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(date)
}

export function MinuteVersionPanel({
  versions,
  currentVersionNo,
  selectedVersionNo,
  embedded = false,
  onDownload,
  loadError = null,
  timeZone,
}: MinuteVersionPanelProps) {
  const { t } = useLocale()
  // 발급 중에는 받기 버튼을 모두 잠근다 — 한 번의 클릭에 URL 하나. 실패 사유는 그 버전 항목 아래에 둔다.
  const [downloading, setDownloading] = useState(false)
  const [downloadErrors, setDownloadErrors] = useState<Record<string, string>>({})
  // 독립 카드(과거 버전 열람 화면)에서만 접는다 — embedded 는 핵심 요약 카드의 접힘 영역
  // 안이라 이중 접기가 되고, 그 화면은 이미 기본 접힘이다.
  // 기본값을 접힘으로 두는 이유: 이 카드가 화면 위쪽을 다 먹어 정작 회의록 본문이 밀려났다.
  // 접힌 헤더가 총 개수와 열람 중 버전을 그대로 알리므로 정보는 잃지 않는다.
  const collapsible = !embedded
  const [open, setOpen] = useState(!collapsible)
  const ordered = [...versions].sort((a, b) => b.versionNo - a.versionNo)
  const resolvedCurrent = currentVersionNo ?? ordered[0]?.versionNo ?? null
  const current = ordered.find(version => version.versionNo === resolvedCurrent) ?? ordered[0] ?? null
  const previous = current
    ? ordered.filter(version => version.id !== current.id)
    : []

  // 조회 실패는 '버전 없음'(패널 없음)이 아니다 — 제목을 남기고 사유를 보인다(에러 처리 3원칙 ①).
  if (loadError) {
    return (
      <section className={embedded ? 'min-w-0' : 'card shrink-0 px-4 py-2'} aria-labelledby="minute-version-title">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-action" aria-hidden />
          <h2 id="minute-version-title" className="text-sm font-bold text-fg">{t('min.version.title')}</h2>
        </div>
        <div className="mt-2"><LoadErrorNotice message={loadError} /></div>
      </section>
    )
  }
  if (!current) return null

  async function download(versionId: string) {
    if (!onDownload || downloading) return
    setDownloading(true)
    setDownloadErrors(prev => {
      const next = { ...prev }
      delete next[versionId]
      return next
    })
    let error: string | null = null
    try {
      const res = await onDownload(versionId)
      // 액션의 사유(한국어 고정 문구)는 서버 로그 몫 — 화면은 사전 문구 하나로.
      if (res.ok) window.open(res.url, '_blank', 'noopener,noreferrer')
      else error = t('min.err.download')
    } catch {
      error = t('min.err.download')
    }
    setDownloading(false)
    if (error) setDownloadErrors(prev => ({ ...prev, [versionId]: error }))
  }

  const renderVersion = (version: MinuteVersionListItem, isCurrent: boolean) => {
    const isSelected = selectedVersionNo === version.versionNo
    return (
    <li
      key={version.id}
      className={`rounded-lg border p-3 ${
        isCurrent || isSelected ? 'border-action/30 bg-action-soft/40' : 'border-border bg-surface'
      }`}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {version.viewHref ? (
          <Link href={version.viewHref} className="inline-flex items-center gap-1.5 text-sm font-bold text-fg hover:text-action">
            <FileText className="h-3.5 w-3.5 text-fg-muted" aria-hidden />
            v{version.versionNo}
          </Link>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-sm font-bold text-fg">
            <FileText className="h-3.5 w-3.5 text-fg-muted" aria-hidden />
            v{version.versionNo}
          </span>
        )}
        {isCurrent && (
          <span className="chip bg-progress-weak text-progress">
            <span className="h-1.5 w-1.5 rounded-full bg-progress" />
            {t('min.version.current')}
          </span>
        )}
        {isSelected && !isCurrent && (
          <span className="chip bg-action-soft text-action">{t('min.version.viewing')}</span>
        )}
        <span className="text-xs tabular-nums text-fg-muted">
          {versionDate(version.createdAt, timeZone)}
        </span>
        {version.createdByName && (
          <span className="text-xs text-fg-secondary">{version.createdByName}</span>
        )}
        {version.hasFile && onDownload && (
          <button
            type="button"
            onClick={() => download(version.id)}
            disabled={downloading}
            aria-label={`${t('min.version.downloadAria')}: ${version.fileName || t('min.version.download')}`}
            className="ml-auto inline-flex max-w-full items-center gap-1 text-xs text-action hover:text-action-hover disabled:opacity-60"
          >
            <Download className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="max-w-48 truncate">
              {version.fileName || t('min.version.download')}
            </span>
          </button>
        )}
      </div>
      {downloadErrors[version.id] && (
        <p role="alert" className="mt-1 flex items-center gap-1.5 text-xs text-fg"><AlertTriangle aria-hidden className="h-3.5 w-3.5 shrink-0 text-danger" />{downloadErrors[version.id]}</p>
      )}
      {!version.hasFile && (
        <p className="mt-1 text-xs text-fg-muted">{t('min.version.noFile')}</p>
      )}
    </li>
    )
  }

  return (
    <section className={embedded ? 'min-w-0' : 'card shrink-0 px-4 py-2'} aria-labelledby="minute-version-title">
      <div className="flex items-center gap-2">
        <History className="h-4 w-4 text-action" aria-hidden />
        <h2 id="minute-version-title" className="text-sm font-bold text-fg">
          {t('min.version.title')}
        </h2>
        {/* 접힘 상태에서도 '몇 번을 보고 있나'가 남아야 한다 — 없으면 기본 접힘이 위쪽 배너
            (MinuteViewer)가 계속 존재한다는 가정에 기대게 된다. 펼치면 같은 신호가 해당 버전
            항목(위 renderVersion)에 붙으므로 그때는 뺀다 — 중복 표시 방지. */}
        {collapsible && !open && selectedVersionNo != null && (
          <span className="chip bg-action-soft text-action">
            v{selectedVersionNo} {t('min.version.viewing')}
          </span>
        )}
        {/* 우측 끝 고정점은 **마지막 요소** 하나뿐이다 — 토글이 있으면 토글이, 없으면(embedded)
            개수가 가져간다. 둘 다 ml-auto 면 맨텍스트 '총 2개'와 '펼치기'가 8px 간격으로 붙어
            한 덩어리로 읽힌다(MinuteInsightCard 는 왼쪽 이웃이 배경 있는 chip 이라 붙어도 구분된다). */}
        <span className={`text-xs text-fg-muted ${collapsible ? '' : 'ml-auto'}`}>
          {t('min.version.total').replace('{n}', String(ordered.length))}
        </span>
        {collapsible && (
          <button onClick={() => setOpen(o => !o)} aria-expanded={open}
            className="ml-auto inline-flex items-center gap-1 text-xs text-fg-secondary hover:text-fg">
            {open
              ? <ChevronUp className="h-3.5 w-3.5" aria-hidden />
              : <ChevronDown className="h-3.5 w-3.5" aria-hidden />}
            {open ? t('min.version.collapse') : t('min.version.expand')}
          </button>
        )}
      </div>

      {/* 카드 인셋이 py-2 라 아래는 그대로 8px 면 되고(InsightCard 와 동일), 위는 wrapper 4px +
          p 의 mt-1 4px = 8px 로 맞춘다. embedded 는 클래스 없는 통과 div — 간격 무변경.
          max-h-96: 상한이 없으면 버전이 8~10개인 회의록에서 펼침 한 번에 카드가 다시 600px 넘게
          자라 본문을 밀어낸다 — 접기로 없앤 문제가 클릭 한 번 뒤로 미뤄질 뿐이다. embedded 는
          MinuteInsightCard 의 펼침 영역(max-h-96 overflow-y-auto)이 이미 감싸므로 붙이지 않는다. */}
      {open && (
        <div className={collapsible ? 'mt-1 max-h-96 overflow-y-auto' : undefined}>
          <p className="mt-1 text-xs text-fg-secondary">{t('min.version.desc')}</p>

          <ul className="mt-3 space-y-2">
            {renderVersion(current, true)}
          </ul>

          {previous.length > 0 && (
            <div className="mt-3 border-t border-border pt-3">
              <p className="eyebrow mb-2">{t('min.version.previous')}</p>
              <ul className="space-y-2">
                {previous.map(version => renderVersion(version, false))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
