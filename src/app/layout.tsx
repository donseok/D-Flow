import type { Metadata } from "next";
import { connection } from "next/server";
import "./globals.css";
import { LocaleProvider } from "@/components/providers/LocaleProvider";
import { ToastProvider } from "@/components/ui/Toast";
import { BRAND } from "@/lib/branding";

export const metadata: Metadata = {
  title: `${BRAND.productName} — ${BRAND.tagline}`,
  description: "WBS · 일정 · 멤버를 하나의 흐름으로. 계획부터 완료까지 투명하게 관리하세요.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // 모든 경로를 요청 때 그린다 — 엄격한 CSP(미들웨어)는 Next 의 인라인 스크립트에 요청마다 다른 nonce 를 요구하는데, 빌드 때 굳은 HTML 에는
  // nonce 가 없어 스크립트가 통째로 막힌다. 요청 API 를 읽지 않는 화면(not-found 등)이 정적으로 굳지 않게 여기서 한 번 건다.
  await connection();
  return (
    <html lang="ko">
      <head>
        {/* Pretendard(dynamic subset) — globals.css 의 @import 에서 옮겨왔다(2026-08-18 성능 감사).
            @import 는 globals.css 를 받은 뒤에야 CDN CSS 를 받는 직렬 차단 체인이지만, head 의
            link 는 HTML 파싱 즉시 globals.css 와 병렬로 내려받는다. preconnect 2건이 DNS+TLS 를
            선워밍하고(css 는 same-origin credentials 없이, 폰트 파일은 crossorigin), 폰트 자체는
            font-display: swap 이라 첫 페인트를 막지 않는다. */}
        <link rel="preconnect" href="https://cdn.jsdelivr.net" />
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body className="font-sans antialiased">
        <LocaleProvider>
          <ToastProvider>{children}</ToastProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
