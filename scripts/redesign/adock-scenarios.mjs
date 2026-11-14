import assert from 'node:assert/strict'

import * as chapterView from './pages/chapter-view.mjs'
import * as runSheet from './pages/run-sheet.mjs'
import { seedStageSample } from './scenarios.mjs'
import { STAGE_SAMPLE } from './stage-sample.mjs'

const PARAGRAPH = '守塔人说，雾钟是三十年前装上的，从那以后只坏过一次。那一次，北堤外沉了一条船，船名至今没人能在档案里找到。'
const NOTE = '沉船写得更具体'
const REVISED = STAGE_SAMPLE.drafts[3].text.replace('北堤外沉了一条船', '北堤外沉了一条运煤的双桅船')

const dock = page => page.getByRole('region', { name: '本章批注' })
const marks = page => chapterView.prose(page).locator('.cm-editor-annotation').count()
const proseWidth = page => chapterView.view(page).locator('.stage-ch-prose').evaluate(node => Math.round(node.getBoundingClientRect().width))

async function annotate(page) {
  await chapterView.prose(page).getByText(PARAGRAPH).first().click({ clickCount: 3 })
  const toolbar = page.getByRole('toolbar', { name: '选中文字的操作' })
  await toolbar.getByRole('button', { name: '添加批注' }).click()
  await toolbar.getByRole('textbox', { name: '批注意见' }).fill(NOTE)
  await toolbar.getByRole('button', { name: '添加批注' }).click()
  await toolbar.waitFor({ state: 'hidden' })
}

