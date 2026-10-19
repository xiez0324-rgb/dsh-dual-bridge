/**
 * 分流对话 Tab 组件。
 *
 * 流程：
 *  1. 读取当前会话工作区 cwd（api.sessionCwd）
 *  2. 扫描项目文件（api.fsTree 递归 + 排除规则过滤）
 *  3. 用户勾选要打包的文件（或全选），设定 token 预算
 *  4. 读取文件内容（api.fsRead），组装 prompt
 *  5. 一键复制剪贴板（navigator.clipboard）
 *  6. 半自动分流引导：提示用户手动粘贴到 DeepSeek 网页版免费对话
 *
 * 合规边界：只读本地文件 + 复制剪贴板，不操控浏览器、不调网页接口。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'
import type { Capabilities } from './api'
import { extractKindOf, isImagePath } from './extractable'
import { openSplitWindow } from './split-window'
import type { TabComponentProps } from 'dsh-better-sidebar'
import {
  DEFAULT_EXCLUDES, shouldInclude, assemblePrompt, buildTreeText, applyBudget, extLang,
  selectRelevantAttachments,
} from './pack'
import {
  buildFileTree, collectDirPaths, countSelected, selectionOf, toggleNodeSelection, type TreeNode,
} from './file-tree'

type Phase = 'loading' | 'scanning' | 'select' | 'preview' | 'copied'

/** 扫描上限可选值（0 = 不限）。默认 2000：覆盖常见工作区，又不会把浏览器拖死。 */
const FILE_CAP_OPTIONS = [500, 2000, 10000, 0] as const
const DEFAULT_FILE_CAP = 2000
const MAX_BYTES = 3 * 1024 * 1024 // 单文件 3MB 上限
/** 打包时最多读取的文件数（防止误选上千个文件导致长时间卡住） */
const MAX_READ_FILES = 500
/** 并发读取的文件数：一次发 8 个 fs.read，比串行快数倍 */
const READ_CONCURRENCY = 8
/** 附件清单最多列多少个（避免上万条把 prompt/界面撑爆） */
const MAX_SKIPPED_LISTED = 300

/** 超预算时的策略：warn=只提示；truncate=按顺序累加，装不下就停 */
type BudgetMode = 'warn' | 'truncate'
/** 显示在标题旁，用于确认「浏览器加载的是不是最新构建」。改版本时同步 package.json。 */
const BUILD_VERSION = '0.12.1'

