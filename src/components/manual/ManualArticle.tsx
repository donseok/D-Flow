import Link from 'next/link'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Children, isValidElement, type CSSProperties, type ReactNode } from 'react'
import { createSlugger } from '@/lib/manual/parse'

/** 자식 → 평문(제목 앵커용). 본문 검사가 제목에 표기 기호를 막으므로 글자만 모으면 parse.ts 의 절 id 와 같아진다 */
function textOf(node: ReactNode): string {
  return Children.toArray(node).map((c) => (typeof c === 'string' || typeof c === 'number' ? String(c) : isValidElement<{ children?: ReactNode }>(c) ? textOf(c.props.children) : '')).join('')
}

/**
 * 매뉴얼 본문 — 서버 컴포넌트. 앵커는 parse.ts 와 같은 createSlugger 로 h2·h3 에만 달고(렌더마다 새 인스턴스 — 같은 순서·같은 규칙),
 * h1 은 그리지 않으며(장 제목은 화면 머리가 그린다) h4~h6 은 앵커 없이 그린다.
 */
export function ManualArticle({ body }: { body: string }) {
  const slug = createSlugger()
  const components: Components = {
    h1: () => null,
    h2: ({ children }) => <h2 id={slug(textOf(children))} className="scroll-mt-20">{children}</h2>,
    h3: ({ children }) => <h3 id={slug(textOf(children))} className="scroll-mt-20">{children}</h3>,
    a: ({ href, children }) => {
      if (href?.startsWith('/') && !href.startsWith('//')) return <Link href={href}>{children}</Link>
      if (href?.startsWith('#')) return <a href={href}>{children}</a>
      return <a href={href} target="_blank" rel="noreferrer">{children}</a>
    },
  }
  return (
    <div className="minutes-md" style={{ '--minutes-fs': '15px' } as CSSProperties}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{body}</ReactMarkdown>
    </div>
  )
}
