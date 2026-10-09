'use client'
import { useLocale } from '@/components/providers/LocaleProvider'

/**
 * 권한·프로젝트 조회가 실패했을 때 그 사실을 화면에 드러내는 배너.
 *
 * REST 장애 때 화면이 조회 실패를 '게스트 · 등록된 프로젝트 없음' 으로 그려
 * 로그인 실패로 신고됐다. 에러 처리 3원칙 ①('조회 실패를 데이터 없음으로 위장하지 않는다')
 * 의 표시 절반이 빠져 있던 자리다.
 *
 * 상태도 이벤트도 없다 — 문구만 화면 언어(사전)를 따른다.
 */
export function DegradedNotice({
  actorFailed,
  projectsFailed,
}: {
  actorFailed: boolean
  projectsFailed: boolean
}) {
  const { t } = useLocale()
  if (!actorFailed && !projectsFailed) return null
  const body = actorFailed && projectsFailed ? t('shell.degraded.both')
    : actorFailed ? t('shell.degraded.actor')
      : t('shell.degraded.projects')
  return (
    <div
      role="alert"
      data-degraded-notice
      className="mb-3 rounded-2xl border border-danger/40 bg-danger-weak/50 px-4 py-3"
    >
      <p className="text-sm font-bold text-danger">{t('shell.degraded.title')}</p>
      <p className="mt-1 text-xs text-fg-secondary">
        {body}
      </p>
    </div>
  )
}
