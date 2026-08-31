import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { installSopFixtures } from './sop-capture-fixtures.mjs'

const { chromium } = await import(process.env.SOP_PLAYWRIGHT_MODULE || 'playwright')
const base = process.env.SOP_CAPTURE_URL || 'http://127.0.0.1:5173/dji-demo-manager'
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Capture must use a local development server')
const out = resolve('public/sop-steps')
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true, channel: process.env.SOP_BROWSER_CHANNEL || 'msedge' })
const card = (text) => (page) => page.locator('[data-slot="card"]').filter({ hasText: text }).first()
const button = (name) => (page) => page.getByRole('button', { name, exact: true }).first()
const css = (selector) => (page) => page.locator(selector).first()
const dialog = css('[role="dialog"], [role="alertdialog"]')
const shot = (route, target, before) => ({ route, target, before })
const apply = '/borrow/apply', mine = '/borrow/my-requests', renew = '/borrow/renew/sop-request', returns = '/borrow/return/sop-record'
const queue = '/approval/queue', chains = '/admin/approval-chains', cleanup = '/admin/request-cleanup', history = '/admin/request-history'
const users = '/admin/users', customers = '/admin/customers', settings = '/admin/settings', reports = '/reports'
const selectItem = async (page, transfer = false) => {
  if (transfer) await page.locator('#borrow-type-transfer').click()
  await page.getByRole('combobox').first().click()
  await page.getByRole('option').filter({ hasText: transfer ? 'Matrice 4T' : 'Matrice 4E' }).first().click()
  await page.locator('#purpose').fill('培训操作演示：核对样机、日期与用途')
  await page.locator('#returnDate').fill('2026-09-15')
  if (!transfer) {
    await page.locator('#borrowDate').fill('2026-09-01')
    await page.locator('#customerName').fill('培训演示客户')
    await page.locator('#customerContact').fill('演示联系人（不含真实联系方式）')
  } else await page.locator('#customerName').fill('培训演示客户')
}
const transfer = (page) => selectItem(page, true)
const preview = async (page) => { await button('预览数据')(page).click(); await page.locator('tbody tr').first().waitFor() }
const editChain = async (page) => { await button('编辑')(page).click(); await page.getByRole('dialog').waitFor() }
const activeUsers = async (page) => { await page.getByRole('button', { name: /已启用/ }).first().click() }
const editUser = async (page) => { await activeUsers(page); await page.locator('button[title="编辑"]').first().click() }
const transferAdmin = async (page) => { await activeUsers(page); await page.locator('button[title="转移超级管理员权限"]').click() }
const slots = ['entry-1', 'entry-2', 'workflow-1', 'workflow-2', 'workflow-3', 'followup-1', 'followup-2']
const plans = [
  ['system-borrow-apply', 'user', [
    shot(apply, css('a[href$="/borrow/apply"]')), shot(apply, card('借用详情')),
    shot(apply, card('选择样机'), selectItem), shot(apply, card('借用详情'), selectItem),
    shot(apply, card('审批流程预览'), selectItem), shot(mine, css('[role="tablist"]')), shot(mine, button('编辑申请')),
  ]],
  ['system-transfer-apply', 'user', [
    shot(apply, card('借用类型'), transfer), shot(apply, card('选择样机'), transfer),
    shot(apply, card('选择样机'), transfer), shot(apply, card('借用详情'), transfer),
    shot(apply, card('审批流程预览'), transfer), shot(mine, css('[role="tablist"]')), shot('/items', css('table')),
  ]],
  ['system-renew-apply', 'user', [
    shot(mine, button('申请续借')), shot(renew, card('当前借用信息')),
    shot(renew, card('续借信息')), shot(renew, css('#newReturnDate')),
    shot(renew, css('#renewPurpose'), async (page) => page.locator('#renewPurpose').fill('培训演示：项目测试需延长至新归还日期')),
    shot(mine, css('[role="tablist"]')), shot(renew, card('当前借用信息')),
  ]],
  ['system-report-export', 'user', [
    shot(reports, css('a[href$="/reports"]')), shot(reports, card('筛选条件')),
    shot(reports, css('[role="combobox"]')), shot(reports, card('数据预览'), preview),
    shot(reports, button('导出 Excel'), preview), shot(reports, card('数据预览'), preview), shot(reports, card('筛选条件'), preview),
  ]],
  ['system-return-item', 'user', [
    shot(mine, button('拍照归还')), shot(returns, card('借用信息')),
    shot(returns, card('借用信息')), shot(returns, css('[data-slot="card"]:has(video), [data-slot="card"]:has-text("拍摄")')),
    shot(returns, card('归还备注')), shot(mine, css('[role="tablist"]')), shot(mine, card('SOP-演示-001')),
  ]],
  ['system-item-approval', 'approver', [
    shot(queue, css('a[href$="/approval/queue"]')), shot(queue, card('SOP-演示-002')),
    shot(queue, dialog, async (page) => button('查看详情')(page).click()), shot(queue, dialog, async (page) => {
      await button('拒绝')(page).click()
      await page.locator('#rejectReason').fill('培训演示：请补充样机用途与使用场景后重新提交')
    }),
    shot(queue, card('SOP-演示-002')), shot(queue, css('[role="tablist"]')), shot(queue, css('[role="tablist"]')),
  ]],
  ['system-approval-chain', 'admin', [
    shot(chains, css('a[href$="/admin/approval-chains"]')), shot(chains, card('审批链列表')),
    shot(chains, dialog, editChain), shot(chains, dialog, editChain), shot(chains, dialog, editChain),
    shot(apply, card('审批流程预览'), selectItem), shot(chains, card('审批链列表')),
  ]],
  ['system-record-cleanup', 'admin', [
    shot(cleanup, css('h1')), shot(cleanup, css('[role="alertdialog"]'), async (page) => button('永久删除')(page).click()),
    shot(cleanup, card('SOP-演示-003')), shot(cleanup, card('SOP-演示-003')),
    shot(cleanup, css('[role="alertdialog"]'), async (page) => button('永久删除')(page).click()),
    shot(cleanup, css('main h1')), shot('/items', css('table')),
  ]],
  ['system-request-history', 'admin', [
    shot(history, css('a[href$="/admin/request-history"]')), shot(history, css('.hm-tool-rail')),
    shot(history, css('#request-history-search')), shot('/admin/request-history/sop-request', css('main')),
    shot(history, css('table')), shot(history, css('table')), shot(history, css('.hm-tool-rail')),
  ]],
  ['system-inventory-maintenance', 'admin', [
    shot('/items', css('a[href$="/items"]')), shot('/items/new', css('main form')),
    shot('/items/new', css('main form')), shot('/items/new', css('main form')),
    shot('/items/sop-item-1/edit', css('main')), shot('/items', css('table')), shot('/items/sop-item-2', css('main')),
  ]],
  ['system-user-management', 'super_admin', [
    shot(users, css('a[href$="/admin/users"]')), shot(users, css('table'), activeUsers),
    shot(users, card('待审批用户')), shot(users, dialog, editUser),
    shot(users, dialog, async (page) => button('邀请用户')(page).click()), shot(users, css('table'), activeUsers), shot(users, css('table'), activeUsers),
  ]],
  ['system-customer-address-book', 'super_admin', [
    shot(customers, css('a[href$="/admin/customers"]')), shot(customers, card('培训演示客户')),
    shot(customers, css('main input')), shot(customers, card('培训演示客户')), shot(customers, card('培训演示客户')),
    shot(apply, card('借用类型')), shot(customers, css('main input')),
  ]],
  ['system-global-settings', 'super_admin', [
    shot(settings, css('a[href$="/admin/settings"]')), shot(settings, card('基础设置')),
    shot(settings, card('基础设置')), shot(settings, card('通知设置')),
    shot(settings, button('保存设置')), shot(settings, card('通知设置')), shot(settings, card('通知设置')),
  ]],
  ['system-super-admin-transfer', 'super_admin', [
    shot(users, css('table'), activeUsers), shot(users, css('tr:has-text("演示接任人")'), activeUsers),
    shot(users, css('button[title="转移超级管理员权限"]'), activeUsers), shot(users, dialog, transferAdmin),
    shot(users, dialog, transferAdmin), shot(users, css('table'), activeUsers), shot(users, css('table'), activeUsers),
  ]],
  ['system-archive-audit', 'super_admin', [
    shot(history, css('#nas-request-number')), shot(history, css('#nas-item-model')),
    shot(history, css('#nas-sn-last4')), shot('/admin/request-history/sop-request', css('main')),
    shot(history, css('#nas-request-number')), shot(history, css('#nas-request-number')), shot(history, css('#nas-request-number')),
  ]],
]

