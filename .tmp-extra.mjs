import { readFileSync } from 'node:fs'
const { loadPlaywright } = await import(`${process.cwd()}/scripts/ui-capture.mjs`)
const { chromium } = await loadPlaywright()
const { OUT, P, PW_FILE } = process.env
const b = await chromium.launch(); const out = {}
const pages = [['home', '/w/default'], ['wbs', `/p/${P}/wbs`], ['board', `/p/${P}/wbs?view=board`], ['dash', `/p/${P}/dashboard`], ['weekly', `/p/${P}/weekly`], ['psettings', `/p/${P}/settings`], ['wsettings', '/w/default/settings'], ['minutes', '/w/default/minutes'], ['agents', `/p/${P}/agents`], ['usage', '/w/default/usage'], ['mywork', '/w/default/my-work'], ['projects', '/w/default/projects'], ['teams', '/w/default/admin/teams'], ['members', `/p/${P}/members`], ['account', '/account']]
const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } })
const page = await ctx.newPage(); page.setDefaultTimeout(10000)
const errs = []; page.on('pageerror', (e) => errs.push(String(e).slice(0, 120)))
await page.goto('http://localhost:3101/login'); await page.fill('input[type=email]', 'admin@example.com'); await page.fill('input[type=password]', readFileSync(PW_FILE, 'utf8').trim()); await page.keyboard.press('Enter')
await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 })
await page.goto('http://localhost:3101/account', { waitUntil: 'networkidle' }); await page.waitForTimeout(500)
await page.getByRole('tab', { name: 'English' }).or(page.getByRole('button', { name: 'English' })).first().click(); await page.waitForTimeout(2500)
out.cookie = (await ctx.cookies()).find(c => c.name === 'dflow-locale')?.value
const rows = []
for (const [n, p] of pages) {
  await page.goto(`http://localhost:3101${p}`, { waitUntil: 'networkidle' }).catch(() => {}); await page.waitForTimeout(600)
  await page.screenshot({ path: `${OUT}/en-${n}.png` })
  const info = await page.evaluate(() => { const t = document.body.innerText || ''; const lines = t.split('\n').map(s => s.trim()).filter(s => /[가-힣]/.test(s)); return { koLines: lines.length, sample: [...new Set(lines)].slice(0, 12), keys: (t.match(/\b(?:wbs|settings|common|pages|agents|agentHub|weekly|portalUi|usage|min|dash|kanban|issue|search|chat|reportUi|doc|account|nav|att|meet|ann)\.[A-Za-z0-9_.]+/g) || []).slice(0, 6), ov: document.documentElement.scrollWidth - innerWidth } })
  rows.push([n, info.koLines, info.ov, info.keys, info.sample])
}
out.rows = rows; out.errs = errs
console.log(JSON.stringify(out)); await b.close()
