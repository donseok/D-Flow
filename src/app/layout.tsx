import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { LocaleProvider } from "@/components/providers/LocaleProvider";
import { ToastProvider } from "@/components/ui/Toast";
import { getServerLocale } from "@/lib/i18n/server";
import { BRAND } from "@/lib/branding";
import { noFlashScript } from "@/lib/theme/policy";

export const metadata: Metadata = {
  title: `${BRAND.productName} — ${BRAND.tagline}`,
  description: "WBS · 일정 · 멤버를 하나의 흐름으로. 계획부터 완료까지 투명하게 관리하세요.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // 쿠키 기반 locale — 서버 렌더 본문과 클라이언트 크롬이 같은 언어로 시작한다.
  const locale = await getServerLocale();
  const nonce = (await headers()).get("x-nonce") ?? undefined; // CSP nonce(미들웨어) — 미들웨어가 돌지 않는 경로(/login 등)에서는 없다
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        {/* 다크 FOUC 방지 — 페인트 전에 선호(localStorage → 쿠키 → 미설정 기본)를 <html> 에 반영한다(D10) */}
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: noFlashScript() }} />
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
        <ThemeProvider>
          <LocaleProvider initialLocale={locale}>
            <ToastProvider>{children}</ToastProvider>
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
