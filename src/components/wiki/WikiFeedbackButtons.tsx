'use client'

import { useState } from 'react'
import { ClockAlert, ThumbsUp } from 'lucide-react'
import { submitWikiFeedback } from '@/app/actions/wiki'
import { t } from '@/lib/i18n/dict'
import { trackWikiEvent } from './wikiAnalytics'

export function WikiFeedbackButtons({ projectId, topicId }: { projectId: string; topicId: string }) {
  const [busy, setBusy] = useState<'helpful' | 'outdated' | null>(null)
  const [submitted, setSubmitted] = useState<'helpful' | 'outdated' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit(kind: 'helpful' | 'outdated') {
    if (busy || submitted) return
    setBusy(kind)
    setError(null)
    const result = await submitWikiFeedback({ projectId, topicId, kind })
    setBusy(null)
    if (!result.ok) {
      setError(result.error ?? t('wiki.feedback.failed'))
      return
    }
    setSubmitted(kind)
    trackWikiEvent(kind === 'helpful' ? 'wiki_feedback_helpful' : 'wiki_feedback_outdated', `/p/${projectId}/wiki/topics/${topicId}`, {})
  }

  if (submitted) {
    return <p className="rounded-xl bg-success-weak px-3 py-2 text-xs font-medium text-success" role="status">{t('wiki.feedback.thanks')}</p>
  }

  return (
    <div>
      <p className="text-meta font-semibold text-fg-secondary">{t('wiki.feedback.prompt')}</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => void submit('helpful')} disabled={busy !== null} className="btn btn-ghost h-9 px-2 text-xs">
          <ThumbsUp className="h-3.5 w-3.5" aria-hidden />
          {busy === 'helpful' ? t('wiki.feedback.saving') : t('wiki.feedback.helpful')}
        </button>
        <button type="button" onClick={() => void submit('outdated')} disabled={busy !== null} className="btn btn-ghost h-9 px-2 text-xs">
          <ClockAlert className="h-3.5 w-3.5" aria-hidden />
          {busy === 'outdated' ? t('wiki.feedback.saving') : t('wiki.feedback.outdated')}
        </button>
      </div>
      {error && <p className="mt-2 text-xs font-medium text-danger" role="alert">{error}</p>}
    </div>
  )
}
