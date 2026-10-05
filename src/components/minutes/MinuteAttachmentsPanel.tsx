'use client'
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Download, Eye, FileText, Loader2, Paperclip, Plus, RotateCw, Trash2, X } from 'lucide-react'
import type { MinuteFile } from '@/lib/domain/types'
import type { DictKey } from '@/lib/i18n/dict'
import { stampedFileName } from '@/lib/domain/minutes'
import { makeStoragePath } from '@/lib/domain/storagePath'
import type { AttachmentPolicy, AttachmentPreviewKind } from '@/lib/minutes/attachmentPolicy'
import {
  drop, enqueue, formatBytes, mayPreview, nextPending, reservedUsage, retry, setStatus, type QueueItem,
} from '@/lib/minutes/attachmentQueue'
import {
  fetchMinuteAttachmentPolicy, getMinuteFilePreviewUrl, getMinuteFileUrl, recordMinuteFile, removeMinuteFile,
} from '@/app/actions/minutes'
import { createBrowserClient } from '@/lib/supabase/client'
import { useLocale } from '@/components/providers/LocaleProvider'
import { useToast } from '@/components/ui/Toast'
import { Modal } from '@/components/ui/Modal'

const BUCKET = 'minutes'

type PolicyState = { kind: 'loading' } | { kind: 'ok'; policy: AttachmentPolicy } | { kind: 'failed'; error: string }
type Preview = { fileName: string; url: string; kind: AttachmentPreviewKind }

function fileDate(value: string, locale: 'ko' | 'en', timeZone: string | null): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime()) || timeZone === null) return '—'
  return new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone }).format(date)
}

/**
 * 회의록 상세의 첨부 섹션(SP5 B3 과제 8) — 목록·등록자/일자/크기·정책 안내/남은 수·추가(버튼/드래그)·미리보기·삭제.
 * 정책은 서버가 회의록 행의 실제 범위로 읽는다(fetchMinuteAttachmentPolicy). 여기의 판정은 안내·사전 확인용이고,
 * 확정의 최종 권한·한도는 DB 가드(0021), 삭제는 서버 톰스톤(removeMinuteFile), 미리보기 허용은 서버(getMinuteFilePreviewUrl)가 한다.
 * 본문 .md 업로드(새 버전)는 이 패널과 분리돼 있다.
 */
