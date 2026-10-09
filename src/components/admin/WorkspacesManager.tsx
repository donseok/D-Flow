'use client'

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createPlatformWorkspace, type PlatformWorkspaceCreateCode, type PlatformWorkspaceRow } from '@/app/actions/platformWorkspaces'
import { useLocale } from '@/components/providers/LocaleProvider'
import { Field } from '@/components/ui/Field'
import { StatusMessage } from '@/components/ui/StatusMessage'
import type { DictKey } from '@/lib/i18n/dict'
import { NON_CORE_MODULES, type ModuleId } from '@/lib/modules/defaults'
import { MODULE_LABEL_KEY } from '@/lib/modules/labels'
import { checkWorkspaceCreate, splitDomainsInput, suggestedInviteDomain, type WorkspaceCreateField } from '@/lib/workspace/createInput'
import { wsHref } from '@/lib/workspace/paths'
import { DeleteWorkspaceDialog, RenameWorkspaceDialog } from './WorkspaceRowDialogs'

/** '{n}' 꼴 자리 채우기 — 사전 문구의 수·이름 */
const fill = (text: string, vars: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))

/** 브라우저 시간대 — 생성 폼의 첫 값(개정 §4.2.6 "새 워크스페이스는 생성 폼 값"). 읽지 못하면 비워 둔다(= 제품 기본값) */
function browserTimezone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone ?? '' } catch { return '' }
}

type Failure = { code: PlatformWorkspaceCreateCode | 'unknown'; field: WorkspaceCreateField | null }

/**
 * 워크스페이스 목록·생성(개정 §5.3.2) — 플랫폼 관리자 전용 화면의 본문. 목록은 서버가 읽어 넘기고(rows), 생성은 서버 액션이 다시 가드·검증한다.
 * 화면의 사전 검증은 같은 순수 함수(checkWorkspaceCreate)라 서버 판정과 어긋나지 않는다.
 */
