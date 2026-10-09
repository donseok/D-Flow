'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { PlugZap, Save, Settings2 } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { useLocale } from '@/components/providers/LocaleProvider'
import type { DictKey } from '@/lib/i18n/dict'
import { LlmProfilesModal } from '@/components/admin/LlmProfilesModal'
import {
  saveLlmConfig, testLlmConnection,
  type LlmMode, type LlmProfileMasked,
} from '@/app/actions/llmConfig'

export interface LlmConfigInitial {
  mode: LlmMode
  active_profile_id: number | null
  profiles: LlmProfileMasked[]
}

/** 서버가 방금 해석한 활성 모델(@/lib/ai/health 의 ActiveModelInfo). 키는 담기지 않는다. */
export interface ActiveModels {
  source: 'env' | 'profile' | 'none'
  provider: 'gemini' | 'openai'
  llm: string
  llmFallbacks: string[]
  embeddingProvider: 'gemini' | 'openai'
  embedding: string
  embeddingDim: number
}

const SOURCE_LABEL_KEY: Record<ActiveModels['source'], DictKey> = {
  env: 'llm.source.env',
  profile: 'llm.source.profile',
  none: 'llm.source.none',
}

const NEW_PROFILE = '__new__' // 드롭다운 마지막 항목 — 값이 아니라 "생성 폼 열기" 트리거

const MODES: { value: LlmMode; labelKey: DictKey; descKey: DictKey }[] = [
  { value: 'env', labelKey: 'llm.mode.env', descKey: 'llm.mode.envDesc' },
  { value: 'profile', labelKey: 'llm.mode.profile', descKey: 'llm.mode.profileDesc' },
  { value: 'none', labelKey: 'llm.mode.none', descKey: 'llm.mode.noneDesc' },
]