export function MinuteAttachmentsPanel({
  minuteId, workspaceId, projectId, files, filesError = null, canManage, timeZone,
}: {
  minuteId: string
  /** 업로드 경로 scope — 회의록 행의 워크스페이스·프로젝트(서버 검증기·DB 가드가 같은 행 값으로 대조한다). */
  workspaceId: string | null
  projectId: string | null
  /** 활성 첨부만(세션 읽기 정책이 톰스톤을 가린다). */
  files: MinuteFile[]
  filesError?: string | null
  /** 서버 checkOwner 와 같은 canEditMinute — 아니면 추가·삭제를 그리지 않는다. */
  canManage: boolean
  timeZone: string | null
}) {
  const router = useRouter()
  const { t, locale } = useLocale()
  const { toast } = useToast()
  const [policy, setPolicy] = useState<PolicyState>({ kind: 'loading' })
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  // 대기열 항목의 원본 File — 상태(직렬화 가능한 값)와 분리해 보관한다. 재시도도 같은 File 을 새 경로로 다시 올린다.
  const filesRef = useRef(new Map<string, File>())
  const aliveRef = useRef(true)
  // 효과 의존성에서 t 를 뺀다 — 문구 함수가 바뀌어도 정책을 다시 묻거나 처리 효과를 다시 돌릴 이유가 없다.
  const tRef = useRef(t)
  tRef.current = t
  // 미리보기 요청 세대 — 늦게 도착한 이전 응답이 닫힌 뒤 또는 다른 파일 위에 열리지 않게 한다.
  const previewSeq = useRef(0)

  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  useEffect(() => {
    let alive = true
    setPolicy({ kind: 'loading' })
    fetchMinuteAttachmentPolicy(minuteId)
      .then(res => { if (alive) setPolicy(res.ok ? { kind: 'ok', policy: res.policy } : { kind: 'failed', error: res.error }) })
      .catch(e => {
        console.error('[MinuteAttachmentsPanel] 첨부 정책 조회 실패:', e)
        if (alive) setPolicy({ kind: 'failed', error: tRef.current('min.att.policyFailed') })
      })
    return () => { alive = false }
  }, [minuteId])

  const pol = policy.kind === 'ok' ? policy.policy : null
  const canAdd = canManage && !!workspaceId && pol !== null && pol.enabled
  const usage = reservedUsage(files, [])

  const addFiles = useCallback((picked: File[]) => {
    if (!pol || picked.length === 0) return
    setErr(null)
    const entries = picked.map(f => {
      const key = crypto.randomUUID()
      filesRef.current.set(key, f)
      return { key, name: f.name, size: f.size }
    })
    setQueue(q => enqueue(pol, files, q, entries))
  }, [pol, files])

  // 대기 항목을 하나씩 처리한다 — 전송 → 확정. 실패하면 방금 올린 객체를 지우고(보상) 실패로 둔다.
  useEffect(() => {
    const item = nextPending(queue)
    if (!item || !workspaceId) return
    const file = filesRef.current.get(item.key)
    const t = tRef.current
    if (!file) { setQueue(q => setStatus(q, item.key, 'failed', t('min.err.upload'))); return }
    setQueue(q => setStatus(q, item.key, 'uploading'))
    void (async () => {
      const sb = createBrowserClient()
      let path: string | null = null
      try {
        path = makeStoragePath({
          workspaceId, projectId, entity: 'minute-files', entityId: minuteId, fileName: stampedFileName(file.name, Date.now()),
        })
        const up = await sb.storage.from(BUCKET).upload(path, file, { upsert: false })
        if (up.error) throw new Error(`${t('min.err.upload')}: ${up.error.message}`)
        if (!aliveRef.current) return
        setQueue(q => setStatus(q, item.key, 'recording'))
        const rec = await recordMinuteFile(minuteId, {
          role: 'attachment', fileName: file.name, filePath: path, size: file.size, mime: file.type || 'application/octet-stream',
        })
        if (!rec.ok) {
          await sb.storage.from(BUCKET).remove([path])
          throw new Error(rec.error ?? t('min.err.record'))
        }
        filesRef.current.delete(item.key)
        if (!aliveRef.current) return
        setQueue(q => drop(q, item.key, { force: true }))
        router.refresh()
      } catch (e) {
        console.error('[MinuteAttachmentsPanel] 첨부 업로드 실패:', e)
        if (aliveRef.current) setQueue(q => setStatus(q, item.key, 'failed', e instanceof Error ? e.message : String(e)))
      }
    })()
  }, [queue, workspaceId, projectId, minuteId, router])

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const picked = [...(e.target.files ?? [])]
    e.target.value = ''
    addFiles(picked)
  }
  function onDrop(e: DragEvent<HTMLElement>) {
    if (!canAdd) return
    e.preventDefault()
    setDragOver(false)
    addFiles([...e.dataTransfer.files])
  }

  async function onDownload(f: MinuteFile) {
    setBusyId(f.id); setErr(null)
    const res = await getMinuteFileUrl(f.id)
    setBusyId(null)
    if (res.ok && res.url) window.open(res.url, '_blank', 'noopener,noreferrer')
    else setErr(res.error ?? t('min.err.download'))
  }

  async function onPreview(f: MinuteFile) {
    const seq = ++previewSeq.current
    setBusyId(f.id); setErr(null)
    const res = await getMinuteFilePreviewUrl(f.id).catch((e: unknown) => {
      console.error('[MinuteAttachmentsPanel] 미리보기 실패:', e)
      return { ok: false as const, error: t('min.att.previewFailed') }
    })
    if (!aliveRef.current || seq !== previewSeq.current) return
    setBusyId(null)
    if (res.ok) setPreview({ fileName: f.fileName, url: res.url, kind: res.kind })
    else setErr(res.error)
  }
  function closePreview() {
    previewSeq.current++
    setPreview(null)
  }

  async function onDelete(f: MinuteFile) {
    setConfirmId(null); setBusyId(f.id); setErr(null)
    const res = await removeMinuteFile(f.id)
    if (!aliveRef.current) return
    setBusyId(null)
    // 실패면 목록에서 빼지 않는다 — 서버가 톰스톤을 찍지 못했다.
    if (!res.ok) { setErr(res.error ?? t('min.att.deleteFailed')); return }
    toast({ title: t('min.att.deleteDone'), variant: 'success' })
    router.refresh()
  }

  const remaining = pol ? Math.max(0, pol.maxCount - usage.count) : null

  return (
    <section
      aria-labelledby={`min-att-${minuteId}`}
      className={`card shrink-0 space-y-2 px-4 py-3 ${dragOver ? 'ring-2 ring-brand' : ''}`}
      onDragOver={canAdd ? e => { e.preventDefault(); setDragOver(true) } : undefined}
      onDragLeave={canAdd ? () => setDragOver(false) : undefined}
      onDrop={canAdd ? onDrop : undefined}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id={`min-att-${minuteId}`} className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Paperclip aria-hidden className="h-4 w-4 text-ink-muted" />{t('min.att.title')}
        </h2>
        {pol && (
          <span className="text-xs tabular-nums text-ink-muted">
            {t('min.att.usage')
              .replace('{n}', String(usage.count)).replace('{max}', String(pol.maxCount))
              .replace('{bytes}', formatBytes(usage.bytes)).replace('{total}', formatBytes(pol.maxTotalBytes))}
          </span>
        )}
        {policy.kind === 'loading' && <span className="text-xs text-ink-subtle">{t('min.att.policyLoading')}</span>}
        {canAdd && (
          <label className={`btn ml-auto h-8 cursor-pointer px-2.5 text-xs ${remaining === 0 ? 'pointer-events-none opacity-50' : ''}`}
            aria-disabled={remaining === 0}>
            <Plus aria-hidden className="h-3.5 w-3.5" />{t('min.att.add')}
            <input type="file" multiple className="sr-only" onChange={onPick} disabled={remaining === 0}
              accept={pol?.allowedExtensions ? pol.allowedExtensions.map(e => `.${e}`).join(',') : undefined} />
          </label>
        )}
      </div>

      {pol && canManage && pol.enabled && (
        <p className="text-xs text-ink-subtle">
          {t('min.att.policyHint').replace('{size}', formatBytes(pol.maxFileBytes))}
          {pol.allowedExtensions !== null && (
            <> · {pol.allowedExtensions.length > 0
              ? t('min.att.extHint').replace('{exts}', pol.allowedExtensions.join(', '))
              : t('min.att.extNone')}</>
          )}
        </p>
      )}
      {pol && canManage && !pol.enabled && <p className="text-xs text-ink-muted">{t('min.att.disabled')}</p>}
      {policy.kind === 'failed' && canManage && <p role="alert" className="text-xs text-delayed">{policy.error}</p>}
      {filesError && <p role="alert" className="text-sm text-delayed">{t('min.detail.filesLoadFailed')}</p>}

      {!filesError && files.length === 0 && queue.length === 0 && (
        <p className="text-xs text-ink-subtle">{canAdd ? t('min.att.drop') : t('min.att.empty')}</p>
      )}

      {(files.length > 0 || queue.length > 0) && (
        <ul className="divide-y divide-line rounded-md border border-line">
          {files.map(f => (
            <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <FileText aria-hidden className="h-4 w-4 shrink-0 text-ink-subtle" />
              <button type="button" onClick={() => void onDownload(f)} disabled={busyId === f.id}
                title={t('min.att.download')}
                className="min-w-0 basis-[calc(100%-1.75rem)] truncate text-left text-sm font-medium text-ink hover:text-brand sm:flex-1 sm:basis-0">
                {f.fileName}
              </button>
              <span className="text-xs tabular-nums text-ink-muted">{formatBytes(f.size)}</span>
              <span className="text-xs text-ink-subtle">
                {t('min.att.by')
                  .replace('{name}', f.uploadedByName ?? t('min.att.unknownUser'))
                  .replace('{date}', fileDate(f.createdAt, locale, timeZone))}
              </span>
              <span className="flex items-center gap-1">
                {busyId === f.id && <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin text-ink-subtle" />}
                {mayPreview(pol, f.fileName) && (
                  <button type="button" onClick={() => void onPreview(f)} disabled={busyId === f.id}
                    className="btn btn-ghost h-7 px-2 text-xs" aria-label={`${t('min.att.preview')} ${f.fileName}`}>
                    <Eye aria-hidden className="h-3.5 w-3.5" />
                  </button>
                )}
                <button type="button" onClick={() => void onDownload(f)} disabled={busyId === f.id}
                  className="btn btn-ghost h-7 px-2 text-xs" aria-label={`${t('min.att.download')} ${f.fileName}`}>
                  <Download aria-hidden className="h-3.5 w-3.5" />
                </button>
                {canManage && (confirmId === f.id ? (
                  <>
                    <button type="button" onClick={() => void onDelete(f)} className="btn h-7 px-2 text-xs text-delayed">
                      {t('min.att.deleteConfirm')}
                    </button>
                    <button type="button" onClick={() => setConfirmId(null)} className="btn btn-ghost h-7 px-2 text-xs">
                      {t('min.att.cancel')}
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={() => setConfirmId(f.id)} disabled={busyId === f.id}
                    className="btn btn-ghost h-7 px-2 text-xs text-delayed" aria-label={`${t('min.att.delete')} ${f.fileName}`}>
                    <Trash2 aria-hidden className="h-3.5 w-3.5" />
                  </button>
                ))}
              </span>
            </li>
          ))}
          {queue.map(q => (
            <li key={q.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              {q.status === 'failed'
                ? <X aria-hidden className="h-4 w-4 shrink-0 text-delayed" />
                : <Loader2 aria-hidden className={`h-4 w-4 shrink-0 text-ink-subtle ${q.status === 'pending' ? '' : 'animate-spin'}`} />}
              <span className="min-w-0 basis-[calc(100%-1.75rem)] truncate text-sm text-ink-muted sm:flex-1 sm:basis-0">{q.fileName}</span>
              <span className="text-xs tabular-nums text-ink-muted">{formatBytes(q.size)}</span>
              <span className={`text-xs ${q.status === 'failed' ? 'text-delayed' : 'text-ink-subtle'}`} role={q.status === 'failed' ? 'alert' : undefined}>
                {q.status === 'failed'
                  ? (q.rejection ? t(`min.att.reject.${q.rejection}` as DictKey) : q.error ?? t('min.att.status.failed'))
                  : t(`min.att.status.${q.status}` as DictKey)}
              </span>
              <span className="flex items-center gap-1">
                {q.status === 'failed' && q.retryable && pol && (
                  <button type="button" onClick={() => setQueue(cur => retry(pol, files, cur, q.key))} className="btn btn-ghost h-7 px-2 text-xs">
                    <RotateCw aria-hidden className="h-3.5 w-3.5" />{t('min.att.retry')}
                  </button>
                )}
                {(q.status === 'failed' || q.status === 'pending') && (
                  <button type="button" onClick={() => { filesRef.current.delete(q.key); setQueue(cur => drop(cur, q.key)) }}
                    className="btn btn-ghost h-7 px-2 text-xs">
                    {q.status === 'failed' ? t('min.att.dismiss') : t('min.att.cancel')}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {err && <p role="alert" className="text-sm text-delayed">{err}</p>}

      <Modal open={preview !== null} onClose={closePreview} title={preview?.fileName ?? t('min.att.previewTitle')} size="lg"
        footer={preview && (
          <div className="flex w-full justify-end">
            <a href={preview.url} target="_blank" rel="noopener noreferrer" className="btn text-xs">{t('min.att.openNewTab')}</a>
          </div>
        )}>
        {/* 서명 URL 은 Storage 출처라 앱과 다른 출처다. 이미지만 img 로, PDF 는 브라우저 뷰어 iframe 으로 — 서버가 안전 형식·객체 MIME 일 때만 서명했다. */}
        {preview?.kind === 'image' && (
          // eslint-disable-next-line @next/next/no-img-element -- 60초 서명 URL 이라 next/image 최적화 대상이 아니다
          <img src={preview.url} alt={preview.fileName} className="mx-auto max-h-[70vh] max-w-full object-contain" />
        )}
        {preview?.kind === 'pdf' && (
          <iframe src={preview.url} title={preview.fileName} className="h-[70vh] w-full rounded border border-line" referrerPolicy="no-referrer" />
        )}
      </Modal>
    </section>
  )
}
