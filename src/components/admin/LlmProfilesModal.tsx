'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Eye, EyeOff, KeyRound, Pencil, PlugZap, Plus, Server, Trash2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { useLocale } from '@/components/providers/LocaleProvider'
import type { DictKey } from '@/lib/i18n/dict'
import {
  createLlmProfile, deleteLlmProfile, listLlmProfiles, testLlmConnection, updateLlmProfile,
  type LlmProfileInput, type LlmProfileMasked,
} from '@/app/actions/llmConfig'

type Provider = 'gemini' | 'openai'

export interface LlmPreset {
  id: string
  label: string
  /** 번역하는 이름(고유명이 아닌 프리셋) — 있으면 label 대신 사전에서 읽는다 */
  labelKey?: DictKey
  provider: Provider
  /** 프리셋이 자동으로 채우는 base_url. 빈값 = 제공자 기본 엔드포인트(서버가 해석) */
  baseUrl: string
  tokenHintKey: DictKey
}

/**
 * 프로필 생성 폼의 서비스 템플릿(스펙 §2).
 * provider 는 D-Flow 의 2종뿐이며, OpenAI 호환 서버(Ollama/LM Studio/사내 LLM)는
 * 전부 openai + base_url 조합으로 커버한다.
 */
export const LLM_PRESETS: readonly LlmPreset[] = [
  { id: 'gemini', label: 'Google Gemini', provider: 'gemini', baseUrl: '', tokenHintKey: 'llm.preset.keyRequired' },
  { id: 'openai', label: 'OpenAI', provider: 'openai', baseUrl: '', tokenHintKey: 'llm.preset.keyRequired' },
  { id: 'ollama', label: 'Ollama', provider: 'openai', baseUrl: 'http://localhost:11434/v1', tokenHintKey: 'llm.preset.keyNotNeeded' },
  { id: 'lmstudio', label: 'LM Studio', provider: 'openai', baseUrl: 'http://localhost:1234/v1', tokenHintKey: 'llm.preset.keyNotNeeded' },
  { id: 'custom', label: 'custom', labelKey: 'llm.preset.custom', provider: 'openai', baseUrl: '', tokenHintKey: 'llm.preset.keyOptional' },
]

/** 저장된 preset_id 의 표시 라벨. 미등록 값(수동 삽입 등)은 원문을 그대로 보여준다. */
export function presetLabel(id: string, t: (k: DictKey) => string): string {
  const p = LLM_PRESETS.find((x) => x.id === id)
  return p ? (p.labelKey ? t(p.labelKey) : p.label) : id
}

type View = 'list' | 'form' | 'delete'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-fg-secondary">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-meta leading-4 text-fg-muted">{hint}</span>}
    </label>
  )
}

