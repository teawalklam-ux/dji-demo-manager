import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { installSopFixtures } from './sop-capture-fixtures.mjs'

const { chromium } = await import(process.env.SOP_PLAYWRIGHT_MODULE || 'playwright')
const base = process.env.SOP_CAPTURE_URL || 'http://127.0.0.1:5173/dji-demo-manager'
assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Tests must use local development server')
const out = resolve('artifacts/sop-reader')
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true, channel: process.env.SOP_BROWSER_CHANNEL || 'msedge' })
const results = []
const errors = []
const dialog = (page) => page.locator('.sop-reader-dialog')
const openMenu = (page) => page.getByRole('button', { name: /系统使用 SOP/ }).click()
const select = async (page, id = 'system-borrow-apply') => {
  await openMenu(page)
  await page.locator(`[data-sop-process="${id}"]`).click()
  await dialog(page).waitFor({ state: 'visible' })
}
const readyImage = async (page) => {
  await page.waitForFunction(() => {
    const img = document.querySelector('.sop-reader-shot img')
    return img?.complete && img.naturalWidth > 0
  })
}
const newPage = async (role = 'super_admin', width = 1440, reducedMotion = 'reduce') => {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion, locale: 'zh-CN' })
  await installSopFixtures(context, role)
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${base}/sop`, { waitUntil: 'networkidle' })
  await page.locator('.sop-mega-nav').waitFor()
  return { context, page }
}

try {
  for (const [role, count] of [['user', 5], ['approver', 6], ['admin', 10], ['super_admin', 15]]) {
    const { context, page } = await newPage(role)
    await openMenu(page)
    assert.equal(await page.locator('[data-sop-process^="system-"]').count(), count, `${role} guide count`)
    if (role !== 'super_admin') assert.equal(await page.locator('[data-sop-process="system-user-management"]').count(), 0)
    results.push(`${role}: ${count} guides, downward role compatibility`)
    await context.close()
  }

  const { context, page } = await newPage()
  assert(await page.getByRole('checkbox').count() > 0, 'operations keeps checklist UX')
  assert.equal(await page.locator('.sop-stage-tabs').count(), 1)
  await openMenu(page)
  const ids = await page.locator('[data-sop-process^="system-"]').evaluateAll((nodes) => nodes.map((node) => node.dataset.sopProcess))
  await page.keyboard.press('Escape')
  let imageCount = 0
  for (const id of ids) {
    await select(page, id)
    assert.equal(await dialog(page).getByRole('checkbox').count(), 0)
    assert.equal(await page.locator('.sop-stage-tabs').count(), 0)
    assert(await dialog(page).getByRole('button', { name: '上一步', exact: true }).isDisabled())
    for (let index = 0; index < 7; index++) {
      await readyImage(page)
      assert.equal(await dialog(page).getByRole('progressbar').getAttribute('aria-valuenow'), String(index + 1))
      imageCount++
      await dialog(page).getByRole('button', { name: index === 6 ? '完成指引' : '下一步', exact: true }).click()
    }
    assert(!(await dialog(page).isVisible()), 'completion closes dialog')
    assert(await page.getByText('阅读完成不代表业务已处理。', { exact: true }).isVisible())
  }
  results.push(`${ids.length} guides / ${imageCount} real screenshot assets loaded; all steps, completion and no checklist`)
  await select(page)
  await dialog(page).getByRole('button', { name: '下一步', exact: true }).click()
  await dialog(page).getByRole('button', { name: '上一步', exact: true }).click()
  assert.equal(await page.locator('[data-step-id]').getAttribute('data-step-id'), 'system-borrow-apply-entry-1')
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab')
    assert(await page.evaluate(() => document.querySelector('dialog').contains(document.activeElement)), 'focus must remain in dialog')
  }
  await page.keyboard.press('Escape')
  assert(!(await dialog(page).isVisible()))
  await select(page)
  assert.equal(await page.locator('[data-step-id]').getAttribute('data-step-id'), 'system-borrow-apply-entry-1')
  await page.keyboard.press('Escape')
  results.push('previous/next, same-guide reopen, Escape and native keyboard focus trap')

  await page.getByRole('button', { name: '编辑 SOP', exact: true }).click()
  await select(page)
  await dialog(page).getByRole('button', { name: '插入下一步' }).click()
  await dialog(page).getByLabel('本步操作说明').fill('隔离回归：上传截图并验证刷新保存')
  await dialog(page).getByRole('button', { name: '保存 SOP' }).click()
  assert(await dialog(page).getByRole('alert').filter({ hasText: '缺少说明或有效截图' }).isVisible())
  const file = dialog(page).locator('input[type="file"]')
  await file.setInputFiles({ name: 'bad.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') })
  assert(await dialog(page).getByRole('alert').filter({ hasText: '不超过 1 MB' }).isVisible())
  await file.setInputFiles({ name: 'large.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(1024 * 1024 + 1) })
  assert(await dialog(page).getByRole('alert').filter({ hasText: '不超过 1 MB' }).isVisible())
  await dialog(page).getByLabel('截图地址').fill('javascript:alert(1)')
  assert(await dialog(page).getByText('这一步尚未配置截图', { exact: true }).isVisible())
  await file.setInputFiles(resolve('public/sop-steps/system-borrow-apply-entry-1.jpg'))
  await readyImage(page)
  const customId = await page.locator('[data-step-id]').getAttribute('data-step-id')
  await dialog(page).getByRole('button', { name: '上移本步' }).click()
  assert.equal(await dialog(page).getByRole('progressbar').getAttribute('aria-valuenow'), '1')
  await dialog(page).getByRole('button', { name: '删除本步' }).click()
  await dialog(page).getByRole('button', { name: '撤销', exact: true }).click()
  assert.equal(await page.locator('[data-step-id]').getAttribute('data-step-id'), customId)
  await dialog(page).getByRole('button', { name: '保存 SOP' }).click()
  await page.waitForFunction(() => sessionStorage.getItem('sop-fixture-processes'))
  await page.reload({ waitUntil: 'networkidle' })
  await select(page)
  await readyImage(page)
  assert.equal(await page.locator('[data-step-id]').getAttribute('data-step-id'), customId)
  assert.match(await page.locator('.sop-reader-copy h3').innerText(), /隔离回归/)
  assert.equal(await dialog(page).getByRole('progressbar').getAttribute('aria-valuemax'), '8')
  results.push('insert, required screenshot, invalid upload, local JPG upload, reorder, delete/undo, save RPC fixture and reload retention')
  assert.deepEqual(await page.evaluate(() => window.__sopFixtureWrites), [])
  await context.close()

  for (const width of [320, 375, 414, 768, 1280, 1440, 1920]) {
    const { context, page } = await newPage('user', width, 'no-preference')
    await select(page)
    await readyImage(page)
    assert.equal(await page.locator('.sop-reader-progress__item').count(), 7)
    assert(await page.locator('.sop-reader-progress__item').last().evaluate((node) => node.getBoundingClientRect().width > 0), 'liquid dots have real boxes')
    const bounds = await dialog(page).boundingBox()
    const next = await dialog(page).getByRole('button', { name: '下一步', exact: true }).boundingBox()
    assert(bounds.x >= -1 && bounds.x + bounds.width <= width + 1)
    assert(next.y + next.height <= 900 && next.x + next.width <= width, `next visible at ${width}`)
    assert(next.x > width / 2, 'next on right')
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `no horizontal overflow ${width}`)
    await page.screenshot({ path: resolve(out, `reader-${width}.png`), animations: 'disabled' })
    await dialog(page).getByRole('button', { name: '放大截图', exact: true }).click()
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'zoom is contained')
    await dialog(page).getByRole('button', { name: '下一步', exact: true }).click()
    await readyImage(page)
    assert(await dialog(page).getByRole('button', { name: '放大截图', exact: true }).isVisible(), 'zoom resets on paging')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await dialog(page).getByRole('button', { name: '下一步', exact: true }).hover()
    assert.equal(await page.locator('.sop-reader-next').evaluate((node) => getComputedStyle(node).transform), 'none')
    assert(await page.locator('.sop-reader-progress__item').last().evaluate((node) => node.getBoundingClientRect().width >= 8), 'reduced-motion dots retain geometry')
    results.push(`${width}px: modal bounds, fixed next, contained zoom, reset on paging, reduced motion`)
    await context.close()
  }

  const failure = await newPage('user')
  await failure.page.route('**/sop-steps/system-borrow-apply-entry-1.jpg', (route) => route.abort())
  await select(failure.page)
  await dialog(failure.page).getByText('截图加载失败', { exact: true }).waitFor()
  await failure.page.unroute('**/sop-steps/system-borrow-apply-entry-1.jpg')
  await dialog(failure.page).getByRole('button', { name: '重新加载', exact: true }).click()
  await readyImage(failure.page)
  results.push('failed screenshot shows actionable error and retry recovers')
  await failure.context.close()

  const mobileEdit = await newPage('super_admin', 320)
  await mobileEdit.page.setViewportSize({ width: 320, height: 568 })
  await mobileEdit.page.getByRole('button', { name: '编辑 SOP', exact: true }).click()
  await select(mobileEdit.page)
  await dialog(mobileEdit.page).getByLabel('本步操作说明').fill('手机编辑：说明和截图维护')
  await dialog(mobileEdit.page).getByRole('button', { name: '保存 SOP', exact: true }).click()
  await mobileEdit.page.waitForFunction(() => sessionStorage.getItem('sop-fixture-processes'))
  await mobileEdit.page.screenshot({ path: resolve(out, 'editor-320.png'), animations: 'disabled' })
  const nextBounds = await dialog(mobileEdit.page).getByRole('button', { name: '下一步', exact: true }).boundingBox()
  assert(nextBounds.y + nextBounds.height <= 568)
  const contrast = await mobileEdit.page.evaluate(() => {
    const style = getComputedStyle(document.querySelector('.sop-reader-dialog'))
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext('2d')
    const light = (token) => {
      ctx.fillStyle = style.getPropertyValue('--color-' + token).trim()
      ctx.fillRect(0, 0, 1, 1)
      const channels = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map((c) => {
        c /= 255
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
      })
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
    }
    return [['accent-ink', 'accent'], ['ink', 'liquid-surface'], ['muted', 'liquid-surface'], ['ink-2', 'paper-3'], ['danger', 'liquid-surface'], ['focus', 'liquid-surface'], ['focus', 'accent']].map(([fg, bg]) => {
      const a = light(fg), b = light(bg)
      return { fg, bg, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) }
    })
  })
  for (const pair of contrast) assert(pair.ratio >= (pair.fg === 'focus' ? 3 : 4.5), JSON.stringify(pair))
  results.push('320x568 editor accessible save, fixed next and screenshot upload controls; WCAG text/focus token pairs pass')
  await mobileEdit.context.close()
  assert.deepEqual(errors, [], 'no uncaught browser errors')
  await writeFile(resolve(out, 'verification.json'), JSON.stringify({ results, contrast, errors, productionWrites: 0 }, null, 2))
  console.log(results.join('\n'))
} finally { await browser.close() }
