// Run only against the isolated synthetic database described in docs/paste-review/README.md.
// AI parsing is a fixture; approval, history, retry and undo use the real local API.
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)(process.env.HUSHLEDGER_PLAYWRIGHT_MODULE ?? 'playwright')
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
const browser = await chromium.launch({ executablePath: process.env.HUSHLEDGER_CHROMIUM_PATH ?? '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' })
const errors = []
page.on('console', msg => { if (msg.type() === 'error') console.log('CONSOLE',msg.text()) })
page.on('requestfailed', req => console.log('FAILED',req.url(),req.failure()))
page.on('pageerror', (error) => errors.push(error.message))
await page.addInitScript(() => localStorage.setItem('hushledger.locale', 'en'))
await page.route('**/api/ai-settings', (route) => route.fulfill({ json: { ok: true, data: {
  baseUrl: 'https://fictional.invalid/v1', model: 'synthetic', hasApiKey: true,
  createdAt: '2026-10-23T00:00:00.000Z', updatedAt: '2026-10-23T00:00:00.000Z',
} } }))
const runKey = Date.now().toString(16)
const drafts = [1, 2, 3].map((n) => ({
  id: crypto.randomUUID(),
  importKey: `ai:statement:row:${(runKey+n.toString(16)).padStart(64,'8')}`,
  sourceLine: n, sourceText: n === 2 ? '10/20 Sample Books 80.00' : '2026-10-20 Sample Café 48.00',
  bankReference: null, runningBalance: null, occurredOn: '2026-10-20', type: 'expense',
  amountText: n === 2 ? '80.00' : '48.00', amountMinor: n === 2 ? 8000 : 4800,
  currency: 'HKD', accountId: 1, categoryId: 3, payee: n === 2 ? 'Sample Books' : 'Sample Café',
  confidence: 0.8, categorySource: 'model', flags: n === 2 ? ['UNCERTAIN_DATE'] : [],
}))
await page.route('**/api/imports/parse', (route) => route.fulfill({ json: { ok: true, data: { drafts, verification: {
  status: 'unavailable', openingBalance: null, closingBalance: null, debitTotal: null, creditTotal: null,
  parsedIncomeMinor: 0, parsedExpenseMinor: 17600, parsedNetMinor: -17600,
  balanceDifferenceMinor: null, debitDifferenceMinor: null, creditDifferenceMinor: null,
  runningBalanceStatus: 'unavailable', runningBalanceCheckedRows: 0, runningBalanceMismatchSourceLines: [],
} } } }))
let lostResponse = true
await page.route('**/api/imports/approve', async (route) => {
  if (lostResponse && route.request().postDataJSON().mode === 'approve') {
    lostResponse = false
    const response = await route.fetch()
    assert.equal(response.status(), 200)
    await route.abort('failed')
  } else await route.continue()
})
async function data(path) { return page.evaluate(async (path) => (await (await fetch(path)).json()).data, path) }
try {
  await page.goto('http://127.0.0.1:3100', { waitUntil: 'networkidle' })
  if (await page.getByRole('button', { name: '貼上交易', exact: true }).count()) {
    await page.locator('.desktop-navigation').getByRole('button', { name: '設定', exact: true }).click()
    await page.locator('button').filter({hasText: '顯示與應用程式'}).click()
    await page.locator('.language-option').filter({hasText:'English'}).click()
  }
  await page.getByRole('button', { name: 'Paste transactions', exact: true }).click()
  const panel = page.locator('.paste-panel')
  await panel.getByLabel('Account and currency', { exact: true }).selectOption('1')
  await panel.getByLabel('Paste transaction text').fill(drafts.map((row) => row.sourceText).join('\n'))
  await panel.getByRole('button', { name: 'Analyze', exact: true }).click()
  await page.locator('.paste-row').nth(2).waitFor()
  assert.equal((await data('/api/transactions?month=2026-10')).length, 0)
  const rows = page.locator('.paste-row')
  assert(await rows.nth(1).getByRole('button', { name: 'Approve and save' }).isDisabled())
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(200)
  await page.screenshot({ path: '/tmp/hushledger-paste-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(200)
  await page.screenshot({ path: '/tmp/hushledger-paste-mobile-viewport.png' })
  await page.screenshot({ path: '/tmp/hushledger-paste-mobile.png', fullPage: true })
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  await rows.nth(0).getByRole('button', { name: 'Approve and save' }).click()
  await panel.getByRole('button', { name: 'Retry', exact: true }).waitFor()
  await panel.getByRole('button', { name: 'Retry', exact: true }).click()
  await rows.nth(0).getByRole('button', { name: 'Saved', exact: true }).waitFor()
  assert.equal((await data('/api/transactions?month=2026-10')).length, 1)
  assert.equal((await data('/api/payee-suggestions?accountId=1'))[0].payee, 'Sample Café')
  assert.equal((await data('/api/payee-suggestions?accountId=2')).length, 0)
  await rows.nth(2).getByRole('button', { name: 'Approve and save' }).click()
  await rows.nth(2).getByLabel('Possible duplicate — I confirm this is a separate transaction').check()
  await rows.nth(2).getByRole('button', { name: 'Approve and save' }).click()
  await rows.nth(2).getByRole('button', { name: 'Saved', exact: true }).waitFor()
  await rows.nth(1).getByLabel('Category', { exact: true }).selectOption('4')
  await rows.nth(1).getByLabel('I checked these details').check()
  await rows.nth(1).getByLabel('Selected', { exact: true }).check()
  await panel.getByRole('button', { name: 'Approve selected (1)', exact: true }).click()
  await rows.nth(1).getByRole('button', { name: 'Saved', exact: true }).waitFor()
  const stored = await data('/api/transactions?month=2026-10')
  assert.equal(stored.length, 3)
  assert.equal(stored.find((row) => row.payee === 'Sample Books').categoryId, 4)
  assert.equal(stored.find((row) => row.payee === 'Sample Books').amountMinor, 8000)
  for (let n = 0; n < 3; n++) {
    const undo = panel.getByRole('button', { name: 'Undo this approval', exact: true })
    await undo.first().click()
    await page.waitForFunction((count) => [...document.querySelectorAll('.paste-panel button')].filter((b) => b.textContent === 'Undo this approval').length === count, 2 - n)
  }
  assert.equal((await data('/api/transactions?month=2026-10')).length, 0)
  assert.equal((await data('/api/payee-suggestions?accountId=1')).length, 0)
  assert.deepEqual(errors, [])
  await fs.writeFile('/tmp/hushledger-paste-browser-evidence.json', JSON.stringify({ ok:true, desktop:'1440x1100', mobile:'390x844', noHorizontalOverflow:true, noWritesBeforeApproval:true, lostResponseRetry:true, explicitDuplicate:true, editedBatchApproval:true, scopedHistory:true, undo:true, browserErrors:errors }, null, 2))
  console.log('PASS paste UI: parse fixture, real approval/DB/history/undo, lost response retry, desktop/mobile')
} catch(error) { console.log('BODY', (await page.locator('body').innerText()).slice(0,3500)); console.log('ERRORS',errors); await page.screenshot({path:'/tmp/paste-failure.png',fullPage:true}); throw error } finally { await browser.close() }