export function LlmProfilesModal({
  open, onClose, profiles, onProfilesChange, startInCreate = false,
}: {
  open: boolean
  onClose: () => void
  profiles: LlmProfileMasked[]
  /** CRUD 후 갱신된 목록 — 부모의 dangling 폴백 트리거를 겸한다. */
  onProfilesChange: (profiles: LlmProfileMasked[]) => void
  /** 열릴 때 곧바로 생성 폼으로 진입('＋ 새 프로필 만들기…' 경로) */
  startInCreate?: boolean
}) {
  const { t } = useLocale()
  const [view, setView] = useState<View>('list')
  const [editing, setEditing] = useState<LlmProfileMasked | null>(null)
  const [target, setTarget] = useState<LlmProfileMasked | null>(null) // 삭제 대상
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  // 에러는 스크롤 컨테이너(max-h-70vh) 안에, 저장 버튼은 그 밖 footer 에 있다.
  // 긴 폼에서 에러가 화면 밖에 렌더되면 '눌렀는데 아무 반응 없음'으로 보이므로 뷰로 끌어온다.
  const errorRef = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: 'nearest' })
  }, [error])

  // 폼 상태
  const [presetId, setPresetId] = useState('gemini')
  const [provider, setProvider] = useState<Provider>('gemini')
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [maxOut, setMaxOut] = useState('')
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string } | null>(null)

  function resetForm(p: LlmProfileMasked | null) {
    setEditing(p)
    setPresetId(p?.preset_id ?? 'gemini')
    setProvider(p?.provider ?? 'gemini')
    setName(p?.name ?? '')
    setBaseUrl(p?.base_url ?? '')
    setModel(p?.model ?? '')
    setApiKey('') // 기존 키는 되채우지 않는다(마스킹만 안내) — 빈값 = 유지
    setShowKey(false)
    setMaxOut(p?.max_output_tokens != null ? String(p.max_output_tokens) : '')
    setTestResult(null)
    setError(null)
  }

  // 열릴 때마다 초기 상태로 되돌린다(직전 편집 잔상 방지).
  useEffect(() => {
    if (!open) return
    setTarget(null)
    if (startInCreate) { resetForm(null); setView('form') }
    else { setError(null); setView('list') }
    // startInCreate 는 여는 쪽이 정하는 진입 모드라 open 전환에만 반응하면 된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  /** CRUD 후 목록 재조회 — 실패는 문자열로 돌려 화면에 표시한다(조용한 실패 금지). */
  async function reload(): Promise<string | null> {
    const res = await listLlmProfiles()
    if ('error' in res) return res.error
    onProfilesChange(res.profiles)
    return null
  }

  function applyPreset(p: LlmPreset) {
    // 이름·키 등 이미 입력한 값은 건드리지 않는다 — 프리셋은 provider/base_url 템플릿일 뿐.
    setPresetId(p.id)
    setProvider(p.provider)
    setBaseUrl(p.baseUrl)
    setTestResult(null)
  }

  function buildInput(): LlmProfileInput {
    const input: LlmProfileInput = {
      name: name.trim(),
      preset_id: presetId,
      provider,
      model: model.trim(),
    }
    if (baseUrl.trim()) input.base_url = baseUrl.trim()
    // 키가 빈값이면 필드 자체를 생략 — 서버의 "빈값 = 기존 키 유지" 규칙과 페어다.
    if (apiKey.trim()) input.auth_token = apiKey.trim()
    if (maxOut.trim()) input.max_output_tokens = Number(maxOut)
    return input
  }

  function submitForm() {
    setError(null)
    if (!name.trim()) { setError(t('llm.profile.err.name')); return }
    if (!model.trim()) { setError(t('llm.profile.err.model')); return }
    const input = buildInput()
    startTransition(async () => {
      try {
        const res = editing ? await updateLlmProfile(editing.id, input) : await createLlmProfile(input)
        if ('error' in res) { setError(res.error); return }
        const listError = await reload()
        if (listError) { setError(listError); return }
        setView('list')
      } catch {
        setError(t('wsAccounts.requestFailed'))
      }
    })
  }

  function runTest() {
    setError(null)
    setTestResult(null)
    startTransition(async () => {
      try {
        const res = await testLlmConnection({
          provider,
          model: model.trim(),
          base_url: baseUrl.trim() || undefined,
          auth_token: apiKey.trim() || undefined,
          // 키를 비운 채 편집 중이면 저장된 키로 폴백해 테스트한다.
          profile_id: editing?.id,
        })
        setTestResult({ ok: res.success, message: res.error })
      } catch {
        setTestResult({ ok: false, message: t('wsAccounts.requestFailedShort') })
      }
    })
  }

  function confirmDelete() {
    if (!target) return
    setError(null)
    startTransition(async () => {
      try {
        const res = await deleteLlmProfile(target.id)
        if ('error' in res) { setError(res.error); return }
        const listError = await reload()
        if (listError) { setError(listError); return }
        setTarget(null)
        setView('list')
      } catch {
        setError(t('wsAccounts.requestFailed'))
      }
    })
  }

  const title = view === 'delete' ? t('llm.profile.deleteTitle') : view === 'form' ? (editing ? t('llm.profile.editTitle') : t('llm.profile.newTitle')) : t('llm.profile.manageTitle')

  // 삭제 확인은 별도 모달을 겹치지 않고 같은 모달의 뷰로 처리한다
  // (모달 중첩 시 앞 모달의 포커스 트랩이 Tab 을 다시 낚아채므로).
  const footer =
    view === 'delete' ? (
      <>
        <button onClick={() => { setTarget(null); setView('list') }} className="btn btn-ghost" disabled={pending}>{t('common.cancel')}</button>
        <button
          onClick={confirmDelete}
          disabled={pending}
          className="btn bg-danger text-danger-fg transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? t('llm.profile.deleting') : t('common.delete')}
        </button>
      </>
    ) : view === 'form' ? (
      <>
        <button onClick={() => setView('list')} className="btn btn-ghost" disabled={pending}>{t('llm.profile.backToList')}</button>
        <button onClick={submitForm} className="btn btn-primary" disabled={pending}>
          {pending ? t('llm.saving') : editing ? t('llm.profile.saveChanges') : t('llm.profile.create')}
        </button>
      </>
    ) : (
      <button onClick={onClose} className="btn btn-ghost" disabled={pending}>{t('common.close')}</button>
    )

  return (
    <Modal open={open} onClose={onClose} title={title} size="lg" footer={footer}>
      {view === 'list' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-fg-secondary">{t('llm.profile.count').replace('{n}', String(profiles.length))}</p>
            <button onClick={() => { resetForm(null); setView('form') }} className="btn btn-primary btn-sm shrink-0" disabled={pending}>
              <Plus className="h-4 w-4" />{t('llm.profile.newTitle')}
            </button>
          </div>

          {error && <p ref={errorRef} role="alert" className="text-sm font-medium text-danger">{error}</p>}

          {profiles.length === 0 ? (
            <div className="panel-soft flex flex-col items-center gap-2 px-6 py-10 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-action-soft text-action"><Server className="h-5 w-5" /></span>
              <p className="text-sm font-semibold text-fg">{t('llm.profile.empty')}</p>
              <p className="text-xs text-fg-secondary">{t('llm.profile.emptyDesc')}</p>
            </div>
          ) : (
            <ul className="divide-y divide-border rounded-2xl border border-border">
              {profiles.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold text-fg">{p.name}</span>
                      <span className="chip bg-surface-subtle text-fg-secondary">{presetLabel(p.preset_id, t)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-secondary">
                      <span className="font-mono">{p.model}</span>
                      <span className="inline-flex items-center gap-1">
                        <KeyRound className="h-3 w-3" />
                        {p.has_token ? <code className="font-mono">{p.auth_token_masked}</code> : <span className="text-fg-muted">{t('llm.profile.noKey')}</span>}
                      </span>
                      {p.base_url && <span className="truncate font-mono text-fg-muted">{p.base_url}</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button onClick={() => { resetForm(p); setView('form') }} className="btn btn-ghost btn-sm" disabled={pending}>
                      <Pencil className="h-3.5 w-3.5" />{t('common.edit')}
                    </button>
                    <button
                      onClick={() => { setTarget(p); setError(null); setView('delete') }}
                      className="btn btn-ghost btn-sm text-danger"
                      disabled={pending}
                    >
                      <Trash2 className="h-3.5 w-3.5" />{t('common.delete')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {view === 'delete' && (
        <div className="space-y-3">
          <p className="text-sm leading-6 text-fg-secondary">
            <b className="text-fg">&apos;{target?.name}&apos;</b>{t('llm.profile.deleteConfirm')}
          </p>
          {error && <p ref={errorRef} role="alert" className="text-sm font-medium text-danger">{error}</p>}
        </div>
      )}

      {view === 'form' && (
        <div className="space-y-4">
          <div>
            <span className="mb-1.5 block text-xs font-semibold text-fg-secondary">{t('llm.profile.preset')}</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {LLM_PRESETS.map((p) => {
                const active = p.id === presetId
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => applyPreset(p)}
                    aria-pressed={active}
                    className={`rounded-xl border px-3 py-2.5 text-left transition ${
                      active ? 'border-action bg-action-soft text-action' : 'border-border bg-surface text-fg-secondary hover:border-border-input hover:text-fg'
                    }`}
                  >
                    <span className="block text-[13px] font-semibold leading-tight">{p.labelKey ? t(p.labelKey) : p.label}</span>
                    <span className="mt-0.5 block text-meta leading-4 opacity-80">{t(p.tokenHintKey)}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <Field label={t('llm.profile.name')}>
            <input className="app-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('llm.profile.namePlaceholder')} />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('llm.profile.model')}>
              <input className="app-input font-mono" value={model} onChange={(e) => setModel(e.target.value)} placeholder="gemini-3.7-flash" />
            </Field>
            <Field label={t('llm.profile.baseUrl')} hint={t('llm.profile.baseUrlHint')}>
              <input className="app-input font-mono" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:11434/v1" />
            </Field>
          </div>

          <Field
            label={t('llm.profile.apiKey')}
            hint={editing?.has_token ? t('llm.profile.keyKeepHint').replace('{mask}', () => String(editing.auth_token_masked)) : t('llm.profile.keyEmptyHint')}
          >
            <div className="relative">
              <input
                className="app-input pr-11 font-mono"
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={editing?.has_token ? (editing.auth_token_masked ?? '') : 'sk-…'}
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                aria-label={showKey ? t('llm.profile.hideKey') : t('llm.profile.showKey')}
                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-fg-muted transition hover:text-fg"
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </Field>

          {/* 최대 입력 토큰은 런타임이 읽는 곳이 없어(프롬프트 크기 제어 미구현) 노출하지 않는다 —
              저장은 되는데 아무 효과가 없는 설정을 관리자에게 보여주지 않기 위함. 컬럼은 유지. */}
          <Field label={t('llm.profile.maxTokens')} hint={t('llm.profile.maxTokensHint')}>
            <input className="app-input" type="number" min={0} value={maxOut} onChange={(e) => setMaxOut(e.target.value)} placeholder={t('llm.profile.unset')} />
          </Field>

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={runTest} className="btn btn-ghost" disabled={pending || !model.trim()}>
              <PlugZap className="h-4 w-4" />{t('llm.test')}
            </button>
            {testResult && (
              <p role="status" className={`min-w-0 flex-1 text-xs leading-5 ${testResult.ok ? 'text-success' : 'text-danger'}`}>
                {testResult.ok ? t('llm.testOk') : t('llm.testFailed').replace('{message}', () => testResult.message ?? t('chat.cmd.unknownError'))}
              </p>
            )}
          </div>

          {error && <p ref={errorRef} role="alert" className="text-sm font-medium text-danger">{error}</p>}
        </div>
      )}
    </Modal>
  )
}
