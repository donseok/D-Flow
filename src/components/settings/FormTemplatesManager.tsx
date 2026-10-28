'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  activateFormTemplate, deactivateFormTemplate, prepareFormTemplateUpload, registerFormTemplate,
  type FormCommandResult,
} from '@/app/actions/formTemplates'
import { updateProjectSettings } from '@/app/actions/settings'
import { newUuid } from '@/lib/domain/uuid'
import { createBrowserClient } from '@/lib/supabase/client'
import { formatBytes } from '@/lib/minutes/attachmentQueue'
import type { FormSetting } from '@/lib/settings/defs/forms'
import { FORM_FORMAT, type FormKind } from '@/lib/report/engine/types'
import { useLocale } from '@/components/providers/LocaleProvider'

export interface FormTemplateRow {
  id: string
  version: number
  fileName: string
  sizeBytes: number
  active: boolean
  createdAt: string
  errors: number
  warnings: number
}

export interface FormKindState {
  kind: FormKind
  label: string
  /** forms.<kind> 설정의 현재 값(매핑 저장 때 그대로 되돌려 쓴다). 손상이면 null — 매핑 편집을 막는다. */
  setting: FormSetting | null
  templates: FormTemplateRow[]
}

const BUCKET = 'form-templates'

export function FormTemplatesManager({ projectId, revision, canEdit, kinds }: {
  projectId: string
  revision: number
  canEdit: boolean
  kinds: FormKindState[]
}) {
  const { t } = useLocale()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [rev, setRev] = useState(revision)
  // 설정 페이지는 이 컴포넌트를 revision 으로 remount 하지 않는다(알림이 refresh 때 사라지지 않게). 대신 서버가 준 revision 이
  // 바뀌면(다른 절의 저장·다른 사람의 변경·방금 명령의 반영) 여기서 CAS 기준을 따라간다 — 알림과 입력 중인 매핑 값은 그대로 둔다.
  const [seenRevision, setSeenRevision] = useState(revision)
  if (revision !== seenRevision) { setSeenRevision(revision); setRev(revision) }
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [unmapped, setUnmapped] = useState<{ kind: FormKind; templateId: string; tokens: string[] } | null>(null)
  const [paths, setPaths] = useState<Record<string, string>>({})
  const locked = !canEdit || pending

  function done(message: string, nextRevision?: number) {
    if (nextRevision !== undefined) setRev(nextRevision)
    setError(''); setNotice(message); router.refresh()
  }
  function applyResult(result: FormCommandResult, message: string) {
    if (result.ok) { done(message, result.revision); return }
    setNotice('')
    setError(result.error)
  }

  function upload(kind: FormKind, file: File) {
    setError(''); setNotice(''); setUnmapped(null)
    startTransition(async () => {
      try {
        const prepared = await prepareFormTemplateUpload(projectId, kind, file.name, file.size)
        if (!prepared.ok) { setError(prepared.error); return }
        const { error: upErr } = await createBrowserClient().storage.from(BUCKET)
          .upload(prepared.path, file, { upsert: false, contentType: file.type || undefined })
        if (upErr) { setError(t('settings.forms.uploadFailed')); return }
        const reg = await registerFormTemplate(projectId, kind, prepared.path, file.name)
        if (!reg.ok) { setError(reg.error); return }
        const version = String(reg.version)
        // 자리표시자가 없으면 활성화해도 내용이 들어갈 자리가 없다 — 켜지 않고 이유를 알린다(목록은 새로 읽어 "경고 1" 이 보이게)
        if (reg.placeholderCount === 0) {
          setNotice(''); setError(t('settings.forms.noPlaceholders').replace('{version}', version)); router.refresh()
          return
        }
        const warn = reg.warnings.length ? t('settings.forms.warnCount').replace('{n}', String(reg.warnings.length)) : ''
        // 표를 자동으로 연결한 양식은 그 양식의 표본 행 수를 한 장당 줄 수로 쓴다 — 사람이 한 장에 그만큼 쓰던 패턴이다.
        // 매핑 저장과 같은 길(설정 갱신 → 새 revision 으로 활성화). 설정 저장에 실패하면 활성화하지 않고 알린다.
        let revision = rev
        const auto = reg.autoTokens
        const current = kinds.find((k) => k.kind === kind)?.setting
        if (auto && current && current.options.max_rows_per_slide !== auto.rowsPerSlide) {
          const patch = {
            expectedRevision: rev, commandId: newUuid(), unset: [] as never[],
            set: { [`forms.${kind}`]: { ...current, options: { ...current.options, max_rows_per_slide: auto.rowsPerSlide } } },
          }
          const saved = await updateProjectSettings(projectId, patch as never)
          if (!saved.ok) { setNotice(''); setError(t('settings.forms.rowsOptionFailed').replace('{version}', version)); router.refresh(); return }
          setRev(saved.revision)
          revision = saved.revision
        }
        // 등록되면 바로 활성화한다 — 올린 사람은 그 양식으로 보고서를 받고 싶어 올린 것이다. 미매핑이면 기존 매핑 상자로 넘어간다.
        let activated: FormCommandResult
        try {
          activated = await activateFormTemplate(projectId, reg.templateId, { expectedRevision: revision, commandId: newUuid() })
        } catch {
          done(t('settings.forms.registered').replace('{version}', version).replace('{warn}', warn))
          setError(t('settings.forms.stateFailed'))
          return
        }
        if (activated.ok) {
          let autoText = ''
          if (auto) {
            autoText = t(auto.columns.name === null ? 'settings.forms.autoLinkedNoName' : 'settings.forms.autoLinked')
              .replace('{slide}', String(auto.slide)).replace('{name}', auto.headers.name).replace('{this}', auto.headers.this).replace('{next}', auto.headers.next)
              + t('settings.forms.autoLinkedRows').replace('{rows}', String(auto.rowsPerSlide))
              + (auto.removedSlides > 0 ? t('settings.forms.autoLinkedRemovedSlides').replace('{n}', String(auto.removedSlides)) : '')
          }
          done(t('settings.forms.registeredActivated').replace('{version}', version).replace('{warn}', warn).replace('{auto}', autoText), activated.revision)
          return
        }
        if (activated.unmapped?.length) {
          setUnmapped({ kind, templateId: reg.templateId, tokens: activated.unmapped })
          done(t('settings.forms.registeredNeedsMapping').replace('{version}', version))
          return
        }
        done(t('settings.forms.registered').replace('{version}', version).replace('{warn}', warn))
        setError(activated.error)
      } catch {
        setError(t('settings.forms.registerFailed'))
      }
    })
  }

  function toggle(kind: FormKind, row: FormTemplateRow) {
    setError(''); setNotice(''); setUnmapped(null)
    startTransition(async () => {
      try {
        const command = { expectedRevision: rev, commandId: newUuid() }
        if (row.active) {
          applyResult(await deactivateFormTemplate(projectId, row.id, command), t('settings.forms.deactivated'))
          return
        }
        const result = await activateFormTemplate(projectId, row.id, command)
        if (!result.ok && result.unmapped?.length) {
          setUnmapped({ kind, templateId: row.id, tokens: result.unmapped })
          setError(result.error)
          return
        }
        applyResult(result, t('settings.forms.activated').replace('{version}', String(row.version)))
      } catch {
        setError(t('settings.forms.stateFailed'))
      }
    })
  }

  function saveMapping(state: FormKindState, templateId: string) {
    if (!state.setting) return
    const mapping = { ...state.setting.mapping }
    for (const token of unmapped?.tokens ?? []) {
      const path = (paths[`${state.kind}:${token}`] ?? '').trim()
      if (path) mapping[token] = path
    }
    setError(''); setNotice('')
    startTransition(async () => {
      try {
        const patch = {
          expectedRevision: rev, commandId: newUuid(), unset: [] as never[],
          set: { [`forms.${state.kind}`]: { ...state.setting!, mapping } },
        }
        const saved = await updateProjectSettings(projectId, patch as never)
        if (!saved.ok) { setError(saved.error); return }
        setRev(saved.revision)
        const row = state.templates.find((t) => t.id === templateId)
        const result = await activateFormTemplate(projectId, templateId, { expectedRevision: saved.revision, commandId: newUuid() })
        if (!result.ok && result.unmapped?.length) {
          setUnmapped({ kind: state.kind, templateId, tokens: result.unmapped }); setError(result.error); return
        }
        setUnmapped(null)
        applyResult(result, t('settings.forms.mappedActivated').replace('{version}', String(row?.version ?? '')))
      } catch {
        setError(t('settings.forms.mapFailed'))
      }
    })
  }

  return <div className="space-y-5" data-form-templates-manager>
    {kinds.map((state) => <section key={state.kind} className="space-y-3 rounded-lg border border-border p-3" aria-label={state.label}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-fg">{state.label}</h3>
        <span className="text-xs text-fg-secondary">
          {state.templates.some((t) => t.active) ? t('settings.forms.usingCustom') : t('settings.forms.usingDefault')}
        </span>
      </div>
      {state.templates.length === 0
        ? <p className="text-xs text-fg-secondary">{t('settings.forms.empty')}</p>
        : <ul className="divide-y divide-border text-sm">
          {state.templates.map((row) => <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
            <span className="font-medium text-fg">v{row.version}</span>
            <span className="min-w-0 flex-1 truncate text-fg-secondary" title={row.fileName}>{row.fileName} · {formatBytes(row.sizeBytes)}</span>
            {row.errors > 0 && <span className="text-xs text-danger">{t('settings.forms.scanErrors').replace('{errors}', String(row.errors))}</span>}
            {row.warnings > 0 && <span className="text-xs text-fg-secondary">{t('settings.forms.warnings').replace('{warnings}', String(row.warnings))}</span>}
            {row.active && <span className="rounded bg-success-weak px-1.5 py-0.5 text-xs text-success">{t('settings.forms.active')}</span>}
            <button type="button" className="btn" disabled={locked} onClick={() => toggle(state.kind, row)}>
              {row.active ? t('settings.forms.deactivate') : t('settings.forms.activate')}
            </button>
          </li>)}
        </ul>}
      {unmapped?.kind === state.kind && <div className="space-y-2 rounded-lg bg-danger-weak p-3" role="group" aria-label={t('settings.forms.unmapped')}>
        <p className="text-xs text-danger">{t('settings.forms.mapHint')}</p>
        {unmapped.tokens.map((token) => <label key={token} className="flex flex-col gap-1 text-xs text-fg-secondary">
          <code>{token}</code>
          <input className="app-input" aria-label={t('settings.forms.pathOf').replace('{token}', String(token))} disabled={locked || !state.setting}
            value={paths[`${state.kind}:${token}`] ?? ''}
            onChange={(e) => setPaths((p) => ({ ...p, [`${state.kind}:${token}`]: e.target.value }))} />
        </label>)}
        <button type="button" className="btn btn-primary" disabled={locked || !state.setting}
          onClick={() => saveMapping(state, unmapped.templateId)}>{t('settings.forms.saveMapActivate')}</button>
        {!state.setting && <p className="text-xs text-danger">{t('settings.forms.corrupted')}</p>}
      </div>}
      <label className="flex flex-col gap-1 text-xs text-fg-secondary">
        {t('settings.forms.uploadNew').replace('{kind}', String(FORM_FORMAT[state.kind]))}
        <input type="file" accept={`.${FORM_FORMAT[state.kind]}`} disabled={locked} aria-label={t('settings.forms.fileOf').replace('{label}', String(state.label))}
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(state.kind, f) }} />
      </label>
    </section>)}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {notice && <p role="status" className="text-sm text-success">{notice}</p>}
  </div>
}
