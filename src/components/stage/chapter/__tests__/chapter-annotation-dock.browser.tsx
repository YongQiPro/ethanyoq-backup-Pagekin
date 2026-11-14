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
import { useWorkflowStore } from '../../../../stores/workflow-store'
import StageWorkspace from '../../StageWorkspace'
import { BLUEPRINT, ORIGINAL, SESSION, chapterProject, createChapterBackend, generationModel } from './chapter-fixture'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const original = { editor: useEditorStore.getState(), project: useProjectStore.getState(), drafts: useDraftStore.getState(), stage: useStageStore.getState(), llm: useLLMStore.getState(), workflow: useWorkflowStore.getState() }
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
  useWorkflowStore.setState(original.workflow, true)
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

it('审稿报告开着时进入专注模式：报告随专注收起，批注坞回来，原批注仍可看', async () => {
  await openChapter({ reviewed: true })
  await annotate('他第三次展开信纸。', '写出信纸上的字')
  await act(async () => page.getByRole('button', { name: '更多操作' }).click())
  await act(async () => page.getByRole('menuitem', { name: '审稿报告' }).click())
  await expect.element(dock()).not.toBeInTheDocument()

  await act(async () => useStageStore.setState({ focus: true }))

  await expect.element(reviewSheet()).not.toBeInTheDocument()
  await expect.element(dock()).toBeVisible()
  await expect.element(page.getByText('本章批注 · 1')).toBeVisible()
})

it('侧页记着本稿的审稿报告、本稿却没有审稿：报告画不出来，批注坞照常显示', async () => {
  await openChapter({ reviewed: false })
  await annotate('他第三次展开信纸。', '写出信纸上的字')
  const filePath = useEditorStore.getState().tabs.find(tab => tab.id === useEditorStore.getState().activeTabId)!.filePath!

  await act(async () => useStageStore.setState({ sheet: { kind: 'review', filePath } }))

  await expect.element(reviewSheet()).not.toBeInTheDocument()
  await expect.element(dock()).toBeVisible()
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

async function openAnnotationReview(reviewed = false) {
  const answer = backend.invoke.getMockImplementation()!
  let recovery: { view: object; modelId: string; sourceStatus: string; context: object } | null = null
  backend.invoke.mockImplementation(async (channel: string, ...args: unknown[]) => {
    if (channel === 'editor-inline:begin') {
      const input = (args[0] as { input: { documentText: string } }).input
      const documentHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input.documentText))), byte => byte.toString(16).padStart(2, '0')).join('')
      const handle = { projectId: SESSION.projectId, epoch: SESSION.leaseId, rootActionId: 'root', runId: 'batch' }
      recovery = { view: { handle, status: 'running', artifacts: [] }, modelId: 'grok', sourceStatus: 'current', context: { ...input, kind: 'author-draft', documentHash } }
      return recovery
    }
    if (channel === 'editor-inline:execute') {
      const content = ORIGINAL.replace('他第三次展开信纸。', '他第三次展开信纸，上面只有两个字：等我。')
      const run = { ...recovery!.view, status: 'completed', artifacts: [{ ...(recovery!.view as { handle: object }).handle, artifactId: 'proof', textHash: 'proof-hash', text: content, status: 'completed', compositionEligible: true }] }
      recovery = { ...recovery!, view: run }
      return { run, sourceStatus: 'current', outcome: { status: 'completed', content, finishReason: 'stop', receipt: { finishReason: 'stop' } } }
    }
    if (channel === 'editor-inline:read-recovery') return recovery
    if (channel === 'editor-inline:delivered') return undefined
    if (channel === 'db:annotation-commit') {
      const { draftId, after } = args[0] as { draftId: number; after: string }
      Object.assign(backend.state.drafts.find(draft => draft.id === draftId)!, { content: after })
      return { success: true }
    }
    return answer(channel, ...args)
  })
  await openChapter({ reviewed, content: ORIGINAL })
  await annotate('他第三次展开信纸。', '写出信纸上的字')
  await act(async () => page.getByRole('button', { name: '统一修改（1）' }).click())
  const review = page.getByRole('region', { name: '批注修改对比' })
  await expect.element(review).toBeVisible()
  return review
}
const annotationCommits = () => backend.invoke.mock.calls.filter(([channel]) => channel === 'db:annotation-commit')

it('批注修改审阅到一半，这一稿被定稿：点「接受全部」提示到当前版本里改，不叫作者等任务结束', async () => {
  const review = await openAnnotationReview()

  await act(async () => useEditorStore.setState(state => ({ tabs: state.tabs.map(tab => ({ ...tab, draftStatus: 'finalized' as const })) })))
  await act(async () => review.getByRole('button', { name: '接受全部' }).click())

  await expect.element(review.getByRole('alert')).toHaveTextContent('这一稿已定稿或有了新版本，修改没有保存。点「取消」后到当前版本里改。')
  expect(annotationCommits()).toEqual([])
})