export const ADOCK_SCENARIOS = {
  'adock-dock-vs-review': { model: false, shell: 'stage', setup: seedStageSample, run: async ({ page, shoot }) => {
    const measured = {}
    await page.setViewportSize({ width: 1028, height: 900 })
    await chapterView.open(page, 3)
    await chapterView.reviewSheet(page).waitFor({ state: 'visible' })
    measured.proseWithReview = await proseWidth(page)

    await annotate(page)
    await dock(page).waitFor({ state: 'visible' })
    measured.reviewAfterAnnotate = await chapterView.reviewSheet(page).count()
    assert.equal(measured.reviewAfterAnnotate, 0, '加批注后审稿报告收起')
    measured.proseWithDock = await proseWidth(page)
    measured.dockTitle = await dock(page).locator('.cm-selbar-title').innerText()
    assert.equal(measured.dockTitle, '本章批注 · 1')
    assert.ok(measured.proseWithDock >= measured.proseWithReview, '只开批注坞时正文栏不比只开报告时窄')
    await shoot('adock-1-dock-1028')

    await chapterView.more(page, '审稿报告')
    await chapterView.reviewSheet(page).waitFor({ state: 'visible' })
    measured.dockWithReview = await dock(page).count()
    assert.equal(measured.dockWithReview, 0, '打开报告时批注坞让位')
    measured.proseReviewAgain = await proseWidth(page)
    assert.equal(measured.proseReviewAgain, measured.proseWithReview)
    measured.marks = await chapterView.prose(page).locator('.cm-editor-annotation').count()
    assert.equal(measured.marks, 1, '报告开着时正文里的批注底色还在')
    await shoot('adock-2-review-1028')

    await chapterView.reviewSheet(page).getByRole('button', { name: '关闭审稿报告' }).first().click()
    await dock(page).waitFor({ state: 'visible' })
    measured.dockTitleBack = await dock(page).locator('.cm-selbar-title').innerText()
    assert.equal(measured.dockTitleBack, '本章批注 · 1')
    await page.setViewportSize({ width: 1440, height: 900 })
    return measured
  } },

  'adock-copy': { model: true, shell: 'stage', setup: seedStageSample, run: async ({ page, fake, shoot }) => {
    const measured = {}
    await chapterView.open(page, 3)
    await page.evaluate(() => {
      window.__copied = []
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__copied.push(text) } } })
    })
    fake.gate.hold()
    await chapterView.prose(page).getByText(PARAGRAPH).first().click({ clickCount: 3 })
    const toolbar = page.getByRole('toolbar', { name: '选中文字的操作' })
    await toolbar.getByRole('button', { name: '润色' }).click()
    await toolbar.getByRole('status').waitFor({ state: 'visible' })
    await page.keyboard.press('End')
    await page.keyboard.type('雾更浓了。')
    fake.gate.release()
    const preview = toolbar.locator('.cm-selbar-text')
    await preview.waitFor({ state: 'visible', timeout: 60_000 })
    await toolbar.getByRole('button', { name: '替换' }).click()
    measured.error = await toolbar.getByRole('alert').innerText()
    assert.equal(measured.error, '正文或原目标已变化，结果未应用；你仍可复制预览内容')
    measured.preview = await preview.innerText()
    await shoot('adock-3-copy')

    await toolbar.getByRole('button', { name: '复制' }).click()
    measured.copied = await page.evaluate(() => window.__copied)
    assert.deepEqual(measured.copied, [measured.preview], '剪贴板收到的是预览原文')
    return measured
  } },

  'adock-readonly': { model: true, shell: 'stage', setup: seedStageSample, run: async ({ page, fake, shoot }) => {
    const measured = {}
    fake.replyReview(prompt => prompt.includes(NOTE) ? REVISED : null)
    await chapterView.open(page, 3)
    await annotate(page)
    await dock(page).getByRole('button', { name: '统一修改（1）' }).click()
    const review = page.getByRole('region', { name: '批注修改对比' })
    await review.waitFor({ state: 'visible', timeout: 60_000 })

    fake.gate.hold()
    await chapterView.view(page).getByRole('button', { name: '重新审稿', exact: true }).click()
    for (let i = 0; fake.gate.waiting === 0; i++) { assert.ok(i < 600, '审稿请求停在假模型的门上'); await page.waitForTimeout(100) }
    await review.getByRole('button', { name: '接受全部' }).click()
    const alert = review.getByRole('alert')
    measured.alert = await alert.innerText()
    assert.equal(measured.alert, '修改还在，但正文现在不能编辑，没有保存。等本章任务结束再点「接受全部」，或点「取消」放弃。')
    measured.alertInViewport = await alert.evaluate(node => { const box = node.getBoundingClientRect(); return box.top >= 0 && box.bottom <= window.innerHeight })
    assert.equal(measured.alertInViewport, true, '点「接受全部」后提示就在眼前，不在长正文的末尾')
    await shoot('adock-4-readonly')

    fake.gate.release()
    await chapterView.reviewSheet(page).waitFor({ state: 'visible', timeout: 60_000 })
    await review.getByRole('button', { name: '接受全部' }).click()
    await review.waitFor({ state: 'hidden', timeout: 30_000 })
    await chapterView.prose(page).getByText('北堤外沉了一条运煤的双桅船').waitFor({ state: 'visible' })
    measured.savedAfterTask = true
    return measured
  } },

  'adock-restore-review': { model: true, shell: 'stage', setup: seedStageSample, run: async ({ page, fake, shoot }) => {
    const measured = {}
    fake.replyReview(prompt => prompt.includes(NOTE) ? REVISED : null)
    await chapterView.open(page, 3)
    await chapterView.reviewSheet(page).waitFor({ state: 'visible' })
    await shoot('adock-r1-review-before')

    await annotate(page)
    await dock(page).waitFor({ state: 'visible' })
    measured.reviewWhileDocked = await chapterView.reviewSheet(page).count()
    assert.equal(measured.reviewWhileDocked, 0, '加批注后审稿报告让位')
    measured.dockTitle = await dock(page).locator('.cm-selbar-title').innerText()
    assert.equal(measured.dockTitle, '本章批注 · 1')
    await shoot('adock-r2-docked')

    await dock(page).getByRole('button', { name: '统一修改（1）' }).click()
    const review = page.getByRole('region', { name: '批注修改对比' })
    await review.waitFor({ state: 'visible', timeout: 60_000 })
    await review.getByRole('button', { name: '接受全部' }).click()
    await review.waitFor({ state: 'hidden', timeout: 30_000 })
    await chapterView.prose(page).getByText('北堤外沉了一条运煤的双桅船').waitFor({ state: 'visible' })
    await chapterView.reviewSheet(page).waitFor({ state: 'visible' })
    measured.dockAfterCommit = await dock(page).count()
    assert.equal(measured.dockAfterCommit, 0, '统一修改写进正文后批注坞收起')
    await shoot('adock-r3-review-back')
    return measured
  } },

  'adock-restore-run': { model: false, shell: 'stage', setup: seedStageSample, run: async ({ page, shoot }) => {
    const measured = {}
    await chapterView.open(page, 3)
    await chapterView.reviewSheet(page).waitFor({ state: 'visible' })
    await runSheet.openFromPalette(page)
    measured.reviewUnderRun = await chapterView.reviewSheet(page).count()
    assert.equal(measured.reviewUnderRun, 0, '运行侧页顶替审稿报告')
    await shoot('adock-r4-run-before')
    await annotate(page)
    await dock(page).waitFor({ state: 'visible' })
    measured.runWhileDocked = await runSheet.sheet(page).count()
    assert.equal(measured.runWhileDocked, 0, '加批注后运行侧页让位')
    await shoot('adock-r4-run-docked')

    await dock(page).getByRole('button', { name: '删除批注 1' }).click()
    await runSheet.waitUntilOpen(page)
    measured.dockAfterDelete = await dock(page).count()
    measured.reviewAfterDelete = await chapterView.reviewSheet(page).count()
    assert.equal(measured.dockAfterDelete, 0)
    assert.equal(measured.reviewAfterDelete, 0, '只放回运行侧页，不另开审稿报告')
    measured.marksAfterDelete = await marks(page)
    assert.equal(measured.marksAfterDelete, 0, '正文里不留批注底色')
    await chapterView.prose(page).getByText(PARAGRAPH).first().click()
    await shoot('adock-r4-run-back')
    return measured
  } },

  'adock-restore-empty': { model: false, shell: 'stage', setup: seedStageSample, run: async ({ page, shoot }) => {
    const measured = {}
    await chapterView.open(page, 3)
    await chapterView.reviewSheet(page).waitFor({ state: 'visible' })
    await chapterView.reviewSheet(page).getByRole('button', { name: '关闭审稿报告' }).first().click()
    await chapterView.reviewSheet(page).waitFor({ state: 'hidden' })
    await annotate(page)
    await dock(page).waitFor({ state: 'visible' })

    await dock(page).getByRole('button', { name: '清空' }).click()
    await dock(page).waitFor({ state: 'hidden' })
    await page.waitForTimeout(500)
    measured.reviewAfterClear = await chapterView.reviewSheet(page).count()
    measured.runAfterClear = await runSheet.sheet(page).count()
    assert.equal(measured.reviewAfterClear, 0, '之前侧栏空着，清空批注后仍空着')
    assert.equal(measured.runAfterClear, 0)
    measured.marksAfterClear = await marks(page)
    assert.equal(measured.marksAfterClear, 0, '正文里不留批注底色')
    await chapterView.prose(page).getByText(PARAGRAPH).first().click()
    await shoot('adock-r5-empty')
    return measured
  } },

  'adock-restore-empty-commit': { model: true, shell: 'stage', setup: seedStageSample, run: async ({ page, fake, shoot }) => {
    const measured = {}
    fake.replyReview(prompt => prompt.includes(NOTE) ? REVISED : null)
    await chapterView.open(page, 3)
    await chapterView.reviewSheet(page).waitFor({ state: 'visible' })
    await chapterView.reviewSheet(page).getByRole('button', { name: '关闭审稿报告' }).first().click()
    await chapterView.reviewSheet(page).waitFor({ state: 'hidden' })
    await annotate(page)
    await dock(page).getByRole('button', { name: '统一修改（1）' }).click()
    const review = page.getByRole('region', { name: '批注修改对比' })
    await review.waitFor({ state: 'visible', timeout: 60_000 })
    await review.getByRole('button', { name: '接受全部' }).click()
    await review.waitFor({ state: 'hidden', timeout: 30_000 })
    await chapterView.prose(page).getByText('北堤外沉了一条运煤的双桅船').waitFor({ state: 'visible' })
    await page.waitForTimeout(1000)
    measured.reviewAfterCommit = await chapterView.reviewSheet(page).count()
    measured.runAfterCommit = await runSheet.sheet(page).count()
    measured.dockAfterCommit = await dock(page).count()
    assert.equal(measured.reviewAfterCommit, 0, '之前侧栏空着，提交后不替作者打开报告')
    assert.equal(measured.runAfterCommit, 0)
    assert.equal(measured.dockAfterCommit, 0)
    await shoot('adock-r6-empty-commit')
    return measured
  } },
}
