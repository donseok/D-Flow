// 로컬 E2E 러너 공용 — 쿠키 항아리 하나 = 브라우저 하나(세션)와 서버 액션 호출. e2e-local.mjs·e2e-synthetic.mjs 가 쓴다.
// 앱과 같은 @supabase/ssr 로 쿠키를 만들고, 서버 액션은 화면이 부르는 것과 같은 방식(POST <페이지> + next-action 헤더)으로 부른다.
import { readFileSync } from 'node:fs'
import { createServerClient } from '@supabase/ssr'
import { actionResult, cookieHeader, encodeActionArgs, findActionId } from './e2e.mjs'

/**
 * @param {{ env: { url: string; anonKey: string }, base: string, manifestPath: string, actions: Record<string, { filename: string; exportedName: string; worker: string }>, Fail: new (m: string) => Error }} cfg
 * @returns {(label: string) => any}
 */
export function createSessionFactory({ env, base, manifestPath: MANIFEST, actions: ACTIONS, Fail }) {
  return function session(label) {
    const jar = new Map()
    const sb = createServerClient(env.url, env.anonKey, {
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: (list) => list.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
      },
    })
    const cookies = () => cookieHeader([...jar].map(([name, value]) => ({ name, value })))

    async function http(method, path, { body, headers = {}, expect = 200 } = {}) {
      let res
      for (let attempt = 0; ; attempt++) {
        try {
          res = await fetch(`${base}${path}`, { method, body, redirect: 'manual', headers: { cookie: cookies(), ...headers } })
          break
        } catch (error) {
          // next dev 는 첫 대형 화면 컴파일 중 메모리 감시로 서버를 재시작할 수 있다. 안전한 GET 의 연결 끊김만 재시도한다.
          if (method !== 'GET' || !(error instanceof TypeError) || attempt >= 3) throw error
          await new Promise((resolve) => setTimeout(resolve, 2000))
        }
      }
      if (Array.isArray(expect) ? !expect.includes(res.status) : res.status !== expect) {
        const text = (await res.text()).slice(0, 500)
        throw new Fail(`[${label}] ${method} ${path} → ${res.status}(기대 ${expect}): ${text}`)
      }
      return res
    }

    async function login(user, pass) {
      const { data, error } = await sb.auth.signInWithPassword({ email: user, password: pass })
      if (error) throw new Fail(`[${label}] 로그인 실패: ${error.message}`)
      if (![...jar.keys()].some((k) => k.includes('-auth-token'))) throw new Fail(`[${label}] 로그인은 됐는데 세션 쿠키가 만들어지지 않았다`)
      return data.user
    }

    /**
     * 서버 액션 — 화면이 부르는 것과 같은 방식(POST <페이지> + next-action 헤더). 액션 id 는 빌드마다 달라 next dev 가 쓴
     * 매니페스트에서 매번 새로 읽는다(호출 전에 그 페이지를 GET 해 컴파일·등록을 끝내 둔다). 응답(Flight)에서 반환값을 꺼낸다.
     */
    async function action(pagePath, name, args) {
      const ref = ACTIONS[name]
      // next dev 가 메모리 감시로 재시작하면 매니페스트가 비는다 — 그 페이지를 다시 GET 해 컴파일·등록을 끝낸 뒤 읽는다(최대 3번).
      let found
      for (let attempt = 0; ; attempt++) {
        try { found = findActionId(JSON.parse(readFileSync(MANIFEST, 'utf8')), ref); break } catch (e) {
          if (attempt >= 3) throw new Fail(`${e.message}(${pagePath} 를 먼저 GET 했는가)`)
          await http('GET', pagePath, { expect: [200, 404] })
          await new Promise((resolve) => setTimeout(resolve, 1000))
        }
      }
      if (!found.workers.some((w) => w.endsWith(ref.worker))) {
        throw new Fail(`${name} 가 ${ref.worker} 에 묶여 있지 않다(${found.workers.join(', ')})`)
      }
      const res = await http('POST', pagePath, {
        body: encodeActionArgs(args),
        headers: { 'next-action': found.id, 'content-type': 'text/plain;charset=UTF-8', accept: 'text/x-component', origin: base },
      })
      try {
        return { actionId: found.id, result: actionResult(Buffer.from(await res.arrayBuffer())) }
      } catch (e) {
        throw new Fail(`[${label}] ${name}: ${e.message}`)
      }
    }

    return { label, sb, jar, http, login, action }
  }
}
