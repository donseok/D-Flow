// Suspense·use 를 끝까지 기다리는 SSR(포털 v1 테스트) — renderToString 은 Suspense 경계 안의 대기를 기다리지 않고 fallback 을 낸다
import { Writable } from 'node:stream'
import type { ReactElement } from 'react'
import { renderToPipeableStream } from 'react-dom/server'

export function renderAll(el: ReactElement): Promise<string> {
  return new Promise((resolve, reject) => {
    let html = ''
    const sink = new Writable({ write(chunk, _enc, cb) { html += chunk.toString(); cb() } })
    sink.on('finish', () => resolve(html))
    const s = renderToPipeableStream(el, { onAllReady() { s.pipe(sink) }, onShellError: reject, onError: reject })
  })
}
