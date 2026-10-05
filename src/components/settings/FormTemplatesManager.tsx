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
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [rev, setRev] = useState(revision)
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
        if (upErr) { setError('파일을 올리지 못했습니다. 잠시 후 다시 시도하세요.'); return }
        const reg = await registerFormTemplate(projectId, kind, prepared.path, file.name)
        if (!reg.ok) { setError(reg.error); return }
        const warn = reg.warnings.length ? ` (경고 ${reg.warnings.length}건)` : ''
        done(`양식 v${reg.version} 을 등록했습니다${warn}. 활성화하면 보고서에 쓰입니다.`)
      } catch {
        setError('양식을 등록하지 못했습니다. 잠시 후 다시 시도하세요.')
      }
    })
  }

  function toggle(kind: FormKind, row: FormTemplateRow) {
    setError(''); setNotice(''); setUnmapped(null)
    startTransition(async () => {
      try {
        const command = { expectedRevision: rev, commandId: newUuid() }
        if (row.active) {
          applyResult(await deactivateFormTemplate(projectId, row.id, command), '양식을 해제했습니다. 기본 양식으로 돌아갑니다.')
          return
        }
        const result = await activateFormTemplate(projectId, row.id, command)
        if (!result.ok && result.unmapped?.length) {
          setUnmapped({ kind, templateId: row.id, tokens: result.unmapped })
          setError(result.error)
          return
        }
        applyResult(result, `양식 v${row.version} 을 활성화했습니다.`)
      } catch {
        setError('양식 상태를 바꾸지 못했습니다. 새로고침 후 다시 시도하세요.')
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
        applyResult(result, `매핑을 저장하고 양식 v${row?.version ?? ''} 을 활성화했습니다.`)
      } catch {
        setError('매핑을 저장하지 못했습니다. 새로고침 후 다시 시도하세요.')
      }
    })
  }

  return <div className="space-y-5" data-form-templates-manager>
    {kinds.map((state) => <section key={state.kind} className="space-y-3 rounded-lg border border-line p-3" aria-label={state.label}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">{state.label}</h3>
        <span className="text-xs text-ink-muted">
          {state.templates.some((t) => t.active) ? '사용자 양식 사용 중' : '기본 양식 사용 중'}
        </span>
      </div>
      {state.templates.length === 0
        ? <p className="text-xs text-ink-muted">등록한 양식이 없습니다.</p>
        : <ul className="divide-y divide-line text-sm">
          {state.templates.map((row) => <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
            <span className="font-medium text-ink">v{row.version}</span>
            <span className="min-w-0 flex-1 truncate text-ink-muted" title={row.fileName}>{row.fileName} · {formatBytes(row.sizeBytes)}</span>
            {row.errors > 0 && <span className="text-xs text-delayed">스캔 오류 {row.errors}</span>}
            {row.warnings > 0 && <span className="text-xs text-ink-muted">경고 {row.warnings}</span>}
            {row.active && <span className="rounded bg-done-weak px-1.5 py-0.5 text-xs text-done">활성</span>}
            <button type="button" className="btn" disabled={locked} onClick={() => toggle(state.kind, row)}>
              {row.active ? '해제' : '활성화'}
            </button>
          </li>)}
        </ul>}
      {unmapped?.kind === state.kind && <div className="space-y-2 rounded-lg bg-delayed-weak p-3" role="group" aria-label="미매핑 자리표시자">
        <p className="text-xs text-delayed">아래 자리표시자를 데이터 경로에 연결하세요(예: project.name).</p>
        {unmapped.tokens.map((token) => <label key={token} className="flex flex-col gap-1 text-xs text-ink-muted">
          <code>{token}</code>
          <input className="app-input" aria-label={`${token} 경로`} disabled={locked || !state.setting}
            value={paths[`${state.kind}:${token}`] ?? ''}
            onChange={(e) => setPaths((p) => ({ ...p, [`${state.kind}:${token}`]: e.target.value }))} />
        </label>)}
        <button type="button" className="btn btn-primary" disabled={locked || !state.setting}
          onClick={() => saveMapping(state, unmapped.templateId)}>매핑 저장 후 활성화</button>
        {!state.setting && <p className="text-xs text-delayed">양식 설정이 손상되어 매핑을 저장할 수 없습니다.</p>}
      </div>}
      <label className="flex flex-col gap-1 text-xs text-ink-muted">
        새 양식 올리기 (.{FORM_FORMAT[state.kind]}, 10MB 이하)
        <input type="file" accept={`.${FORM_FORMAT[state.kind]}`} disabled={locked} aria-label={`${state.label} 파일`}
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(state.kind, f) }} />
      </label>
    </section>)}
    {error && <p role="alert" className="text-sm text-delayed">{error}</p>}
    {notice && <p role="status" className="text-sm text-done">{notice}</p>}
  </div>
}
