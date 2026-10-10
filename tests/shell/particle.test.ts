import { describe, expect, it } from 'vitest'
import { josa, particle, withObjectParticle } from '@/lib/i18n/particle'
import { MODULE_LABEL } from '@/lib/modules/labels'
import { MODULE_IDS } from '@/lib/modules/defaults'

describe('withObjectParticle — 목적격 조사 을/를', () => {
  it('받침 없음 → 를, 받침 있음 → 을, 한글 아님 → 을(를)', () => {
    expect(withObjectParticle('이슈')).toBe('이슈를')
    expect(withObjectParticle('회의록')).toBe('회의록을')
    expect(withObjectParticle('Wiki')).toBe('Wiki을(를)')
    expect(withObjectParticle('')).toBe('을(를)')
  })
  // BUG-27 — "'플랫폼개발팀'는 같은 범위의…" 처럼 이름이 변수인 문구의 조사가 고정이었다
  it('은/는·이/가·과/와 — 받침 있으면 앞, 없으면 뒤', () => {
    expect(josa('플랫폼개발팀', '은/는')).toBe('플랫폼개발팀은')
    expect(josa('이슈', '은/는')).toBe('이슈는')
    expect(josa('운영팀', '이/가')).toBe('운영팀이')
    expect(josa('파트', '이/가')).toBe('파트가')
    expect(josa('운영팀', '과/와')).toBe('운영팀과')
    expect(josa('파트', '과/와')).toBe('파트와')
  })
  it('닫는 따옴표·괄호·공백은 건너뛰고 그 앞 글자로 판정한다', () => {
    expect(josa("'플랫폼개발팀'", '은/는')).toBe("'플랫폼개발팀'은")
    expect(josa("'이슈'", '은/는')).toBe("'이슈'는")
    expect(josa('"운영팀" ', '이/가')).toBe('"운영팀" 이')
    expect(josa('팀(운영)', '을/를')).toBe('팀(운영)을')
  })
  it('으로/로 — 받침 없음과 ㄹ 받침은 로, 그 밖의 받침은 으로', () => {
    expect(josa('파트', '으로/로')).toBe('파트로')
    expect(josa('개발', '으로/로')).toBe('개발로')
    expect(josa('운영팀', '으로/로')).toBe('운영팀으로')
  })
  it('숫자는 읽는 소리로 — 0 영·1 일·3 삼·6 육·7 칠·8 팔은 받침 있음, 1·7·8 은 ㄹ 받침', () => {
    expect(josa('ISS-001', '을/를')).toBe('ISS-001을')
    expect(josa('v2', '을/를')).toBe('v2를')
    expect(josa('ISS-003', '으로/로')).toBe('ISS-003으로')
    expect(josa('ISS-001', '으로/로')).toBe('ISS-001로')
    expect(josa('팀 9', '은/는')).toBe('팀 9는')
  })
  it('읽는 법을 모르는 글자(로마자 등)·빈 문자열은 두 꼴을 함께 적는다 — 틀린 조사 하나를 단정하지 않는다', () => {
    expect(josa("'ops'", '은/는')).toBe("'ops'은(는)")
    expect(josa('DEV', '이/가')).toBe('DEV이(가)')
    expect(josa('QA', '과/와')).toBe('QA과(와)')
    expect(josa('ERP', '으로/로')).toBe('ERP(으)로')
    expect(particle('', '은/는')).toBe('은(는)')
  })
  it('모듈 표시 이름 표가 모든 모듈을 덮는다', () => {
    for (const id of MODULE_IDS) expect(MODULE_LABEL[id], id).toBeTruthy()
  })
})
