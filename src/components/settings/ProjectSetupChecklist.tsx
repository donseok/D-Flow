'use client'

import { useEffect, useState } from 'react'

const STEPS = [
  { title: '기본 정보', detail: '프로젝트 이름·기간과 단계 이름을 확인하세요.', href: '#project-general' },
  { title: '사용 기능', detail: '프로젝트에서 사용할 기능을 선택하세요.', href: '#project-modules' },
  { title: '달력·업무 규칙', detail: '시간대·근무 요일과 상태·승인 규칙을 확인하세요.', href: '#project-calendar' },
  { title: '첫 데이터', detail: '작업 계획에서 첫 작업을 추가하거나 엑셀을 가져오세요.', href: 'wbs' },
] as const

/** 진행 표시만 이 브라우저에 저장한다. 실제 설정 저장은 각 편집기의 기존 경로를 따른다. */
export function ProjectSetupChecklist({ projectId, userId }: { projectId: string; userId: string }) {
  const key = `project-setup:v1:${userId}:${projectId}`
  const [step, setStep] = useState(0)
  const [hidden, setHidden] = useState(false)
  const [storageError, setStorageError] = useState(false)
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? 'null')
      if (saved && Number.isInteger(saved.step) && saved.step >= 0 && saved.step <= STEPS.length) {
        setStep(saved.step); setHidden(saved.hidden === true)
      }
    } catch { setStorageError(true) }
  }, [key])
  const save = (next: number, hide: boolean) => {
    setStep(next); setHidden(hide)
    try { localStorage.setItem(key, JSON.stringify({ step: next, hidden: hide })); setStorageError(false) }
    catch { setStorageError(true) }
  }
  if (hidden) return <button className="btn btn-ghost" onClick={() => save(step, false)}>준비 체크리스트 이어하기</button>
  const current = STEPS[step]
  return <section aria-label="프로젝트 준비" className="rounded-(--radius-panel) border border-border bg-surface p-4 space-y-3">
    <h2 className="text-base font-semibold text-fg">프로젝트 준비 체크리스트</h2>
    <p className="text-sm text-fg-secondary">{current ? `${step + 1} / ${STEPS.length} · ${current.title}` : '준비 항목을 모두 확인했습니다.'}</p>
    {current && <><p className="text-sm text-fg-secondary">{current.detail}</p>
      <a className="btn btn-ghost" href={current.href.startsWith('#') ? current.href : `/p/${projectId}/${current.href}`}>설정·작업 열기</a></>}
    <div className="flex flex-wrap gap-2">
      {step > 0 && <button className="btn btn-ghost" onClick={() => save(step - 1, false)}>이전</button>}
      {current && <button className="btn btn-primary" onClick={() => save(step + 1, false)}>확인했어요 · 다음</button>}
      <button className="btn btn-ghost" onClick={() => save(step, true)}>{current ? '나중에 이어하기' : '닫기'}</button>
      {!current && <button className="btn btn-ghost" onClick={() => save(0, false)}>처음부터 확인</button>}
    </div>
    <p className="text-xs text-fg-muted">진행 위치는 이 계정·프로젝트별로 현재 브라우저에 저장됩니다. 체크리스트의 확인 버튼은 설정을 저장하지 않습니다.</p>
    {storageError && <p role="alert" className="text-sm text-warning">이 브라우저에서 진행 위치를 저장할 수 없습니다.</p>}
  </section>
}
