// #653 后续：批注坞与审稿报告互斥、只可复制时的「复制」、审阅中途正文变只读的提示。
import assert from 'node:assert/strict'

import * as chapterView from './pages/chapter-view.mjs'
import { seedStageSample } from './scenarios.mjs'
import { STAGE_SAMPLE } from './stage-sample.mjs'

const PARAGRAPH = '守塔人说，雾钟是三十年前装上的，从那以后只坏过一次。那一次，北堤外沉了一条船，船名至今没人能在档案里找到。'
const NOTE = '沉船写得更具体'
const REVISED = STAGE_SAMPLE.drafts[3].text.replace('北堤外沉了一条船', '北堤外沉了一条运煤的双桅船')

const dock = page => page.getByRole('region', { name: '本章批注' })
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
  /** 1028 宽、第 3 章审稿报告默认展开：加一条批注后报告收起、批注坞出现；从「更多操作」打开报告时坞让位；关掉报告坞带着原批注回来。 */
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

  /** 润色生成中作者改了正文：点「替换」不应用，提示只可复制；点「复制」把预览原文交给剪贴板。剪贴板在页面里截住，不写系统剪贴板。 */
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

  /** 批注统一修改进入逐处审阅后，作者在动作条上点「重新审稿」，审稿卡在模型那里：点「接受全部」不写入，提示等任务结束；审稿结束后再点就写入。 */
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
}