export function DualBridgeTab(props: TabComponentProps): React.ReactNode {
  const { scope } = props

  const [cwd, setCwd] = useState<string>('')
  const [root, setRoot] = useState<string>('')
  const [allFiles, setAllFiles] = useState<{ relPath: string; path: string; size: number }[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // 展开的目录集合（默认全部折叠：几百个文件时不至于一屏刷满）
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [tokenBudget, setTokenBudget] = useState(8000)
  const [phase, setPhase] = useState<Phase>('loading')
  const [error, setError] = useState<string>('')
  const [result, setResult] = useState<
    { prompt: string; tokens: number; fileCount: number; dropped: string[]; overBudget: boolean } | null
  >(null)
  const [budgetMode, setBudgetMode] = useState<BudgetMode>('warn')
  // 是否在 prompt 里声明"同目录未包含的附件"。默认关闭：保持 prompt 干净。
  const [includeAttachments, setIncludeAttachments] = useState(false)
  const [packNotice, setPackNotice] = useState<string>('')
  // 按需抽取：正在抽的文件 / 已抽取的文本 / 抽取错误
  const [extracting, setExtracting] = useState<Set<string>>(new Set())
  const [extracted, setExtracted] = useState<
    Record<string, { text: string; chars: number; truncated: boolean; engine: string }>
  >({})
  const [extractError, setExtractError] = useState<string>('')
  // 同屏窗口打开结果提示（原「网页对话」Tab 的能力，已并入本 Tab）
  const [openNotice, setOpenNotice] = useState<string>('')
  // 本机能力（决定「抽取文本 / OCR」按钮是否可用）
  const [caps, setCaps] = useState<Capabilities | null>(null)
  // host 端构建版本（用于发现"改了 host 但没重启"的新旧混跑）
  const [hostBuild, setHostBuild] = useState<string | null>(null)
  // 导出包：是否同时打 zip / 生成中 / 结果
  const [makeZip, setMakeZip] = useState(false)
  const [bundling, setBundling] = useState(false)
  const [bundleInfo, setBundleInfo] = useState<
    { dir: string; zipPath?: string; fileCount: number; bytes: number; files: string[] } | null
  >(null)
  const [search, setSearch] = useState('')
  // 扫描进度：已扫描目录数 / 已发现文件数
  const [scanProgress, setScanProgress] = useState<{ dirs: number; files: number } | null>(null)
  // 扫描上限（0 = 不限）；「被类型过滤跳过」的每目录统计；扫描提示
  const [fileCap, setFileCap] = useState<number>(DEFAULT_FILE_CAP)
  const [skippedStats, setSkippedStats] = useState<Record<string, number>>({})
  // 被跳过的具体文件（用于 prompt 的【未包含的附件】与界面清单）
  const [skippedFiles, setSkippedFiles] = useState<{ relPath: string; path: string }[]>([])
  const [scanNotice, setScanNotice] = useState<string>('')

  // 组件卸载时取消未完成的异步操作
  const disposedRef = useRef(false)
  useEffect(() => () => {
    disposedRef.current = true
  }, [])

  // 0. 探测本机能力（pdf / office / ocr），用于决定按钮是否可用
  useEffect(() => {
    let cancelled = false
    void api
      .capabilities()
      .then(({ caps: c, hostBuild: build }) => {
        if (cancelled) return
        setCaps(c)
        setHostBuild(build ?? null)
      })
      .catch(() => {
        /* 探测失败时按"都不可用"处理，按钮自然不显示 */
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 1. 加载工作区
  useEffect(() => {
    let cancelled = false
    setError('')
    // 全新会话尚未激活时 scope.sessionId 为空，host 会拒绝 session.cwd。
    // 明确告知原因，而不是让界面停在"加载中"没有任何反馈。
    if (!scope.sessionId) {
      setPhase('loading')
      setError('当前会话尚未激活（sessionId 为空）：请先新建或进入一个会话，再切回本 Tab。')
      return () => {
        cancelled = true
      }
    }
    ;(async () => {
      try {
        const info = await api.sessionCwd(scope)
        if (cancelled) return
        setCwd(info.cwd)
        setRoot(info.root)
        // 只切到 scanning；真正的扫描由下面第 3 步的 effect 启动
        setPhase('scanning')
      } catch (e) {
        if (!cancelled) {
          setPhase('select')
          setError(`读取工作区失败：${(e as Error).message}`)
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.sessionId])

  // 扫描令牌：新扫描会让旧扫描的循环尽快退出，也避免重复点击叠加请求
  const scanTokenRef = useRef(0)

  // 2. 扫描项目文件（rootOverride 让工作区刚就绪时可以立即用新路径启动）
  const scan = useCallback(async (rootOverride?: string, capOverride?: number) => {
    const startPath = rootOverride ?? (cwd || root)
    if (!startPath) {
      setError('工作区尚未就绪，请稍后再试')
      return
    }
    const token = ++scanTokenRef.current
    const stale = () => token !== scanTokenRef.current || disposedRef.current

    setPhase('scanning')
    setError('')
    setScanNotice('')
    setScanProgress({ dirs: 0, files: 0 })
    try {
      // 去掉末尾斜杠，保证 visited 的路径比较与 host 返回形式一致
      const rootPath = startPath.length > 1 ? startPath.replace(/\/+$/, '') : startPath
      const norm = (p: string): string => (p.length > 1 ? p.replace(/\/+$/, '') : p)
      const found: { relPath: string; path: string; size: number }[] = []
      // BFS 逐层遍历，保持目录层级顺序稳定
      const queue: string[] = [rootPath]
      const visited = new Set<string>()
      const excludeArr = [...DEFAULT_EXCLUDES]
      const capValue = capOverride ?? fileCap
      const cap = capValue > 0 ? capValue : Number.POSITIVE_INFINITY
      // 每目录被"类型过滤"跳过的文件数：解释"这个文件夹为什么几乎看不到文件"
      const skippedByDir: Record<string, number> = {}
      const skippedList: { relPath: string; path: string }[] = []
      let truncatedDirs = 0
      let reachedLimit = false
      let dirCount = 0
      let lastProgressAt = 0

      // 收集一层目录的条目（闭包复用 found/queue/visited/reachedLimit）
      const collect = (
        dirPath: string,
        entries: { name: string; path: string; isDir: boolean }[],
      ): void => {
        const dirKey = norm(dirPath)
        if (reachedLimit || visited.has(dirKey)) return
        visited.add(dirKey)
        dirCount++
        // 该目录的**相对**路径（skippedByDir 用相对路径做 key，与文件树一致）
        const dirRel = dirKey === rootPath
          ? ''
          : dirKey.startsWith(rootPath + '/')
            ? dirKey.slice(rootPath.length + 1)
            : dirKey
        for (const entry of entries) {
          const entryPath = norm(entry.path)
          const relPath = entryPath.startsWith(rootPath + '/')
            ? entryPath.slice(rootPath.length + 1)
            : entryPath
          if (entry.isDir) {
            if (shouldInclude(relPath + '/', excludeArr)) queue.push(entryPath)
          } else if (shouldInclude(relPath, excludeArr)) {
            found.push({ relPath, path: entryPath, size: 0 })
          } else {
            // 文件确实存在，只是类型不可打包（PDF/图片/Office/二进制）
            skippedByDir[dirRel] = (skippedByDir[dirRel] ?? 0) + 1
            if (skippedList.length < MAX_SKIPPED_LISTED) {
              skippedList.push({ relPath, path: entryPath })
            }
          }
          if (found.length >= cap) {
            reachedLimit = true
            return
          }
        }
      }

      // 批量请求：一次 fsTrees 列出多个目录，大幅减少串行往返
      const BATCH = 16
      while (queue.length > 0 && !reachedLimit) {
        if (stale()) return
        const batch = queue.splice(0, BATCH)

        let levels: Awaited<ReturnType<typeof api.fsTrees>>['levels'] | undefined
        try {
          const result = await api.fsTrees(scope, batch, excludeArr)
          levels = result.levels
        } catch {
          levels = undefined
        }

        if (levels === undefined) {
          // 批量接口失败（或返回体不符合预期）：退化为逐个 fsTree，目录级容错。
          // 注意：这里**不能**先把 dir 标进 visited —— 否则 collect() 会因
          // “已访问”直接返回，子目录永远得不到展开（旧版的卡死点之一）。
          for (const dir of batch) {
            if (stale()) return
            if (visited.has(norm(dir))) continue
            try {
              const tree = await api.fsTree(scope, dir, excludeArr)
              collect(tree.path, tree.entries)
            } catch {
              continue
            }
          }
        } else {
          for (const level of levels) {
            if (!level || level.error) continue
            if (level.truncated) truncatedDirs++
            collect(level.path, level.entries)
          }
        }

        // 节流更新进度（每批更新一次）
        const now = Date.now()
        if (now - lastProgressAt > 100) {
          lastProgressAt = now
          if (stale()) return
          setScanProgress({ dirs: dirCount, files: found.length })
        }
      }

      if (stale()) return
      // 按路径排序，稳定展示
      found.sort((a, b) => a.relPath.localeCompare(b.relPath))
      setAllFiles(found)
      setSkippedStats(skippedByDir)
      setSkippedFiles(skippedList)
      // 换了一批文件，之前抽取的文本不再对应，清空避免串味
      setExtracted({})
      setExtractError('')
      // 默认什么都不选、也不展开：避免一进 Tab 就把几百上千个文件全部打包
      setSelected(new Set())
      setExpanded(new Set())
      // 明确告知是否被上限/截断影响，而不是静默少显示文件
      const notices: string[] = []
      if (reachedLimit && cap !== Number.POSITIVE_INFINITY) {
        notices.push(`已达扫描上限 ${cap.toLocaleString()} 个文件，仅列出前 ${found.length} 个；提高上限后可重新扫描`)
      }
      if (truncatedDirs > 0) {
        notices.push(`${truncatedDirs} 个目录的条目被宿主截断，其中可能有文件未列出`)
      }
      setScanNotice(notices.join('；'))
      setScanProgress(null)
      setPhase('select')
      if (found.length === 0) {
        setError(`在 ${rootPath} 下没有找到可打包的文件（可能被排除规则全部过滤）。`)
      }
    } catch (e) {
      if (stale()) return
      setError(`扫描失败：${(e as Error).message}`)
      setScanProgress(null)
      setPhase('select')
    }
  }, [cwd, root, scope, fileCap])

  // 3. 自动扫描（修复「一直卡在正在扫描」）
  //    旧版只有「↻ 重新扫描」按钮会调用 scan()，而该按钮只在非 scanning 阶段渲染，
  //    于是 sessionCwd 成功后 phase 变成 scanning 就再没有任何东西启动扫描 → 死局。
  //    这里用 key 去重：同一会话+同一路径只自动触发一次，避免与手动重扫叠加。
  const autoScanKey = useRef('')
  useEffect(() => {
    if (phase !== 'scanning') return
    const start = cwd || root
    if (!start) return
    const key = `${scope.sessionId}|${start}`
    if (autoScanKey.current === key) return
    autoScanKey.current = key
    void scan(start)
  }, [phase, cwd, root, scope.sessionId, scan])

  // 3. 组装 prompt 并复制
  const tree = useMemo(
    () => buildFileTree(allFiles, skippedStats, skippedFiles),
    [allFiles, skippedStats, skippedFiles],
  )
  /** 相对路径 -> 绝对路径（抽取时要用绝对路径调 host 路由） */
  const skippedPathMap = useMemo(
    () => new Map(skippedFiles.map((f) => [f.relPath, f.path])),
    [skippedFiles],
  )
  /** 已抽取的条目（进入 prompt 的【抽取的附件文本】段） */
  const extractedEntries = useMemo(
    () => Object.entries(extracted).map(([relPath, v]) => ({ relPath, content: v.text })),
    [extracted],
  )

  const packAndCopy = useCallback(async () => {
    setError('')
    setPackNotice('')
    setBundleInfo(null)
    setPhase('preview')
    try {
      const picked = allFiles.filter((f) => selected.has(f.relPath))
      // 读取上限：超出的部分必须明确告知，不能静默丢弃
      const candidates = picked.slice(0, MAX_READ_FILES)
      const overCap = picked.length - candidates.length

      // 并发读取（保持选择顺序：结果按候选下标回填）
      const slots: ({ relPath: string; content: string; size: number } | null)[] = new Array(
        candidates.length,
      ).fill(null)
      let skippedLarge = 0
      let skippedBinary = 0
      let readFailed = 0

      for (let start = 0; start < candidates.length; start += READ_CONCURRENCY) {
        const chunk = candidates.slice(start, start + READ_CONCURRENCY)
        const reads = await Promise.all(
          chunk.map(async (file) => {
            try {
              return await api.fsRead(scope, file.path)
            } catch {
              return null // 单个文件失败不影响整批
            }
          }),
        )
        reads.forEach((read, offset) => {
          const index = start + offset
          if (read === null) {
            readFailed++
            return
          }
          if (read.kind === 'text') {
            if (read.size > MAX_BYTES) {
              skippedLarge++
              return
            }
            slots[index] = { relPath: candidates[index].relPath, content: read.content, size: read.size }
            return
          }
          // binary / too-large：宿主判定不可作为文本读取
          skippedBinary++
        })
      }

      const entries = slots.filter((e): e is { relPath: string; content: string; size: number } => e !== null)

      // 超预算策略
      let included: { relPath: string; content: string }[] = entries
      const dropped: string[] = []
      if (budgetMode === 'truncate') {
        // 纯函数：目录树与模板预留 + 贪心填充（详见 pack.ts#applyBudget）
        const plan = applyBudget(entries, tokenBudget)
        included = plan.included
        dropped.push(...plan.dropped)
      }

      // 只有被勾选的抽取结果才进 prompt（未勾选的仍缓存着，可随时再勾上）
      const selectedExtracted = extractedEntries.filter((e) => selected.has(e.relPath))
      // 目录树也把抽取的附件算进去：只打包一个抽取文件时，结构段不至于为空
      const treeText = buildTreeText([...included, ...selectedExtracted])
      // 附件声明：仅在用户勾选时生成；且只取与所选文件同目录的（避免冗余）
      const attachmentPlan = includeAttachments
        ? selectRelevantAttachments(
            [...included.map((f) => f.relPath), ...extractedEntries.map((e) => e.relPath)],
            skippedFiles.map((f) => f.relPath),
            undefined,
            extractedEntries.map((e) => e.relPath), // 已抽取的不再算"未包含"
          )
        : undefined
      const pack = assemblePrompt(treeText, included, undefined, attachmentPlan, selectedExtracted)
      setResult({ ...pack, fileCount: included.length, dropped, overBudget: pack.tokens > tokenBudget })

      // 汇总所有"没进包"的原因，一次说清楚
      const notes: string[] = []
      if (overCap > 0) {
        notes.push(
          `已选 ${picked.length} 个，单次最多读取 ${MAX_READ_FILES} 个，其余 ${overCap} 个未处理` +
            '（其中可能含超大文件；建议缩小勾选范围或分批打包）',
        )
      }
      if (dropped.length > 0) notes.push(`按预算截断掉 ${dropped.length} 个文件`)
      if (skippedLarge > 0) notes.push(`跳过 ${skippedLarge} 个超过 ${Math.round(MAX_BYTES / 1024 / 1024)}MB 的文件`)
      if (skippedBinary > 0) notes.push(`跳过 ${skippedBinary} 个二进制文件（PDF/Office/图片等）`)
      if (readFailed > 0) notes.push(`${readFailed} 个文件读取失败`)
      if (attachmentPlan !== undefined && attachmentPlan.listed.length > 0) {
        notes.push(`prompt 内附 ${attachmentPlan.listed.length} 条同目录附件声明`)
      }
      // 选中的二进制里，既不能读文本、也还没抽取的 → 复制成一个可直接拖拽上传的导出包
      const extractedSet = new Set(Object.keys(extracted))
      const binarySelected = skippedFiles.filter(
        (f) => selected.has(f.relPath) && !extractedSet.has(f.relPath),
      )
      setBundleInfo(null)
      if (binarySelected.length > 0) {
        setBundling(true)
        try {
          const res = await api.bundle(
            cwd,
            binarySelected.map((f) => ({ relPath: f.relPath, absPath: f.path })),
            makeZip,
          )
          if (res.ok && typeof res.dir === 'string') {
            setBundleInfo({
              dir: res.dir,
              zipPath: res.zipPath,
              fileCount: res.fileCount ?? binarySelected.length,
              bytes: res.bytes ?? 0,
              // 明确记录"这一包到底装了什么"，便于用户核对（也便于定位错包问题）
              files: binarySelected.map((f) => f.relPath),
            })
            notes.push(`已把 ${binarySelected.length} 个不可识别文件打包到桌面 dsh-pack 目录`)
          } else {
            notes.push(`导出包失败：${res.message ?? '未知原因'}`)
          }
        } catch (e) {
          notes.push(`导出包失败：${(e as Error).message}`)
        } finally {
          setBundling(false)
        }
      }

      setPackNotice(notes.join('；'))

      if (pack.tokens > tokenBudget) {
        setError(
          budgetMode === 'warn'
            ? `⚠️ 打包后约 ${pack.tokens.toLocaleString()} token，超过预算 ${tokenBudget.toLocaleString()}。请减少文件、调大预算，或把「超预算时」改成按预算截断。`
            : `⚠️ 即使按预算截断后仍约 ${pack.tokens.toLocaleString()} token（目录树与模板本身占用），请调大预算。`,
        )
      }
    } catch (e) {
      setError(`打包失败：${(e as Error).message}`)
      setPhase('select')
    }
  }, [allFiles, selected, scope, tokenBudget, budgetMode, skippedFiles, extractedEntries, includeAttachments])

  // 复制（与打包分开，便于超限时用户调整后重试）
  const doCopy = useCallback(async () => {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result.prompt)
      setPhase('copied')
      setError('')
    } catch (e) {
      setError(`复制失败：${(e as Error).message}，可手动选中文本复制`)
    }
  }, [result])

  /** 回到选择态：顺手清掉上一个动作留下的 toast / 导出包结果，避免"提示残留" */
  const backToSelect = useCallback(() => {
    setPackNotice('')
    setBundleInfo(null)
    setError('')
    setPhase('select')
  }, [])

  // 一键打开 DeepSeek 网页版（新标签页，不受 frame-ancestors CSP 限制）
  const openWebChat = useCallback(() => {
    // 同屏窗口：贴在屏幕右侧、与侧边栏并排，不占用当前标签页；
    // 重复点击只聚焦，不会把已进行的网页版对话刷掉。
    const { window: win, reused } = openSplitWindow('https://chat.deepseek.com/')
    if (win === null) {
      setOpenNotice('浏览器拦截了弹窗：请允许本站弹窗后重试，或手动访问 chat.deepseek.com')
      return
    }
    setOpenNotice(
      reused
        ? '已聚焦右侧网页版窗口（不会打断正在进行的对话）'
        : '已在右侧打开网页版窗口：同屏并排，不占用当前标签页',
    )
  }, [])

  const toggleFile = (relPath: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(relPath)) next.delete(relPath)
      else next.add(relPath)
      return next
    })
  }

  // 目录树（可折叠 · 目录级三态勾选）

  const skippedTotal = useMemo(
    () => Object.values(skippedStats).reduce((sum, n) => sum + n, 0),
    [skippedStats],
  )
  const allDirPaths = useMemo(() => collectDirPaths(tree), [tree])

  const toggleExpand = useCallback((relPath: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(relPath)) next.delete(relPath)
      else next.add(relPath)
      return next
    })
  }, [])
  const expandAll = () => setExpanded(new Set(allDirPaths))
  const collapseAll = () => setExpanded(new Set())

  const selectAll = () =>
    setSelected(new Set([...allFiles.map((f) => f.relPath), ...Object.keys(extracted)]))
  const clearAll = () => setSelected(new Set())
  const selectTextOnly = () =>
    setSelected(new Set(allFiles.filter((f) => extLang(f.relPath) !== 'text').map((f) => f.relPath)))

  // 搜索时退化为扁平结果（常规做法：搜索态不渲染树）
  // 注意：搜索要覆盖「不可识别附件」，否则 t.docx / pic.png 之类永远搜不到
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (q === '') return [] as { relPath: string; binary: boolean }[]
    const hit = (relPath: string): boolean => relPath.toLowerCase().includes(q)
    return [
      ...allFiles.filter((f) => hit(f.relPath)).map((f) => ({ relPath: f.relPath, binary: false })),
      ...skippedFiles.filter((f) => hit(f.relPath)).map((f) => ({ relPath: f.relPath, binary: true })),
    ]
  }, [allFiles, skippedFiles, search])

  const selectedCount = selected.size
  /** 已勾选的「不可识别附件」数量（它们也算进"已选"，但不在文本分母里） */
  const selectedBinaryCount = skippedFiles.filter((f) => selected.has(f.relPath)).length
  const searching = search.trim() !== ''
  const extractedEntryCount = Object.keys(extracted).filter((p) => selected.has(p)).length

  /** 对单个二进制文件按需抽取文本（host 端本地执行） */
  const runExtract = useCallback(
    async (relPath: string) => {
      const absPath = skippedPathMap.get(relPath)
      if (absPath === undefined) return
      setExtractError('')
      setExtracting((prev) => new Set(prev).add(relPath))
      try {
        // 图片走 OCR，PDF/Office 走文本抽取
        const result = isImagePath(relPath)
          ? await api.ocr(cwd, absPath)
          : await api.extract(cwd, absPath)
        if (result.ok && typeof result.text === 'string') {
          // 抽取成功即选中：文件由"灰色不可选"变为"可选"，且可以只打包它自己
          setSelected((prev) => new Set(prev).add(relPath))
          setExtracted((prev) => ({
            ...prev,
            [relPath]: {
              text: result.text as string,
              chars: result.chars ?? result.text!.length,
              truncated: result.truncated === true,
              engine: result.engine ?? '',
            },
          }))
        } else {
          setExtractError(`${relPath}：${result.message ?? '抽取失败'}`)
        }
      } catch (e) {
        setExtractError(`${relPath}：${(e as Error).message}`)
      } finally {
        setExtracting((prev) => {
          const next = new Set(prev)
          next.delete(relPath)
          return next
        })
      }
    },
    [cwd, skippedPathMap],
  )

  const removeExtracted = useCallback((relPath: string) => {
    setExtracted((prev) => {
      const next = { ...prev }
      delete next[relPath]
      return next
    })
    setSelected((prev) => {
      const next = new Set(prev)
      next.delete(relPath)
      return next
    })
  }, [])

  /** 复制未包含附件的绝对路径（粘贴到 Finder 的「前往文件夹」或拖拽上传时用） */
  const copySkippedPaths = useCallback(async () => {
    const text = skippedFiles.map((f) => f.path).join('\n')
    if (text === '') return
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      /* 剪贴板不可用时静默失败，界面已有清单可手动复制 */
    }
  }, [skippedFiles])

  // 渲染一个树节点：目录＝折叠箭头 + 三态勾选 + 已选/总数；文件＝勾选 + 语言标签
  /** 这个文件能否被"变成文本"，以及按钮该显示什么 */
  const convertAction = (
    relPath: string,
  ): { ok: boolean; label: string; title: string } => {
    const kind = extractKindOf(relPath)
    // caps 为 null（还没探测到 / 探测失败）时**乐观显示按钮**：
    // 否则 host 尚未加载新路由时，所有"提取文字"都会凭空消失，用户只会觉得功能坏了。
    const unknown = caps === null

    if (kind === 'pdf') {
      return caps?.pdf === true || unknown
        ? { ok: true, label: '提取文字', title: 'PDF 提取文字（poppler）' }
        : { ok: false, label: '', title: '本机未装 poppler，无法提取 PDF 文字（可改用导出包上传原文件）' }
    }
    if (kind === 'office') {
      return caps?.office === true || unknown
        ? {
            ok: true,
            label: '提取文字',
            title: 'Word / PPT / Excel / RTF 提取文字（内置解析器，三平台通用）',
          }
        : { ok: false, label: '', title: '本机不支持该格式（可改用导出包上传原文件）' }
    }
    if (isImagePath(relPath)) {
      return caps?.ocr != null || unknown
        ? {
            ok: true,
            label: 'OCR 文字',
            title: `图片 OCR${caps?.ocr === undefined ? '' : `（${caps.ocr}）`}：把图里的文字变成纯文本`,
          }
        : { ok: false, label: '', title: '本机没有 OCR 能力（可改用导出包上传原图）' }
    }
    return { ok: false, label: '', title: '该类型无法转文本，请用导出包上传原文件' }
  }

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    const state = selectionOf(node, selected)
    const open = expanded.has(node.relPath)
    return (
      <div key={node.relPath}>
        <div style={{ ...styles.treeRow, paddingLeft: 4 + depth * 14 }}>
          {node.isDir ? (
            <button
              style={styles.caret}
              onClick={() => toggleExpand(node.relPath)}
              title={open ? '折叠' : '展开'}
            >
              {open ? '▾' : '▸'}
            </button>
          ) : (
            <span style={styles.caretSpacer} />
          )}
          <input
            type="checkbox"
            checked={node.isDir ? state === 'all' : selected.has(node.relPath)}
            ref={(el) => {
              if (el !== null) el.indeterminate = node.isDir && state === 'some'
            }}
            onChange={() =>
              node.isDir
                ? setSelected((prev) => toggleNodeSelection(node, prev))
                : toggleFile(node.relPath)
            }
            // 所有文件都可勾选：文本进剪贴板，二进制进导出包（可先抽成文本）
            disabled={node.isDir && node.fileCount === 0}
            style={styles.checkbox}
          />
          <span
            style={
              node.isDir
                ? node.fileCount === 0
                  ? styles.dirNameEmpty
                  : styles.dirName
                : styles.fileName
            }
            onClick={() => {
              if (node.isDir) toggleExpand(node.relPath)
            }}
            title={
              node.binary && extracted[node.relPath] === undefined && !convertAction(node.relPath).ok
                ? `${node.relPath}（${convertAction(node.relPath).title}）`
                : node.relPath
            }
          >
            {node.name}
            {node.isDir ? '/' : ''}
          </span>
          {node.isDir ? (
            node.fileCount === 0 ? (
              <span style={styles.dirMetaEmpty} title="该目录下的文件都是 PDF / 图片 / Office 等二进制">
                不可打包 {node.skipped}
              </span>
            ) : (
              <span
                style={styles.dirMeta}
                title={node.skipped > 0 ? `另有 ${node.skipped} 个文件因类型被跳过` : undefined}
              >
                {countSelected(node, selected)}/{node.fileCount}
              </span>
            )
          ) : node.binary ? (
            extracted[node.relPath] !== undefined ? (
              <span style={styles.binaryActions}>
                <span style={styles.extractedTag}>
                  已抽取 {extracted[node.relPath].chars.toLocaleString()} 字
                  {extracted[node.relPath].truncated ? '（已截断）' : ''}
                </span>
                <button style={styles.btnMini} onClick={() => removeExtracted(node.relPath)}>
                  移除
                </button>
              </span>
            ) : convertAction(node.relPath).ok ? (
              <button
                style={styles.btnMini}
                disabled={extracting.has(node.relPath)}
                onClick={() => void runExtract(node.relPath)}
                title={convertAction(node.relPath).title}
              >
                {extracting.has(node.relPath) ? '处理中…' : convertAction(node.relPath).label}
              </button>
            ) : (
              // 本机不具备该类型的能力：不显示按钮，避免误导（走导出包上传原文件）
              null
            )
          ) : (
            <span style={styles.fileLang}>{extLang(node.relPath)}</span>
          )}
        </div>
        {node.isDir && open && node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    )
  }

  // 导出包卡片：预览与"已复制"两个阶段都要能看到（之前只在已复制阶段渲染，导致预览里找不到入口）
  const bundleCard =
    bundleInfo === null ? null : (
      <div style={styles.bundleBox}>
        <div style={styles.infoTitle}>
          📎 导出包：{bundleInfo.fileCount} 个附件（
          {(bundleInfo.bytes / 1024 / 1024).toFixed(1)} MB）
        </div>
        <div style={styles.hint}>
          这些文件无法转成文本，已复制到<b>桌面</b>的下面目录（里面只有这些不可识别的文件）。
          请把文件<b>拖进网页版输入框</b>一并上传；`附件清单.md` 写明了每个文件该怎么给 AI 看。
        </div>
        <div style={styles.bundleFiles}>
          本次导出：{bundleInfo.files.slice(0, 8).join('、')}
          {bundleInfo.files.length > 8 ? ` 等 ${bundleInfo.files.length} 个` : ''}
        </div>
        <div style={styles.bundlePath} title={bundleInfo.dir}>{bundleInfo.dir}</div>
        {bundleInfo.zipPath !== undefined && (
          <div style={styles.bundlePath} title={bundleInfo.zipPath}>zip：{bundleInfo.zipPath}</div>
        )}
        <div style={styles.row}>
          <button style={styles.btnMini} onClick={() => void api.reveal(cwd, bundleInfo.dir)}>
            在访达中显示
          </button>
          <button
            style={styles.btnMini}
            onClick={() => void navigator.clipboard.writeText(bundleInfo.dir)}
          >
            复制目录路径
          </button>
        </div>
      </div>
    )

  // ---- 渲染 ----
  return (
    <div style={styles.root}>
      <div style={styles.headerRow}>
        <div style={styles.header}>⇄ 分流对话</div>
        <span style={styles.badgeVersion}>{BUILD_VERSION}</span>
      </div>

      {/* 使用规则：置顶说明「打包 = 提取文本到剪贴板 → 再呼出网页版」 */}
      <div style={styles.rulesBox}>
        <div style={styles.rulesTitle}>使用规则</div>
        <ol style={styles.rulesList}>
          <li>
            勾选文件/目录 →「📦 打包选中文件」= 把<b>可读文本</b>提取到剪贴板（纯本地，不上传）
          </li>
          <li>
            Word/PPT/Excel/RTF/PDF 点<b>「提取文字」</b>、图片点<b>「OCR 文字」</b>，
            提取结果也会进剪贴板
          </li>
          <li>
            「🚀 同屏打开网页版」→ 在网页版输入框 <b>Cmd/Ctrl+V</b> 粘贴并提问（免费）
          </li>
          <li>
            无法识别的文件（视频/压缩包等）自动打包到<b>桌面 dsh-pack-时间戳/</b>，
            里面只有这些不可识别的文件 + 说明清单，拖进网页版上传即可
          </li>
          <li>需要改代码 / 复杂推理时，回 Harness 走 API（计费）</li>
        </ol>
      </div>

      {hostBuild !== null && hostBuild !== BUILD_VERSION && (
        <div style={styles.notice}>
          ⚠️ host 端为 v{hostBuild}、界面为 v{BUILD_VERSION}：两者不一致说明
          <b> dsh web 没有重启</b>，会出现旧的导出路径等错位行为。请重启 dsh web 后再测。
        </div>
      )}
      {error && <div style={styles.error}>{error}</div>}
      {scanNotice !== '' && <div style={styles.notice}>{scanNotice}</div>}
      {packNotice !== '' && <div style={styles.notice}>{packNotice}</div>}
      {extractError !== '' && <div style={styles.error}>{extractError}</div>}

      {/* 工作区信息 */}
      <div style={styles.infoBox}>
        <div><b>工作区：</b>{cwd || '读取中…'}</div>
      </div>

      {phase === 'loading' && (
        <div style={styles.status}>⏳ 正在加载工作区…</div>
      )}
      {phase === 'scanning' && (
        <div style={styles.status}>
          🔍 正在扫描项目文件…
          {scanProgress && (
            <span style={styles.progressText}>已扫 {scanProgress.dirs} 个目录 · 发现 {scanProgress.files} 个文件</span>
          )}
          {/* 逃生口：扫描若因宿主异常迟迟不结束，用户永远有办法重来 */}
          <div style={{ marginTop: 6 }}>
            <button style={styles.btn} onClick={() => scan()}>↻ 重新开始扫描</button>
          </div>
        </div>
      )}

      {phase !== 'loading' && phase !== 'scanning' && (
        <div style={styles.controls}>
          <div style={styles.row}>
            <button style={styles.btn} onClick={() => scan()}>↻ 重新扫描</button>
            <button style={styles.btn} onClick={selectAll} disabled={allFiles.length === 0}>全选</button>
            <button style={styles.btn} onClick={selectTextOnly} disabled={allFiles.length === 0}>仅代码</button>
            <button style={styles.btn} onClick={clearAll} disabled={allFiles.length === 0}>全不选</button>
          </div>
          <div style={styles.row}>
            <label style={styles.label}>token 预算：
              <input
                type="number"
                value={tokenBudget}
                min={1000}
                max={100000}
                step={1000}
                onChange={(e) => setTokenBudget(Number(e.target.value) || 8000)}
                style={styles.input}
              />
            </label>
            <label style={styles.label}>扫描上限：
              <select
                value={fileCap}
                onChange={(e) => {
                  const next = Number(e.target.value)
                  setFileCap(next)
                  // 立即用新上限重扫（闭包里的 fileCap 还是旧值，所以显式传入）
                  void scan(undefined, next)
                }}
                style={styles.select}
              >
                {FILE_CAP_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n === 0 ? '不限（较慢）' : `${n} 个文件`}
                  </option>
                ))}
              </select>
            </label>
            <label style={styles.label}>超预算时：
              <select
                value={budgetMode}
                onChange={(e) => setBudgetMode(e.target.value as BudgetMode)}
                style={styles.select}
              >
                <option value="warn">只提示</option>
                <option value="truncate">按预算截断</option>
              </select>
            </label>
            <label
              style={styles.label}
              title="勾选后，prompt 里会说明同目录下有哪些 PDF/Office 等附件未包含；默认关闭以保持 prompt 干净"
            >
              <input
                type="checkbox"
                style={styles.checkbox}
                checked={includeAttachments}
                onChange={(e) => setIncludeAttachments(e.target.checked)}
              />
              含附件声明
            </label>
            <label style={styles.label} title="选中二进制文件时会生成导出目录；勾选此项再打一个 zip（仅便于传输）">
              <input
                type="checkbox"
                style={styles.checkbox}
                checked={makeZip}
                onChange={(e) => setMakeZip(e.target.checked)}
              />
              导出 zip
            </label>
            <span style={styles.count}>
              已选 {selectedCount} / {allFiles.length} 文本
              {selectedBinaryCount > 0 && ` · ${selectedBinaryCount} 个附件`}
            </span>
          </div>
          <div style={styles.row}>
            <button
              style={styles.btnPrimary}
              onClick={packAndCopy}
              disabled={selectedCount === 0}
            >
              📦 打包选中文件
            </button>
          </div>
          {allFiles.length > 0 && selectedCount === 0 && (
            <div style={styles.hint}>
              默认未选中任何文件：在下方展开目录后勾选（勾目录＝选中整棵子树），或点「全选」「仅代码」。
            </div>
          )}
          {allFiles.length > 0 && (
            <input
              type="text"
              placeholder="🔎 搜索文件…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={styles.search}
            />
          )}
        </div>
      )}

      {/* 文件树：目录可折叠，勾选目录＝选中整棵子树 */}
      {phase === 'select' && !searching && (
        <div style={styles.fileList}>
          {allFiles.length === 0 && (
            <div style={styles.status}>未找到可打包的文件（已按排除规则过滤）</div>
          )}
          {allFiles.length > 0 && (
            <div style={styles.treeHead}>
              <span style={styles.treeMeta}>
                {allFiles.length} 个可打包文件 · {allDirPaths.length} 个目录（默认折叠）
                {skippedTotal > 0 && ` · 跳过 ${skippedTotal} 个非文本文件`}
              </span>
              <span style={styles.treeActions}>
                <button style={styles.btnMini} onClick={expandAll}>展开全部</button>
                <button style={styles.btnMini} onClick={collapseAll}>折叠全部</button>
              </span>
            </div>
          )}
          {tree.map((node) => renderNode(node, 0))}
        </div>
      )}

      {/* 搜索态：退化为扁平结果，不渲染树 */}
      {phase === 'select' && searching && (
        <div style={styles.fileList}>
          {searchResults.length === 0 && (
            <div style={styles.status}>没有匹配 "{search}" 的文件或附件</div>
          )}
          {searchResults.map((f) => (
            <label key={f.relPath} style={styles.fileRow}>
              <input
                type="checkbox"
                checked={selected.has(f.relPath)}
                onChange={() => toggleFile(f.relPath)}
              />
              <span style={styles.fileName}>{f.relPath}</span>
              <span style={styles.fileLang}>
                {f.binary ? '附件' : extLang(f.relPath)}
              </span>
            </label>
          ))}
        </div>
      )}

      {/* 未包含的附件：PDF/Office/图片 → 引导直接上传网页版 */}
      {phase === 'select' && skippedFiles.length > 0 && (
        <div style={styles.attachBox}>
          <div style={styles.attachHead}>
            <span style={styles.infoTitle}>📎 未包含的附件：{skippedTotal} 个</span>
            <button style={styles.btnMini} onClick={copySkippedPaths}>
              复制全部路径
            </button>
          </div>
          <div style={styles.hint}>
            {includeAttachments
              ? '已勾选「含附件声明」：打包时会把同目录下的附件列进 prompt。'
              : '未写入 prompt（如需让模型知道这些附件，请在上方勾选「含附件声明」）。'}
            <br />
            PDF / Office / 图片无法作为文本打包。需要模型读它们时，
            <b>直接把文件拖进 DeepSeek 网页版输入框</b>——原生解析比抽文本更准
            （公式、表格、排版都能保留）。
          </div>
          <div style={styles.attachList}>
            {skippedFiles.slice(0, 12).map((f) => (
              <div key={f.relPath} style={styles.attachItem} title={f.path}>
                {f.relPath}
              </div>
            ))}
            {skippedFiles.length > 12 && (
              <div style={styles.attachItem}>…另有 {skippedFiles.length - 12} 个（点「复制全部路径」获取）</div>
            )}
          </div>
        </div>
      )}

      {/* 预览 / 已复制 */}
      {phase === 'preview' && result && (
        <div style={styles.previewBox}>
          <div style={styles.previewTitle}>
            打包预览：{result.fileCount} 个文件
            {extractedEntryCount > 0 && ` + ${extractedEntryCount} 个抽取附件`} · 约{' '}
            <b>{result.tokens.toLocaleString()}</b> token
            {result.overBudget && <span style={styles.warn}>（超预算）</span>}
          </div>
          <pre style={styles.previewText}>
            {result.prompt.slice(0, 600)}{result.prompt.length > 600 ? '\n…（已截断预览）' : ''}
          </pre>
          {result.dropped.length > 0 && (
            <div style={styles.hint}>
              未包含（按预算截断）：{result.dropped.slice(0, 8).join('、')}
              {result.dropped.length > 8 ? ` 等 ${result.dropped.length} 个` : ''}
            </div>
          )}
          {bundleCard}
          <div style={styles.row}>
            <button style={styles.btnPrimary} onClick={doCopy}>📋 复制到剪贴板</button>
            <button style={styles.btn} onClick={backToSelect}>← 返回调整</button>
          </div>
        </div>
      )}

      {phase === 'copied' && result && (
        <div style={styles.copiedBox}>
          <div style={styles.copiedTitle}>✅ 已复制到剪贴板（{result.tokens.toLocaleString()} token，{result.fileCount} 个文件）</div>
          <ol style={styles.steps}>
            <li>点下方按钮<b>同屏打开网页版</b>（右侧并排窗口，不占用当前标签页）</li>
            <li>在网页版输入框 <b>Cmd/Ctrl + V</b> 粘贴</li>
            <li>输入你的问题，使用<b>免费</b>对话完成项目阅读/答疑</li>
            <li>如需复杂推理 / 改代码，回到 Harness 走 API（计费）</li>
          </ol>
          <div style={styles.row}>
            <button style={styles.btnPrimary} onClick={openWebChat}>🚀 同屏打开网页版</button>
          </div>
          {openNotice !== '' && <div style={styles.notice}>{openNotice}</div>}
          {bundling && <div style={styles.hint}>📦 正在生成导出包…</div>}
          {bundleCard}
          <div style={styles.row}>
            <button style={styles.btn} onClick={backToSelect}>← 返回选择</button>
            <button style={styles.btn} onClick={doCopy}>↻ 重新复制</button>
          </div>
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  // 统一使用 DSH 设计令牌：--dsw-alias-label-* 在深色主题取近白、浅色主题取近黑，
  // 因此文字在两种主题下都是「最高对比度」，不会再出现灰蒙蒙看不清的情况。
  root: {
    display: 'flex', flexDirection: 'column', gap: 8,
    padding: 12, fontFamily: '-apple-system, "PingFang SC", sans-serif',
    fontSize: 13, color: 'var(--dsw-alias-label-primary)', boxSizing: 'border-box',
    height: '100%', overflowY: 'auto',
  },
  headerRow: { flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 },
  header: { fontSize: 15, fontWeight: 700, color: 'var(--dsw-alias-label-primary)' },
  rulesBox: {
    flexShrink: 0,
    background: 'var(--dsw-alias-interactive-bg-hover)',
    border: '1px solid var(--dsw-alias-border-l1)',
    borderRadius: 6, padding: '6px 8px',
  },
  rulesTitle: {
    fontSize: 11, fontWeight: 700, marginBottom: 4,
    color: 'var(--dsw-alias-label-primary)',
  },
  rulesList: {
    margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 3,
    fontSize: 11, lineHeight: '16px', color: 'var(--dsw-alias-label-secondary)',
  },
  badgeVersion: {
    fontSize: 10, background: 'var(--dsw-alias-interactive-bg-hover)',
    color: 'var(--dsw-alias-label-secondary)', padding: '2px 6px', borderRadius: 4,
    fontFamily: 'var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)',
  },
  error: { flexShrink: 0, background: '#7f1d1d', color: '#fecaca', padding: 8, borderRadius: 6, fontSize: 12 },
  warn: { color: 'var(--dsw-alias-state-warn-primary)', fontSize: 11, marginLeft: 4, fontWeight: 600 },
  infoBox: {
    flexShrink: 0,
    background: 'var(--dsw-alias-interactive-bg-hover)', padding: 8, borderRadius: 6,
    fontSize: 12, wordBreak: 'break-all', color: 'var(--dsw-alias-label-primary)',
  },
  status: { flexShrink: 0, color: 'var(--dsw-alias-label-secondary)', padding: 8, fontSize: 12 },
  progressText: {
    display: 'block', color: 'var(--dsw-alias-state-business-primary)',
    marginTop: 4, fontSize: 11,
  },
  controls: { flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 },
  row: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' },
  btn: {
    background: 'var(--dsw-alias-interactive-bg-hover)',
    color: 'var(--dsw-alias-label-primary)',
    border: '1px solid var(--dsw-alias-border-l2)',
    borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer',
  },
  btnPrimary: {
    background: 'var(--dsw-alias-state-business-primary)', color: '#fff', border: 'none',
    borderRadius: 6, padding: '6px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 600,
  },
  label: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--dsw-alias-label-primary)' },
  input: {
    width: 80, background: 'var(--dsw-alias-bg-layer-1)',
    color: 'var(--dsw-alias-label-primary)',
    border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 4, padding: '2px 4px',
  },
  search: {
    background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)',
    border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 6,
    padding: '5px 8px', fontSize: 12, width: '100%', boxSizing: 'border-box',
  },
  count: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
  select: {
    background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)',
    border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 4,
    padding: '2px 4px', fontSize: 12,
  },
  notice: {
    flexShrink: 0,
    fontSize: 11, color: 'var(--dsw-alias-state-warn-primary)', lineHeight: 1.5,
    background: 'var(--dsw-alias-interactive-bg-hover)', padding: 6, borderRadius: 4,
    border: '1px solid var(--dsw-alias-border-l1)',
  },
  fileList: {
    flexShrink: 0,
    display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 260,
    overflowY: 'auto', border: '1px solid var(--dsw-alias-border-l2)',
    borderRadius: 6, padding: 4,
  },
  fileRow: {
    flexShrink: 0,
    display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, cursor: 'pointer',
    color: 'var(--dsw-alias-label-primary)',
  },
  treeHead: {
    flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
    padding: '2px 2px 6px', borderBottom: '1px solid var(--dsw-alias-border-l1)',
    marginBottom: 2,
  },
  treeMeta: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' },
  treeActions: { display: 'flex', gap: 4 },
  btnMini: {
    background: 'var(--dsw-alias-interactive-bg-hover)',
    color: 'var(--dsw-alias-label-secondary)',
    border: '1px solid var(--dsw-alias-border-l1)',
    borderRadius: 4, padding: '2px 6px', fontSize: 10, cursor: 'pointer',
  },
  treeRow: { flexShrink: 0, display: 'flex', gap: 4, alignItems: 'center', fontSize: 12, lineHeight: '18px' },
  caret: {
    background: 'transparent', border: 'none',
    color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer',
    fontSize: 11, width: 14, padding: 0,
  },
  caretSpacer: { width: 14, display: 'inline-block' },
  checkbox: { margin: 0, flex: '0 0 auto', accentColor: 'var(--dsw-alias-state-business-primary)' },
  dirName: {
    flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    cursor: 'pointer', color: 'var(--dsw-alias-label-primary)', fontWeight: 600,
  },
  dirMeta: {
    color: 'var(--dsw-alias-label-secondary)', fontSize: 10, minWidth: 40,
    textAlign: 'right', fontVariantNumeric: 'tabular-nums',
  },
  dirNameEmpty: {
    flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    cursor: 'pointer', color: 'var(--dsw-alias-label-tertiary)', fontWeight: 400,
  },
  dirMetaEmpty: {
    color: 'var(--dsw-alias-label-tertiary)', fontSize: 10, textAlign: 'right',
  },
  hint: {
    flexShrink: 0,
    fontSize: 11, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.5,
    background: 'var(--dsw-alias-interactive-bg-hover)', padding: 6, borderRadius: 4,
  },
  fileName: {
    flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    color: 'var(--dsw-alias-label-primary)', fontWeight: 500,
  },
  fileLang: {
    color: 'var(--dsw-alias-label-tertiary)', fontSize: 11, minWidth: 40, textAlign: 'right',
  },
  previewBox: {
    flexShrink: 0,
    display: 'flex', flexDirection: 'column', gap: 8, padding: 8,
    background: 'var(--dsw-alias-interactive-bg-hover)', borderRadius: 6,
    color: 'var(--dsw-alias-label-primary)',
  },
  previewTitle: { fontSize: 12, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
  previewText: {
    flexShrink: 0,
    background: 'var(--dsw-alias-bg-layer-1)', padding: 8, borderRadius: 4, fontSize: 11,
    maxHeight: 180, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
    margin: 0, color: 'var(--dsw-alias-label-primary)',
    fontFamily: 'var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)',
  },
  bundleBox: {
    flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6, padding: 8,
    borderRadius: 6, background: 'var(--dsw-alias-interactive-bg-hover)',
    border: '1px solid var(--dsw-alias-border-l1)',
  },
  bundleFiles: {
    fontSize: 11, lineHeight: '16px', color: 'var(--dsw-alias-label-secondary)',
  },
  bundlePath: {
    fontSize: 10, lineHeight: '15px', color: 'var(--dsw-alias-label-secondary)',
    fontFamily: 'var(--ds-font-family-code, ui-monospace, monospace)',
    wordBreak: 'break-all',
  },
  binaryActions: { display: 'flex', alignItems: 'center', gap: 4 },
  extractedTag: { fontSize: 10, color: 'var(--dsw-alias-state-success-primary)' },
  attachBox: {
    flexShrink: 0,
    display: 'flex', flexDirection: 'column', gap: 6, padding: 8, borderRadius: 6,
    background: 'var(--dsw-alias-interactive-bg-hover)',
    border: '1px solid var(--dsw-alias-border-l1)',
  },
  attachHead: { flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  attachList: {
    flexShrink: 0,
    display: 'flex', flexDirection: 'column', gap: 3,
    maxHeight: 160, overflowY: 'auto', paddingRight: 4,
  },
  attachItem: {
    flexShrink: 0,
    fontSize: 11, lineHeight: '16px',
    color: 'var(--dsw-alias-label-secondary)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  // 完成态：不再整块填充深绿（深底浅字观感差），改为细边框 + 主题文字色
  copiedBox: {
    flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8, padding: 10,
    background: 'transparent',
    border: '1px solid var(--dsw-alias-state-success-primary)',
    borderLeft: '3px solid var(--dsw-alias-state-success-primary)',
    borderRadius: 6,
  },
  copiedTitle: {
    fontSize: 13, fontWeight: 700,
    color: 'var(--dsw-alias-state-success-primary)',
  },
  steps: { flexShrink: 0, margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--dsw-alias-label-primary)', display: 'flex', flexDirection: 'column', gap: 4 },
}
