import { afterEach, beforeEach, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import '../../../../index.css'

import { setActiveProjectSessionContext } from '../../../../shared/project-session-context'
import { useDraftStore } from '../../../../stores/draft-store'
import { useEditorStore } from '../../../../stores/editor-store'
import { useLLMStore } from '../../../../stores/llm-store'
import { useLocaleStore } from '../../../../stores/locale-store'
import { useStageStore } from '../../../../stores/navigation/stage-store'
import { openDraftTab } from '../../../../stores/open-draft-tab'
import { useProjectStore } from '../../../../stores/project-store'
import StageWorkspace from '../../StageWorkspace'
import { BLUEPRINT, SESSION, chapterProject, createChapterBackend, generationModel } from './chapter-fixture'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const original = { editor: useEditorStore.getState(), project: useProjectStore.getState(), drafts: useDraftStore.getState(), stage: useStageStore.getState(), llm: useLLMStore.getState() }
let root: Root
let host: HTMLDivElement
let backend: ReturnType<typeof createChapterBackend>

async function openChapter(fields: { content?: string; reviewed: boolean }) {
  const draft = backend.addDraft({ status: 'draft', ...(fields.content ? { content: fields.content } : {}) })
  if (fields.reviewed) backend.addReview(draft)
  await act(async () => { await useDraftStore.getState().loadAllDrafts(SESSION.projectPath, SESSION) })
  await act(async () => { await openDraftTab(useDraftStore.getState().draftsByChapter[3]!.find(candidate => candidate.id === draft.id)!, '第 3 章 · 雨夜车站', SESSION) })
}

async function annotate(line: string, note: string) {
  await act(async () => page.getByText(line, { exact: true }).click({ clickCount: 3 }))
  await act(async () => page.getByRole('button', { name: '添加批注' }).click())
  await act(async () => page.getByRole('textbox', { name: '批注意见' }).fill(note))
  await act(async () => page.getByRole('button', { name: '添加批注' }).click())
}

beforeEach(async () => {
  await page.viewport(1280, 900)
  backend = createChapterBackend()
  backend.install()
  useLocaleStore.setState({ locale: 'zh-CN' })
  useProjectStore.setState({ currentProject: chapterProject() })
  setActiveProjectSessionContext(SESSION)
  useEditorStore.setState({ tabs: [], activeTabId: null, draftLedgers: {} })
  useStageStore.setState({ work: { session: SESSION, architecture: {}, blueprints: [{ chapterNumber: 3, title: BLUEPRINT.title }] }, spineFacts: SESSION, chapterRequest: null, writeRequest: null, sheet: null })
  useLLMStore.setState({ models: [generationModel('grok')], defaultModelId: 'grok', loaded: true })
  host = document.createElement('div')
  host.className = 'paper-ink stage-shell'
  host.style.cssText = 'display:flex;flex-direction:column;height:900px;width:1028px'
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(<StageWorkspace library={false} focus={false} />))
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  Reflect.deleteProperty(window, 'aiNovelAPI')
  setActiveProjectSessionContext(null)
  useEditorStore.setState(original.editor, true)
  useProjectStore.setState(original.project, true)
  useDraftStore.setState(original.drafts, true)
  useStageStore.setState(original.stage, true)
  useLLMStore.setState(original.llm, true)
})

const reviewSheet = () => page.getByRole('complementary', { name: /审稿/ })
const dock = () => page.getByRole('region', { name: '本章批注' })
const proseWidth = () => document.querySelector('.stage-ch-prose')!.getBoundingClientRect().width

it('已审稿的稿在 1028px 下加批注：审稿报告让位给批注坞，正文栏不被两页挤窄；打开报告时坞让位，关掉报告坞带着原批注回来', async () => {
  await openChapter({ reviewed: true })
  await expect.element(reviewSheet()).toBeVisible()
  const widthWithOneSheet = proseWidth()

  await annotate('他第三次展开信纸。', '写出信纸上的字')

  await expect.element(dock()).toBeVisible()
  await expect.element(reviewSheet()).not.toBeInTheDocument()
  expect(proseWidth()).toBeGreaterThanOrEqual(widthWithOneSheet)

  await act(async () => page.getByRole('button', { name: '更多操作' }).click())
  await act(async () => page.getByRole('menuitem', { name: '审稿报告' }).click())
  await expect.element(reviewSheet()).toBeVisible()
  await expect.element(dock()).not.toBeInTheDocument()
  expect(proseWidth()).toBeGreaterThanOrEqual(widthWithOneSheet)

  await act(async () => page.getByRole('button', { name: '关闭审稿报告' }).click())
  await expect.element(dock()).toBeVisible()
  await expect.element(page.getByText('本章批注 · 1')).toBeVisible()
})

it('批注的原文滚出纸面后点「定位批注」：原文滚回可见范围，不压在吸顶的动作条下面', async () => {
  await openChapter({ reviewed: false, content: Array.from({ length: 60 }, (_, index) => `第 ${index + 1} 段：雨从傍晚开始就没有停过。`).join('\n\n') })
  await annotate('第 1 段：雨从傍晚开始就没有停过。', '写出雨声')
  const scroller = document.querySelector('.stage-ch-scroll')!
  await act(async () => { scroller.scrollTop = scroller.scrollHeight })
  const visible = () => {
    const mark = document.querySelector('.cm-editor-annotation')?.getBoundingClientRect()
    const top = document.querySelector('.stage-ch-actions-sticky')!.getBoundingClientRect().bottom
    return Boolean(mark && mark.top >= top && mark.bottom <= scroller.getBoundingClientRect().bottom)
  }
  expect(visible()).toBe(false)

  await act(async () => page.getByRole('button', { name: '定位批注 1' }).click())

  await expect.poll(visible).toBe(true)
})