export function WorkspacesManager({ rows, accountsHref }: {
  rows: PlatformWorkspaceRow[]
  /** 계정 관리 화면(현재 워크스페이스의 것) — 첫 관리자 계정이 없을 때 안내할 링크. 소속이 없으면 null */
  accountsHref: string | null
}) {
  const { t } = useLocale()
  const router = useRouter()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  // 서버 렌더와 첫 그림을 맞추려고 빈 값으로 시작하고, 붙은 뒤에 브라우저 시간대를 제안한다(서버의 시간대가 폼에 찍히지 않게)
  const [timezone, setTimezone] = useState('')
  useEffect(() => { setTimezone((cur) => cur || browserTimezone()) }, [])
  const [modules, setModules] = useState<ModuleId[]>([...NON_CORE_MODULES])
  // 초대 허용 도메인(선택) — 비우면 초대가 막힌 채로 시작한다(정책 기본값). 첫 관리자 이메일의 도메인은 제안만 한다: 자동으로 채우지 않는다
  // (공용 메일 도메인이 조용히 허용 범위가 되지 않게 — 사람이 눌러 넣는다)
  const [domains, setDomains] = useState('')
  const domainSuggestion = suggestedInviteDomain(adminEmail)
  const showSuggestion = domainSuggestion !== null && !splitDomainsInput(domains).map((d) => d.toLowerCase().replace(/^@/, '')).includes(domainSuggestion)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [created, setCreated] = useState<{ slug: string; name: string } | null>(null)
  const [pending, startTransition] = useTransition()
  // 행 작업(이름 바꾸기·삭제) — 대화상자는 한 번에 하나. 결과 한 줄은 목록 아래에 남긴다(대화상자는 닫힌 뒤다)
  const [dialog, setDialog] = useState<{ kind: 'rename' | 'delete'; row: PlatformWorkspaceRow } | null>(null)
  const [rowNotice, setRowNotice] = useState<string | null>(null)
  const closeDialog = () => setDialog(null)
  const rowDone = (text: string) => { setDialog(null); setRowNotice(text); router.refresh() }

  const errorText = (f: Failure) => t(`platform.ws.err.${f.code}` as DictKey)
  const fieldError = (field: WorkspaceCreateField) => (failure?.field === field ? errorText(failure) : null)
  const toggle = (id: ModuleId) => setModules(NON_CORE_MODULES.filter((m) => (m === id ? !modules.includes(m) : modules.includes(m))))

  function submit(event: React.FormEvent) {
    event.preventDefault()
    setCreated(null)
    const input = { name, slug, adminEmail, timezone, modules, inviteDomains: splitDomainsInput(domains) }
    const checked = checkWorkspaceCreate(input)
    if (!checked.ok) { setFailure({ code: checked.code, field: checked.field }); return }
    setFailure(null)
    startTransition(async () => {
      try {
        const res = await createPlatformWorkspace(input)
        if (!res.ok) { setFailure({ code: res.code, field: res.field }); return }
        setCreated({ slug: res.workspace.slug, name: res.workspace.name })
        setName(''); setSlug(''); setAdminEmail(''); setDomains('')
        router.refresh()
      } catch (e) {
        // 네트워크·서버 오류 — 원문은 콘솔에만, 화면에는 고정 문구
        console.error('[WorkspacesManager] 생성 요청 실패:', e)
        setFailure({ code: 'unknown', field: null })
      }
    })
  }

  const moduleSummary = (allowed: ModuleId[] | null) => {
    if (allowed === null) return t('platform.ws.modulesUnknown')
    if (allowed.length === 0) return t('platform.ws.modulesCore')
    if (allowed.length === NON_CORE_MODULES.length) return fill(t('platform.ws.modulesAll'), { n: allowed.length })
    return fill(t('platform.ws.modulesSome'), { n: allowed.length, total: NON_CORE_MODULES.length })
  }

  return (
    <div className="space-y-6">
      <section className="card overflow-hidden" data-workspace-list>
        <div className="border-b border-border px-5 py-4 sm:px-6">
          <h2 className="text-sm font-semibold text-fg">{fill(t('platform.ws.listTitle'), { n: rows.length })}</h2>
        </div>
        <div className="p-5 sm:p-6">
          {rows.length === 0 ? (
            <StatusMessage kind="empty" title={t('platform.ws.emptyTitle')} detail={t('platform.ws.emptyDesc')} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs font-semibold text-fg-muted">
                    <th className="py-2 pr-3">{t('platform.ws.colName')}</th>
                    <th className="py-2 pr-3">{t('platform.ws.colSlug')}</th>
                    <th className="py-2 pr-3 text-right">{t('platform.ws.colMembers')}</th>
                    <th className="py-2 pr-3 text-right">{t('platform.ws.colProjects')}</th>
                    <th className="py-2 pr-3">{t('platform.ws.colCreated')}</th>
                    <th className="py-2 pr-3">{t('platform.ws.colModules')}</th>
                    <th className="py-2 pr-3" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((w) => (
                    <tr key={w.id} data-workspace-row={w.slug} className="border-b border-border/60">
                      <td className="py-2.5 pr-3 font-medium text-fg">{w.name}</td>
                      <td className="py-2.5 pr-3 font-mono text-xs text-fg-secondary">{w.slug}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums text-fg-secondary">{w.memberCount}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums text-fg-secondary">{w.projectCount}</td>
                      <td className="py-2.5 pr-3 text-fg-muted">{w.createdAt.slice(0, 10)}</td>
                      <td className="py-2.5 pr-3 text-fg-secondary"
                        title={w.allowedModules?.length ? w.allowedModules.map((m) => t(MODULE_LABEL_KEY[m])).join(', ') : undefined}>
                        {moduleSummary(w.allowedModules)}
                      </td>
                      <td className="py-2.5 pr-3 text-right">
                        <span className="inline-flex items-center gap-3 whitespace-nowrap">
                          <Link href={wsHref(w.slug)} aria-label={fill(t('platform.ws.openLabel'), { name: w.name })}
                            className="font-semibold text-action hover:underline">{t('platform.ws.open')}</Link>
                          <button type="button" data-workspace-rename aria-label={fill(t('platform.ws.renameLabel'), { name: w.name })}
                            onClick={() => { setRowNotice(null); setDialog({ kind: 'rename', row: w }) }}
                            className="font-semibold text-action hover:underline">{t('platform.ws.rename')}</button>
                          <button type="button" data-workspace-delete aria-label={fill(t('platform.ws.deleteLabel'), { name: w.name })}
                            onClick={() => { setRowNotice(null); setDialog({ kind: 'delete', row: w }) }}
                            className="font-semibold text-danger hover:underline">{t('common.delete')}</button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {rowNotice && <p role="status" data-workspace-row-notice className="mt-4 text-sm text-fg">{rowNotice}</p>}
        </div>
      </section>
      {dialog?.kind === 'rename' && (
        <RenameWorkspaceDialog key={dialog.row.id} workspace={dialog.row} onClose={closeDialog}
          onRenamed={(name) => rowDone(fill(t('platform.ws.renamed'), { name }))} />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteWorkspaceDialog key={dialog.row.id} workspace={dialog.row} onClose={closeDialog}
          onDeleted={(name) => rowDone(fill(t('platform.ws.deleted'), { name }))} />
      )}

      <section className="card overflow-hidden" id="create" data-workspace-create>
        <div className="border-b border-border px-5 py-4 sm:px-6">
          <h2 className="text-sm font-semibold text-fg">{t('platform.ws.createTitle')}</h2>
        </div>
        <form onSubmit={submit} className="space-y-5 p-5 sm:p-6" noValidate>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={t('platform.ws.fieldName')} error={fieldError('name')}>
              {(c) => <input {...c} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="off" />}
            </Field>
            <Field label={t('platform.ws.fieldSlug')} description={t('platform.ws.slugHint')} error={fieldError('slug')}>
              {(c) => <input {...c} value={slug} onChange={(e) => setSlug(e.target.value)} maxLength={63} autoComplete="off" autoCapitalize="none" spellCheck={false} />}
            </Field>
            <Field label={t('platform.ws.fieldAdmin')} description={t('platform.ws.adminHint')} error={fieldError('adminEmail')}>
              {(c) => <input {...c} type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} autoComplete="off" />}
            </Field>
            <Field label={t('platform.ws.fieldTimezone')} description={t('platform.ws.timezoneHint')} error={fieldError('timezone')}>
              {(c) => <input {...c} value={timezone} onChange={(e) => setTimezone(e.target.value)} autoComplete="off" spellCheck={false} />}
            </Field>
            <div className="space-y-1.5 sm:col-span-2">
              <Field label={t('platform.ws.fieldDomains')} description={t('platform.ws.domainsHint')} error={fieldError('inviteDomains')}>
                {(c) => <input {...c} data-invite-domains value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="example.com" autoComplete="off" autoCapitalize="none" spellCheck={false} />}
              </Field>
              {showSuggestion && (
                <button type="button" data-domain-suggest className="btn btn-ghost h-8 px-3 text-xs"
                  onClick={() => setDomains((cur) => [...splitDomainsInput(cur), domainSuggestion].join(', '))}>
                  {fill(t('platform.ws.domainsSuggest'), { domain: domainSuggestion })}
                </button>
              )}
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-meta font-semibold text-fg-secondary">{t('platform.ws.fieldModules')}</legend>
            <p className="text-meta text-fg-secondary">{t('platform.ws.modulesHint')}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setModules([...NON_CORE_MODULES])}>{t('platform.ws.selectAll')}</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setModules([])}>{t('platform.ws.clearAll')}</button>
            </div>
            <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
              {NON_CORE_MODULES.map((id) => (
                <label key={id} className="flex min-h-9 items-center gap-2 text-sm text-fg">
                  <input type="checkbox" className="h-4 w-4" checked={modules.includes(id)} onChange={() => toggle(id)} />
                  {t(MODULE_LABEL_KEY[id])}
                </label>
              ))}
            </div>
            {fieldError('modules') && <p className="text-meta font-medium text-danger">{fieldError('modules')}</p>}
          </fieldset>

          {failure && failure.field === null && (
            <StatusMessage kind="partial_error" blocking compact title={errorText(failure)} />
          )}
          {failure?.code === 'admin_not_found' && accountsHref && (
            <p className="text-meta"><Link href={accountsHref} className="font-semibold text-action hover:underline">{t('platform.ws.accountsLink')}</Link></p>
          )}
          {created && (
            <p role="status" className="text-sm text-fg">
              {fill(t('platform.ws.created'), { name: created.name })}{' '}
              <Link href={wsHref(created.slug)} className="font-semibold text-action hover:underline">{t('platform.ws.open')}</Link>
            </p>
          )}
          <div>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? t('platform.ws.submitting') : t('platform.ws.submit')}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