const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice(7)
try {
  for (const [id, role, shots] of plans.filter(([id]) => !only || id === only)) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1, reducedMotion: 'reduce', locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
    await installSopFixtures(context, role)
    const page = await context.newPage()
    page.setDefaultTimeout(12000)
    page.on('pageerror', (error) => console.error('PAGE ERROR:', error.message))
    for (let index = 0; index < shots.length; index++) {
      const { route, target, before } = shots[index]
      await page.goto(base + route, { waitUntil: 'networkidle' })
      await page.locator('main h1').first().waitFor()
      if (before) await before(page)
      const focus = target(page)
      await focus.waitFor({ state: 'visible' })
      await focus.scrollIntoViewIfNeeded()
      await page.evaluate(() => document.activeElement?.blur())
      await focus.evaluate((node) => node.classList.add('sop-capture-highlight'))
      await page.addStyleTag({ content: '.sop-capture-highlight { outline: 3px solid var(--color-accent) !important; outline-offset: 5px !important; }' })
      await page.evaluate(() => document.fonts.ready)
      await page.screenshot({ path: resolve(out, `${id}-${slots[index]}.jpg`), type: 'jpeg', quality: 82, animations: 'disabled' })
      const writes = await page.evaluate(() => window.__sopFixtureWrites)
      if (writes.length) throw new Error('Unexpected business write: ' + writes.join(', '))
      console.log(`Captured ${id}-${slots[index]}`)
    }
    await context.close()
  }
} finally { await browser.close() }
