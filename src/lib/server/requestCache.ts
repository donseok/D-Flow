import 'server-only'
import { AsyncLocalStorage } from 'node:async_hooks'
import { cache as reactCache } from 'react'

type Entry = { children: Map<unknown, Entry>; value?: unknown; error?: unknown; settled?: 'value' | 'error' }
const requests = new AsyncLocalStorage<Map<object, Entry>>()
const entry = (): Entry => ({ children: new Map() })

/** Route Handler 는 React 렌더 캐시 밖이다. 이 비동기 요청 안에서만 조회를 공유한다. */
export function withRequestCache<T>(run: () => T): T {
  return requests.getStore() ? run() : requests.run(new Map(), run)
}

/** RSC 는 React cache, 명시적으로 감싼 GET 은 AsyncLocalStorage 를 쓴다. 사용자·요청 사이에 값을 공유하지 않는다. */
export function requestCache<Args extends unknown[], Result>(fn: (...args: Args) => Result): (...args: Args) => Result {
  const renderCached = reactCache(fn)
  const key = {}
  return (...args) => {
    const store = requests.getStore()
    if (!store) return renderCached(...args)
    let node = store.get(key)
    if (!node) { node = entry(); store.set(key, node) }
    for (const arg of args) {
      let child = node.children.get(arg)
      if (!child) { child = entry(); node.children.set(arg, child) }
      node = child
    }
    if (node.settled === 'error') throw node.error
    if (node.settled === 'value') return node.value as Result
    try {
      const value = fn(...args)
      node.value = value
      node.settled = 'value'
      return value
    } catch (error) {
      node.error = error
      node.settled = 'error'
      throw error
    }
  }
}
