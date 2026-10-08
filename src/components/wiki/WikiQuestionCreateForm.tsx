'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CircleHelp, Send, X } from 'lucide-react'
import { createWikiQuestion } from '@/app/actions/wiki'
import type { Locale } from '@/lib/i18n/dict'
import { t } from '@/lib/i18n/dict'

/**
 * 주제에 질문 남기기 — 답이 아직 없는 것을 '열린 항목'에 올린다(답변은 같은 자리의 WikiQuestionAnswerForm).
 * 쓰기 관문은 서버 액션(createWikiQuestion — requireProjectMember + 위키 모듈 관문)이고, 이 폼은 구성원에게만 그린다.
 */
export function WikiQuestionCreateForm({ projectId, topicId, locale }: { projectId: string; topicId: string; locale: Locale }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    const text = question.trim()
    if (!text || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await createWikiQuestion({ projectId, topicId, question: text })
      if (!result.ok) {
        setError(result.error ?? t(locale, 'wiki.ask.questionFailed'))
        return
      }
      setQuestion('')
      setOpen(false)
      router.refresh()
    } catch (e) {
      console.error('[wiki] 질문 등록 — 응답을 받지 못했다', e)
      setError(t(locale, 'wiki.ask.questionFailed'))
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn btn-ghost mt-3 h-8 px-3 text-xs" data-testid="wiki-question-open">
        <CircleHelp className="h-3.5 w-3.5" aria-hidden />
        {t(locale, 'wiki.ask.leaveQuestion')}
      </button>
    )
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-fg-secondary">{t(locale, 'wiki.question.askLabel')}</span>
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          maxLength={2_000}
          rows={3}
          autoFocus
          className="app-textarea resize-y text-sm leading-6"
          placeholder={t(locale, 'wiki.question.askPlaceholder')}
        />
      </label>
      {error && <p className="mt-2 text-xs font-medium text-danger" role="alert">{error}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={() => void submit()} disabled={busy || !question.trim()} className="btn btn-primary h-8 px-3 text-xs" data-testid="wiki-question-submit">
          <Send className="h-3.5 w-3.5" aria-hidden />
          {busy ? t(locale, 'wiki.ask.questionSaving') : t(locale, 'wiki.question.askSubmit')}
        </button>
        <button type="button" onClick={() => { setOpen(false); setError(null) }} disabled={busy} className="btn btn-ghost h-8 px-3 text-xs">
          <X className="h-3.5 w-3.5" aria-hidden />
          {t(locale, 'wiki.document.cancel')}
        </button>
      </div>
    </div>
  )
}
