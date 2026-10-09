'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle2, FileText, Upload, XCircle } from 'lucide-react'
import { previewWbsUpload, applyWbsUpload, type WbsUploadPreview } from '@/app/actions/wbsMarkdown'
import { useLocale } from '@/components/providers/LocaleProvider'

/**
 * wbs.md 웹 업로드 — "자동 부착 + 확인"(스펙 §업로드 경로 2개).
 * 파일을 고르면 서버가 부착점·levels 정합·신규/갱신을 판정해 미리보기 카드를 그리고,
 * 사람은 노드를 고르지 않고 [적용/취소]만 한다. 잘못된 파일이면 부착점 표시에서 드러난다.
 */
export function WbsMarkdownImport({ projectId }: { projectId: string }) {
  const router = useRouter()
  const { t: dictT } = useLocale()
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [preview, setPreview] = useState<WbsUploadPreview | null>(null)
  const [result, setResult] = useState<{ upserted?: number; ordersCreated?: number; unmatched?: Array<{ id: string; assignee: string }>; taskCount?: number; agentStopped?: boolean } | null>(null)
  const [pending, startTransition] = useTransition()

  function reset() {
    setFileName(null); setText(null); setPreview(null); setResult(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    const t = await f.text()
    setFileName(f.name); setText(t); setResult(null)
    startTransition(async () => setPreview(await previewWbsUpload(projectId, t)))
  }

  function apply() {
    if (!text) return
    startTransition(async () => {
      const r = await applyWbsUpload(projectId, text)
      if (!r.ok) {
        setPreview(p => p ? { ...p, errors: [...(p.errors ?? []), r.error ?? dictT('importWizard.md.uploadFailed')], canApply: false } : p)
        return
      }
      setResult(r)
      router.refresh()
    })
  }

  return (
    <div className="card space-y-4 p-6">
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 text-fg-muted" />
        <h3 className="text-sm font-semibold">{dictT('importWizard.md.title')}</h3>
      </div>
      <p className="text-xs leading-5 text-fg-muted">
        {dictT('importWizard.md.intro')}
      </p>

      <div className="flex items-center gap-3">
        <label className="btn btn-ghost cursor-pointer">
          <Upload className="h-3.5 w-3.5" />
          {dictT('importWizard.md.pickFile')}
          <input ref={fileRef} data-md-file type="file" accept=".md,text/markdown" className="hidden" onChange={onFile} disabled={pending} />
        </label>
        <span className="text-xs text-fg-muted">{fileName ?? dictT('importWizard.md.noFile')}</span>
      </div>

      {preview && !preview.ok && (
        <p role="alert" className="rounded-xl border border-danger/30 bg-danger-weak/40 p-3 text-xs text-danger">
          {preview.error}
        </p>
      )}

      {preview?.ok && (
        <div data-md-preview className="space-y-3 rounded-xl border border-border bg-surface-subtle p-4">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-3">
            <Info label={dictT('importWizard.md.kind')} value={preview.mode === 'skeleton' ? dictT('importWizard.md.kindSkeleton') : dictT('importWizard.md.kindModule')} />
            <Info label="module" value={preview.module ?? '—'} />
            <Info
              label={dictT('importWizard.md.attach')}
              value={preview.mode === 'skeleton' ? dictT('importWizard.md.attachRoot') : `${preview.attach ?? '—'} → ${preview.attachRef ?? dictT('importWizard.md.attachUnresolved')}`}
              tone={preview.mode === 'skeleton' || preview.attachFound ? undefined : 'danger'}
            />
            <Info
              label="levels"
              value={preview.levelsStatus === 'seed' ? dictT('importWizard.md.levelsSeed').replace('{n}', String(preview.fileLevels?.length)) : preview.levelsStatus === 'match' ? dictT('importWizard.md.levelsMatch') : dictT('importWizard.md.levelsMismatch')}
              tone={preview.levelsStatus === 'mismatch' ? 'danger' : undefined}
            />
            <Info label={dictT('importWizard.md.newUpdate')} value={`${preview.newCount ?? 0} / ${preview.updateCount ?? 0}`} />
            <Info label={dictT('importWizard.md.fold')} value={String(preview.foldCount ?? 0)} />
          </div>

          {preview.counts && (
            <p className="text-xs text-fg-muted">
              {Object.entries(preview.counts).map(([k, v]) => `${k} ${v}`).join(' · ')}
            </p>
          )}

          {(preview.errors?.length ?? 0) > 0 && (
            <div role="alert" className="rounded-lg border border-danger/30 bg-danger-weak/30 p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-danger">
                <XCircle className="h-3.5 w-3.5" />{dictT('importWizard.md.errors').replace('{n}', String(preview.errors!.length))}
              </p>
              <ul className="mt-1.5 space-y-1 text-xs leading-5 text-fg-secondary">
                {preview.errors!.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
          {(preview.warnings?.length ?? 0) > 0 && (
            <div className="rounded-lg border border-pending/30 bg-pending-weak/30 p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-pending">
                <AlertTriangle className="h-3.5 w-3.5" />{dictT('importWizard.md.warnings').replace('{n}', String(preview.warnings!.length))}
              </p>
              <ul className="mt-1.5 space-y-1 text-xs leading-5 text-fg-secondary">
                {preview.warnings!.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}

          {result ? (
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-success">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {dictT('importWizard.md.applied').replace('{upserted}', String(result.upserted ?? '')).replace('{orders}', String(result.ordersCreated ?? 0))}
                {result.taskCount !== undefined && dictT('importWizard.md.appliedTasks').replace('{n}', String(result.taskCount))}
                {(result.unmatched?.length ?? 0) > 0 && dictT('importWizard.md.appliedUnmatched').replace('{n}', String(result.unmatched!.length)).replace('{names}', () => result.unmatched!.map(u => u.assignee).join(', '))}
              </p>
              {/* 침묵 실패 방지(2026-08-24 리허설 실측) — task 가 있는데 주문 0 이면 원인을 바로 말한다. */}
              {(result.taskCount ?? 0) > 0 && (result.ordersCreated ?? 0) === 0 && (
                <p role="alert" className="flex items-start gap-1.5 rounded-lg border border-pending/30 bg-pending-weak/30 p-3 text-xs text-pending">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    {dictT('importWizard.md.noOrders').replace('{n}', String(result.taskCount))}{' '}
                    {result.agentStopped
                      ? dictT('importWizard.md.noOrdersAgentOff')
                      : dictT('importWizard.md.noOrdersOther')}
                  </span>
                </p>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button data-md-apply className="btn btn-primary" onClick={apply} disabled={pending || !preview.canApply}>
                {dictT('importWizard.md.apply')}
              </button>
              <button data-md-cancel className="btn btn-ghost" onClick={reset} disabled={pending}>
                {dictT('common.cancel')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Info({ label, value, tone }: { label: string; value: string; tone?: 'danger' }) {
  return (
    <div>
      <span className="text-fg-muted">{label}</span>{' '}
      <span className={tone === 'danger' ? 'font-semibold text-danger' : 'font-medium'}>{value}</span>
    </div>
  )
}
