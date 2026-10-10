'use client'
// 프로젝트 설정 맨 아래 '위험 구역' — 프로젝트 삭제(사용자 테스트 BUG-18). 워크스페이스 관리자에게만 그린다(판정은 페이지, 다시 서버 액션·RPC).
// 삭제는 되돌릴 수 없다 — 프로젝트 이름을 사람이 직접 적어야 확정 단추가 열리고, 서버가 그 글자를 그 프로젝트의 이름과 다시 대조한다.
// 회의록이 있으면 단추 대신 막힌 이유와 건수를 보인다(회의록은 프로젝트와 함께 지우지 않는다). 지워질 것을 읽지 못했으면 삭제를 열지 않는다.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'
import { deleteProject, type ProjectDeleteSummaryResult } from '@/app/actions/projectDelete'
import { useLocale } from '@/components/providers/LocaleProvider'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import type { DictKey } from '@/lib/i18n/dict'
import { withObjectParticle } from '@/lib/i18n/particle'
import { PROJECT_DELETE_COUNT_KEYS } from '@/lib/project/deleteSummary'

const fill = (text: string, vars: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))

export function ProjectDeleteZone({ projectId, projectName, workspaceSlug, summary }: {
  projectId: string
  projectName: string
  /** 삭제 뒤 돌아갈 프로젝트 목록(/w/<slug>/projects)의 주소 */
  workspaceSlug: string
  /** 서버가 읽은 사전 조회 결과 — 실패면 삭제를 열지 않는다 */
  summary: ProjectDeleteSummaryResult
}) {
  const router = useRouter()
  const { toast } = useToast()
  const { t } = useLocale()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 서버가 거부하며 알려 준 회의록 수(화면을 연 뒤에 회의록이 생긴 경우) — 있으면 사전 조회 값보다 이것을 믿는다
  const [late, setLate] = useState<{ minutes: number; archived: number } | null>(null)

  const quoted = fill(t('settings.danger.quoted'), { name: projectName })
  // 서버와 같은 대조 — 양끝 공백만 뗀다(대소문자·안쪽 공백은 그대로 본다)
  const matches = typed.trim() === projectName.trim() && typed.trim() !== ''
  const minutes = late?.minutes ?? (summary.ok ? summary.minutes : 0)
  const archived = late?.archived ?? (summary.ok ? summary.minutesArchived : 0)
  const blocked = minutes > 0
  const counts = summary.ok ? PROJECT_DELETE_COUNT_KEYS.filter((key) => summary.counts[key] > 0) : []

  const close = () => { if (!pending) { setOpen(false); setTyped(''); setError(null) } }

  const submit = (event?: React.FormEvent) => {
    event?.preventDefault()
    if (!matches || pending) return
    setError(null)
    // 전환(useTransition) 안에서 액션을 기다린 뒤 이동하면 이 설정 화면에서는 갱신이 붙지 않았다(ProjectInfoEditButton 의 BUG-06).
    // 액션은 그냥 기다리고, 끝난 뒤 전환 밖에서 이동한다.
    setPending(true)
    void (async () => {
      let res: Awaited<ReturnType<typeof deleteProject>>
      try {
        res = await deleteProject(projectId, typed)
      } catch (e) {
        // 요청이 끊겼다 — 지워졌는지 모른다. 지워졌다고도, 안 지워졌다고도 하지 않는다
        console.error('[ProjectDeleteZone] 삭제 요청 실패:', e)
        setPending(false)
        setError(t('settings.danger.requestFailed'))
        return
      }
      if (!res.ok) {
        setPending(false)
        if (res.code === 'has_minutes' && typeof res.minutes === 'number') {
          // 막힌 이유는 대화상자가 아니라 구역에 그린다(단추가 사라지고 건수가 보인다)
          setLate({ minutes: res.minutes, archived: res.minutesArchived ?? 0 })
          setOpen(false)
          setTyped('')
          return
        }
        setError(res.error)
        return
      }
      const notes = [
        res.orphanedFiles > 0 ? fill(t('settings.danger.orphaned'), { n: res.orphanedFiles }) : null,
        res.filesUnchecked ? t('settings.danger.filesUnchecked') : null,
      ].filter((x): x is string => x !== null)
      toast({
        title: fill(t('settings.danger.deleted'), { name: withObjectParticle(fill(t('settings.danger.quoted'), { name: res.name })) }),
        ...(notes.length ? { description: notes.join(' ') } : {}),
        variant: notes.length ? 'info' : 'success',
      })
      // 지운 프로젝트의 화면에 머물지 않는다 — 뒤로 가기로 돌아오지 않게 replace
      router.replace(`/w/${encodeURIComponent(workspaceSlug)}/projects`)
    })()
  }

  return (
    <div data-project-danger className="space-y-4">
      <div>
        <h4 className="text-sm font-semibold text-fg">{t('settings.danger.deleteHeading')}</h4>
        <p className="mt-1 text-sm leading-6 text-fg-secondary">{t('settings.danger.deleteDesc')}</p>
      </div>

      {!summary.ok && !late ? (
        <p role="alert" data-danger-summary-failed className="text-sm font-medium text-danger">{t('settings.danger.summaryFailed')}</p>
      ) : (
        <>
          {summary.ok && (
            <div data-danger-counts className="rounded-xl border border-border bg-surface-subtle px-4 py-3">
              <p className="text-sm font-semibold text-fg">{t('settings.danger.countsTitle')}</p>
              {counts.length === 0 ? (
                <p className="mt-1 text-sm text-fg-secondary">{t('settings.danger.countsEmpty')}</p>
              ) : (
                <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-fg-secondary">
                  {counts.map((key) => (
                    <li key={key} data-danger-count={key}>{fill(t(`settings.danger.count.${key}` as DictKey), { n: summary.counts[key] })}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {blocked ? (
            <div role="alert" data-danger-blocked className="flex gap-3 rounded-xl border border-danger/30 bg-danger-weak px-4 py-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-fg">{fill(t('settings.danger.blockedTitle'), { n: minutes })}</p>
                <p className="text-sm leading-6 text-fg-secondary">{t('settings.danger.blockedDesc')}</p>
                {archived > 0 && (
                  <p data-danger-blocked-archived className="text-sm leading-6 text-fg-secondary">{fill(t('settings.danger.blockedArchived'), { n: archived })}</p>
                )}
              </div>
            </div>
          ) : (
            <Button variant="danger" data-danger-open onClick={() => setOpen(true)}>{t('settings.danger.open')}</Button>
          )}
        </>
      )}

      <Modal open={open} onClose={close} title={t('settings.danger.modalTitle')} size="md"
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={pending}>{t('common.cancel')}</Button>
            <Button variant="danger" data-danger-confirm onClick={() => submit()} disabled={!matches} busy={pending}>
              {pending ? t('settings.danger.deleting') : t('settings.danger.submit')}
            </Button>
          </>
        }>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <p className="text-sm font-semibold text-fg" data-danger-target>{fill(t('settings.danger.target'), { name: quoted })}</p>
          <p className="text-sm font-medium text-danger">{t('settings.danger.warn')}</p>
          <Field label={fill(t('settings.danger.confirmField'), { name: withObjectParticle(quoted) })}>
            {(c) => <input {...c} data-danger-name value={typed} onChange={(e) => { setTyped(e.target.value); setError(null) }}
              autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={pending} />}
          </Field>
          {error && <p role="alert" data-danger-error className="text-sm font-medium text-danger">{error}</p>}
        </form>
      </Modal>
    </div>
  )
}