export function LlmConfigManager({ initial, active }: { initial: LlmConfigInitial; active: ActiveModels }) {
  const router = useRouter()
  const { toast } = useToast()
  const { t } = useLocale()

  const [mode, setMode] = useState<LlmMode>(initial.mode)
  const [activeId, setActiveId] = useState<number | null>(initial.active_profile_id)
  const [profiles, setProfiles] = useState<LlmProfileMasked[]>(initial.profiles)
  const [modalOpen, setModalOpen] = useState(false)
  const [modalCreate, setModalCreate] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string } | null>(null)
  const [pending, startTransition] = useTransition()

  const selected = profiles.find((p) => p.id === activeId) ?? null

  /**
   * 모달의 CRUD 결과 반영 + dangling 폴백.
   * 선택 중이던 프로필이 삭제됐는데 그대로 두면 저장이 '유효하지 않은 프로필입니다'로 반려되므로,
   * 서버의 on delete set null 과 같은 방향(env)으로 화면 선택을 되돌린다.
   */
  function handleProfilesChange(next: LlmProfileMasked[]) {
    setProfiles(next)
    setTestResult(null)
    if (activeId !== null && !next.some((p) => p.id === activeId)) {
      setActiveId(null)
      setMode((prev) => (prev === 'profile' ? 'env' : prev))
    }
  }

  function openModal(create: boolean) {
    setModalCreate(create)
    setModalOpen(true)
  }

  function onSelectProfile(value: string) {
    if (value === NEW_PROFILE) { openModal(true); return } // 선택값은 그대로 두고 생성 폼만 연다
    setTestResult(null)
    setActiveId(value ? Number(value) : null)
  }

  function runTest() {
    if (!selected) { setError(t('llm.err.pickToTest')); return }
    setError(null)
    setTestResult(null)
    startTransition(async () => {
      try {
        const res = await testLlmConnection({
          provider: selected.provider,
          model: selected.model,
          base_url: selected.base_url ?? undefined,
          profile_id: selected.id, // 저장된 키를 서버에서 폴백 조회(키는 화면에 없다)
        })
        setTestResult({ ok: res.success, message: res.error })
      } catch {
        setTestResult({ ok: false, message: t('wsAccounts.requestFailedShort') })
      }
    })
  }

  function save() {
    setError(null)
    if (mode === 'profile' && activeId === null) { setError(t('llm.err.pickToUse')); return }
    startTransition(async () => {
      try {
        const modeKey = MODES.find((m) => m.value === mode)?.labelKey
        const modeLabel = modeKey ? t(modeKey) : undefined
        const res = await saveLlmConfig({ mode, active_profile_id: mode === 'profile' ? activeId : null })
        if ('error' in res) { setError(res.error); return }
        // 저장은 됐는데 런타임 캐시 갱신이 실패한 경우까지 '성공'으로 뭉뚱그리면,
        // 관리자가 '선택 안함'을 저장하고도 최대 1분간 LLM 이 도는 것을 모른 채 넘어간다.
        toast(
          res.warning
            ? { title: t('llm.saved'), description: res.warning, variant: 'info' }
            : { title: t('llm.saved'), description: modeLabel, variant: 'success' },
        )
        router.refresh()
      } catch {
        setError(t('wsAccounts.requestFailed'))
      }
    })
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-6">
        <div>
          <h2 className="text-sm font-semibold text-fg">{t('llm.title').replace('{n}', String(profiles.length))}</h2>
        </div>
        <button onClick={() => openModal(false)} className="btn btn-ghost" disabled={pending}>
          <Settings2 className="h-4 w-4" />{t('llm.manageProfiles')}
        </button>
      </div>

      {/*
        지금 서버가 실제로 쓰는 모델. 코드 기본값·env·DB 프로필 세 곳이 겹쳐 정해지는 값이라
        화면 없이는 확인할 방법이 없었다(모델을 올린 뒤 "적용됐나?"에 답할 수단이 없음).
        아래 라디오는 '저장하면 될 상태'이고 이 줄은 '지금 도는 상태'다 — 저장 후 router.refresh()
        로 갱신된다. 둘을 헷갈리지 않도록 문구를 '서버 적용 중'으로 못박는다.
      */}
      <dl className="grid gap-x-6 gap-y-2 border-b border-border bg-surface-subtle px-5 py-3.5 text-xs sm:grid-cols-2 sm:px-6">
        <div className="min-w-0">
          <dt className="font-semibold text-fg-secondary">{t('llm.active.generation')}</dt>
          <dd className="mt-0.5 min-w-0">
            <span className="break-all font-mono text-fg">{active.llm}</span>
            <span className="text-fg-muted"> · {active.provider} · {t(SOURCE_LABEL_KEY[active.source])}</span>
            <span className="mt-0.5 block text-fg-muted">
              {t('llm.fallback')}{active.llmFallbacks.length > 0
                ? <span className="break-all font-mono">{active.llmFallbacks.join(' → ')}</span>
                : t('llm.none')}
            </span>
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="font-semibold text-fg-secondary">{t('llm.active.embedding')}</dt>
          <dd className="mt-0.5 min-w-0">
            <span className="break-all font-mono text-fg">{active.embedding}</span>
            <span className="text-fg-muted"> · {active.embeddingDim}{t('llm.dimUnit')}{active.embeddingProvider}</span>
            {/* 프로필은 생성만 덮는다 — 모르면 "프로필 바꿨는데 검색이 그대로"로 헤맨다. */}
            <span className="mt-0.5 block text-fg-muted">
              {active.source === 'profile'
                ? t('llm.embeddingNote.profile')
                : t('llm.embeddingNote.env')}
            </span>
          </dd>
        </div>
      </dl>

      <div className="space-y-5 p-5 sm:p-6">
        <fieldset className="space-y-2.5">
          <legend className="mb-2 text-xs font-semibold text-fg-secondary">{t('llm.activeTitle')}</legend>
          {MODES.map((m) => {
            const active = mode === m.value
            return (
              <div key={m.value}>
                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 transition ${
                    active ? 'border-action bg-action-soft' : 'border-border bg-surface hover:border-border-input'
                  }`}
                >
                  <input
                    type="radio"
                    name="llm-mode"
                    className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-action)]"
                    value={m.value}
                    checked={active}
                    onChange={() => { setMode(m.value); setTestResult(null); setError(null) }}
                    disabled={pending}
                  />
                  <span className="min-w-0">
                    <span className={`block text-sm font-semibold ${active ? 'text-action' : 'text-fg'}`}>{t(m.labelKey)}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-fg-secondary">{t(m.descKey)}</span>
                  </span>
                </label>

                {m.value === 'profile' && (
                  <div className="mt-2 pl-4">
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-semibold text-fg-secondary">{t('llm.profileToUse')}</span>
                      <select
                        className="app-input"
                        value={activeId !== null ? String(activeId) : ''}
                        onChange={(e) => onSelectProfile(e.target.value)}
                        disabled={pending || mode !== 'profile'}
                        aria-label={t('llm.profileToUseAria')}
                      >
                        <option value="">{t('llm.selectProfile')}</option>
                        {profiles.map((p) => (
                          <option key={p.id} value={String(p.id)}>{p.name} — {p.model}</option>
                        ))}
                        <option value={NEW_PROFILE}>{t('llm.newProfileOption')}</option>
                      </select>
                    </label>
                    {mode === 'profile' && selected && (
                      <p className="mt-1.5 text-meta leading-4 text-fg-muted">
                        {selected.provider} · {selected.base_url || t('llm.defaultEndpoint')} · {selected.has_token ? t('llm.keyMasked').replace('{mask}', () => String(selected.auth_token_masked)) : t('llm.noKey')}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </fieldset>

        {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
        {testResult && (
          <p role="status" className={`text-sm leading-6 ${testResult.ok ? 'text-success' : 'text-danger'}`}>
            {testResult.ok ? t('llm.testOk') : t('llm.testFailed').replace('{message}', () => testResult.message ?? t('chat.cmd.unknownError'))}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
          {/* env 모드는 서버의 env 값으로만 판별되므로 화면에서 보낼 값이 없다 — 버튼을 숨긴다. */}
          {mode !== 'env' && (
            <button onClick={runTest} className="btn btn-ghost" disabled={pending || mode === 'none'}>
              <PlugZap className="h-4 w-4" />{t('llm.test')}
            </button>
          )}
          <button onClick={save} className="btn btn-primary" disabled={pending}>
            <Save className="h-4 w-4" />{pending ? t('llm.saving') : t('common.save')}
          </button>
        </div>
      </div>

      <LlmProfilesModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        profiles={profiles}
        onProfilesChange={handleProfilesChange}
        startInCreate={modalCreate}
      />
    </div>
  )
}