it('批注修改审阅到一半，本章被任务占用：点「接受全部」仍提示等本章任务结束', async () => {
  const review = await openAnnotationReview()

  await act(async () => useWorkflowStore.setState({ activeRuns: [{ id: 'review-run', type: 'chapter_creation', title: '审稿第 3 章',
    status: 'running', projectPath: SESSION.projectPath, resourceKeys: ['chapter:3'], steps: [], currentStepIndex: 0, logs: [] } as never] }))
  await act(async () => review.getByRole('button', { name: '接受全部' }).click())

  await expect.element(review.getByRole('alert')).toHaveTextContent('修改还在，但正文现在不能编辑，没有保存。等本章任务结束再点「接受全部」，或点「取消」放弃。')
  expect(annotationCommits()).toEqual([])
})

const runSheet = () => page.getByRole('complementary', { name: '运行' })

it('审稿报告开着时加批注，用完后清空批注：报告回到侧栏', async () => {
  await openChapter({ reviewed: true })
  await expect.element(reviewSheet()).toBeVisible()
  await annotate('他第三次展开信纸。', '写出信纸上的字')
  await expect.element(reviewSheet()).not.toBeInTheDocument()

  await act(async () => dock().getByRole('button', { name: '清空' }).click())

  await expect.element(dock()).not.toBeInTheDocument()
  await expect.element(reviewSheet()).toBeVisible()
})

it('审稿报告开着时加批注，统一修改接受全部写进正文后：报告回到侧栏', async () => {
  const review = await openAnnotationReview(true)
  await expect.element(reviewSheet()).not.toBeInTheDocument()

  await act(async () => review.getByRole('button', { name: '接受全部' }).click())

  await expect.element(review).not.toBeInTheDocument()
  await expect.element(page.getByText('他第三次展开信纸，上面只有两个字：等我。')).toBeVisible()
  await expect.element(reviewSheet()).toBeVisible()
})

it('运行侧页开着时加批注，删掉最后一条批注后：运行侧页回来', async () => {
  await openChapter({ reviewed: false })
  await act(async () => useStageStore.setState({ sheet: { kind: 'run', tab: 'history' } }))
  await expect.element(runSheet()).toBeVisible()
  await annotate('他第三次展开信纸。', '写出信纸上的字')
  await expect.element(runSheet()).not.toBeInTheDocument()

  await act(async () => dock().getByRole('button', { name: '删除批注 1' }).click())

  await expect.element(dock()).not.toBeInTheDocument()
  await expect.element(runSheet()).toBeVisible()
  expect(useStageStore.getState().sheet).toEqual({ kind: 'run', tab: 'history' })
})

it('作者先关掉审稿报告再加批注，用完后：侧栏仍空着，不替作者打开报告', async () => {
  await openChapter({ reviewed: true })
  await act(async () => page.getByRole('button', { name: '关闭审稿报告' }).click())
  await expect.element(reviewSheet()).not.toBeInTheDocument()
  await annotate('他第三次展开信纸。', '写出信纸上的字')

  await act(async () => dock().getByRole('button', { name: '清空' }).click())

  await expect.element(dock()).not.toBeInTheDocument()
  await expect.element(reviewSheet()).not.toBeInTheDocument()
  expect(useStageStore.getState().sheet).toBeNull()
})

it('批注期间打开过报告又关掉，用完后：放回批注前开着的那一页', async () => {
  await openChapter({ reviewed: true })
  await annotate('他第三次展开信纸。', '写出信纸上的字')
  await act(async () => page.getByRole('button', { name: '更多操作' }).click())
  await act(async () => page.getByRole('menuitem', { name: '审稿报告' }).click())
  await act(async () => page.getByRole('button', { name: '关闭审稿报告' }).click())
  await expect.element(dock()).toBeVisible()

  await act(async () => dock().getByRole('button', { name: '清空' }).click())

  await expect.element(reviewSheet()).toBeVisible()
})

it('报告让位后批注随修稿合并收走，回到正文再加批注、用完：不放回早先那一页', async () => {
  await openChapter({ reviewed: true })
  await annotate('他第三次展开信纸。', '写出信纸上的字')
  const filePath = useEditorStore.getState().tabs.find(tab => tab.id === useEditorStore.getState().activeTabId)!.filePath!
  await act(async () => { backend.addRevision(backend.state.drafts.at(-1)!); useStageStore.setState({ chapterRequest: { session: SESSION, filePath } }) })
  await act(async () => page.getByRole('button', { name: '稍后再合并' }).click())
  await expect.element(page.getByRole('region', { name: '修稿合并' })).not.toBeInTheDocument()
  await expect.element(reviewSheet()).not.toBeInTheDocument()
  await annotate('他第三次展开信纸。', '写出信纸上的字')

  await act(async () => dock().getByRole('button', { name: '清空' }).click())

  await expect.element(dock()).not.toBeInTheDocument()
  expect(useStageStore.getState().sheet).toBeNull()
})
