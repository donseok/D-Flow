import { describe, expect, it } from 'vitest'
import { inferDomain } from '@/components/chat/BotPageContextProvider'

describe('inferDomain — 레지스트리 botDomains 파생(D27)', () => {
  it('프로젝트 경로 — issues(기존 결함 해소)·간트·위키 주제', () => {
    expect(inferDomain('/p/x/issues')).toBe('issues')
    expect(inferDomain('/p/x/gantt')).toBe('wbs')
    expect(inferDomain('/p/x/wiki/topics/t')).toBe('wiki')
    expect(inferDomain('/p/x/agents')).toBe('unknown')     // agents 의 botDomains 는 비어 있다
  })
  it('워크스페이스·옛 경로', () => {
    expect(inferDomain('/w/acme')).toBe('projects')
    expect(inferDomain('/w/acme/my-work')).toBe('projects')
    expect(inferDomain('/w/acme/projects')).toBe('projects')
    expect(inferDomain('/w/acme/minutes/1')).toBe('minutes')
    expect(inferDomain('/minutes/1')).toBe('minutes')
    expect(inferDomain('/w/acme/meetings')).toBe('meetings')
    expect(inferDomain('/')).toBe('projects')
    expect(inferDomain('/projects')).toBe('projects')
    expect(inferDomain('/account')).toBe('unknown')
  })
})
