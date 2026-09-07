import { ref, computed, onMounted, nextTick, onUnmounted, reactive, watch } from 'vue'
import { receive, send } from '@koishijs/client'
import { useChatData } from './composables/useChatData'
import { useChatActions } from './composables/useChatActions'
import { useImageCache } from './composables/useImageCache'
import { useVideoCache } from './composables/useVideoCache'
import { ElMessage } from 'element-plus'

export function useChatLogic() {
  const {
    bots, pinnedBots, pinnedChannels, getChannels, getMessages, pluginConfig,
    loadInitialData, loadConfig, addMessage, removeMessage, loadHistory, getPagination, allChannels,
    refreshBotState
  } = useChatData()

  const {
    isSending, sendMessage, uploadFile, recallMessage, deleteBotData, deleteChannelData,
    togglePinBot, togglePinChannel
  } = useChatActions()

  const { getCachedImageUrl, cacheImage } = useImageCache()
  const { loadVideo, isVideoLoading, isVideoLoaded } = useVideoCache()

  // 状态管理
  const menu = ref({ show: false, x: 0, y: 0, type: '', id: '', botId: '', isPinned: false, hasMedia: false, targetRole: '' })
  const selectedBot = ref('')
  const selectedChannel = ref('')
  const inputText = ref('')
  const uploadedImages = ref<any[]>([])
  const uploadedFiles = ref<any[]>([])
  const scrollRef = ref<any>(null)
  const inputRef = ref<any>(null)
  const isMobile = ref(false)
  const mobileView = ref<'channels' | 'messages' | 'forward' | 'image' | 'profile' | 'raw'>('channels')
  const isLoadingHistory = ref(false)
  const keyboardHeight = ref(0) // 键盘高度

  // 合并转发详情状态
  const forwardData = reactive({
    messages: [] as any[]
  })
  const forwardDialogVisible = ref(false)

  // 图片查看器状态
  const imageViewer = reactive({
    url: ''
  })
  const imageViewerVisible = ref(false)
  const imageZoom = ref(1)

  // 原始消息查看状态
  const rawMessage = reactive({
    content: ''
  })
  const rawMessageVisible = ref(false)

  // 引用/回复状态
  const replyingTo = ref<any>(null)

  // 用户资料状态
  const userProfile = reactive({
    data: null as any
  })
  const userProfileVisible = ref(false)

  // ===== QQ表情相关 =====

  // 表情静态资源基址（公网可访问，无需本地 qq_emoji 目录；json 与图片同在网络上）
  const QQ_EMOJI_BASE = 'https://koishi.js.org/QFace/assets/qq_emoji'

  // 获取 QQ 表情图片 URL：统一使用网络 apng 动图
  // （png 不会动；个别无 apng 的表情由 data-fb 自动回退 png）
  const getQQEmojiUrl = (faceId: string, faceType?: string) => {
    const id = String(faceId || '').replace(/\D+/g, '')
    if (!id) return ''
    return `${QQ_EMOJI_BASE}/${id}/apng/${id}.png`
  }

  // 生成表情 <img>（apng 主图 / png 兜底；加载失败自动互换，仍失败则隐藏）
  const buildEmojiImg = (faceId: string, faceType: string) => {
    const id = String(faceId || '').replace(/\D+/g, '')
    if (!id) return ''
    const type = String(faceType || '1') === '3' ? '3' : '1'
    const primary = getQQEmojiUrl(id, type) // apng
    const fallback = `${QQ_EMOJI_BASE}/${id}/png/${id}.png`
    const cls = type === '3' ? 'qq-emoji qq-emoji-large' : 'qq-emoji'
    return `<img src="${primary}" alt="[face:${id}]" data-face-id="${id}" data-face-type="${type}" class="${cls}" data-fb="${fallback}" onerror="this.onerror=null;var f=this.dataset.fb;if(f){this.removeAttribute('data-fb');this.src=f}else{this.style.display='none'}" />`
  }

  // 从消息的 elements 中提取 QQ 表情信息（faceType=3）
  const extractQQEmoji = (elements: any[]) => {
    if (!elements || !Array.isArray(elements)) return []

    return elements
      .map((el: any) => ({
        faceId: String(el.attrs?.faceId ?? el.attrs?.id ?? el.faceId ?? el.id ?? ''),
        faceType: String(el.attrs?.faceType ?? el.faceType ?? '')
      }))
      .filter((item: any) => item.faceType === '3' && !!item.faceId)
  }

  // HTML 实体反转义（QQ 文本/历史消息里可能出现 &lt; &quot; 等转义形式）
  const decodeHtmlEntities = (s: string) => String(s)
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&')

  // 渲染消息文本里的 QQ 表情占位符，返回可直接放入 v-html 的 HTML
  // 仅 faceType=1 / faceType=3 渲染本地 apng 图片；
  // 其余类型（2/4 等）统一显示“不支持的第三方表情”
  // 兼容格式：<faceType=3,faceId="479",ext="..."> / <faceType=3> / [face:n]
  const renderQQFaceContent = (content: string, msg?: any) => {
    if (!content) return ''
    // 先做一次实体反转义，兼容历史消息里被转义过的 <faceType=…> 标签
    let result = decodeHtmlEntities(String(content))
    const emojis = (msg && Array.isArray(msg.elements)) ? extractQQEmoji(msg.elements) : []
    let emojiIndex = 0

    // 顺序很重要：必须先处理旧格式 [face:n]（视为 faceType=1），
    // 再处理 <faceType=…>。否则 [face:n] 正则会把上一步刚生成的
    // <img alt="[face:479]" …/> 里的 alt 文本再次替换成 img，造成嵌套脏数据。
    result = result.replace(/\[face:(\d+)\]/gi, (match: string, id: string) => buildEmojiImg(id, '1'))

    result = result.replace(/<faceType\s*=\s*(\d+)\b([^>]*?)\s*\/?>/gi, (raw: string, type: string, attrs: string) => {
      const faceType = String(type || '')
      if (faceType === '4') {
        // 第三方表情：尝试从 ext（base64 的 {"text":"[名称]"}）解析名称
        const attrBody = String(attrs || '')
        const extMatch = /ext\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrBody)
        let name = ''
        if (extMatch) {
          try {
            const raw = decodeHtmlEntities(extMatch[1] || extMatch[2] || '')
            const bytes = Uint8Array.from(atob(raw), (c: string) => c.charCodeAt(0))
            const json = JSON.parse(new TextDecoder('utf-8').decode(bytes))
            name = String(json?.text || '').trim()
            name = name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          } catch { /* 解析失败则不带名称 */ }
        }
        return name ? `第三方表情${name}，不支持查看图片` : '第三方表情，不支持查看图片'
      }
      if (faceType !== '1' && faceType !== '3') {
        // faceType=6 等系统/其它特殊表情：静默移除，不显示“不支持”
        if (faceType === '6') return ''
        // 其余未知类型：显示提示
        return '不支持的第三方表情'
      }
      const attrBody = String(attrs || '')
      let faceId = ''
      const match = /faceId\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrBody)
      if (match) faceId = match[1] || match[2] || ''
      if (!faceId && emojis[emojiIndex]) faceId = String(emojis[emojiIndex].faceId || '')
      emojiIndex++
      if (!faceId) return ''
      return buildEmojiImg(faceId, faceType)
    })

    // QQ 内容里直连的远程图片（qq CDN 等）显示不了：
    // 改写为本地下载代理 /qq-chat/fetch-image?u=...，由服务端下载缓存到 data/qq-chat 后走本地 ./media
    result = result.replace(/<img\b([^>]*)>/gi, (raw: string, attrs: string) => {
      const srcMatch = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs || '')
      const src = srcMatch ? (srcMatch[1] || srcMatch[2] || '') : ''
      // 公网表情域名（koishi.js.org/QFace）可直接显示，不走本地代理
      if (/^https?:\/\//i.test(src) && !/koishi\.js\.org\/QFace\//i.test(src)) {
        const proxied = `/qq-chat/fetch-image?u=${encodeURIComponent(src)}`
        const newAttrs = (attrs || '').replace(
          /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i,
          `src="${proxied}"`
        )
        return `<img${newAttrs} data-orig="${String(src).replace(/"/g, '&quot;')}" onerror="var o=this.dataset.orig;if(o&&this.src!==o){this.onerror=null;this.src=o}else{this.style.display='none'}" />`
      }
      return raw
    })

    // 序列化的 <audio/> <video/> <file/> 元素（如 bot 发送语音/文件后 echo 回的内容）：
    // v-html 无法直接给 audio/video 加播放控件，这里统一补成可交互的播放器/下载链接
    result = result.replace(/<audio\b([^>]*)>/gi, (raw: string, attrs: string) => {
      const srcMatch = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs || '')
      const src = srcMatch ? (srcMatch[1] || srcMatch[2] || '') : ''
      if (src) {
        // QQ 远程音频（silk / 需鉴权链接）浏览器播不了：加“转码播放”按钮，服务端转成本地 mp3
        const remote = /^https?:\/\//i.test(src) && !/127\.0\.0\.1|localhost/i.test(src)
        const audio = `<audio src="${src}" controls preload="metadata" class="qq-chat-audio" data-src="${String(src).replace(/"/g, '&quot;')}"></audio>`
        if (!remote) return audio
        return `<span class="qq-chat-audio-wrap">${audio}<button type="button" class="qq-chat-audio-tool" onclick="window.__qqChatTranscodeAudio&&window.__qqChatTranscodeAudio(this)">转码播放</button></span>`
      }
      return raw
    })
    result = result.replace(/<video\b([^>]*)>/gi, (raw: string, attrs: string) => {
      const srcMatch = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs || '')
      const src = srcMatch ? (srcMatch[1] || srcMatch[2] || '') : ''
      if (src) return `<video src="${src}" controls preload="metadata" class="qq-chat-video"></video>`
      return raw
    })
    result = result.replace(/<file\b([^>]*)>/gi, (raw: string, attrs: string) => {
      const srcMatch = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs || '')
      const nameMatch = /\bfilename\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs || '')
      const src = srcMatch ? (srcMatch[1] || srcMatch[2] || '') : ''
      const name = nameMatch ? (nameMatch[1] || nameMatch[2] || '') : '文件'
      if (src) {
        return `<a class="chat-file-link" href="${src}" download="${String(name).replace(/"/g, '&quot;')}">📎 ${name}</a>`
      }
      return raw
    })

    return result
  }

  // 解析消息内容，将 QQ 表情标签转换为图片 / 提示文本
  const parseMessageContent = (msg: any) => {
    if (!msg) return ''
    const content = msg.content
    if (typeof content !== 'string') return ''
    return renderQQFaceContent(content, msg)
  }

  // 剔除输入框 / 转发文本里的 QQ 表情标签与残留 HTML 图片标签
  // （避免占位标签 / <img> 片段被当普通文本发出去后被 QQ 截断产生乱码尾巴）
  const stripFaceText = (text: string) => {
    if (!text) return ''
    return String(text)
      .replace(/<img\b[^>]*>/gi, '')
      .replace(/<faceType\s*=\s*\d+\b[^>]*>/gi, '')
      .replace(/\[face:\d+\]/gi, '')
  }

  // ===== 发送 QQ 表情 =====

  // 经典原生小表情列表（normal_emojiids，faceType=1）
  const nativeEmojiIds = ref<string[]>([])
  // 大表情（faceType=3 动图）：直接从 _index.json 推导（含 479 等最新大表情）
  const superEmojiIds = ref<string[]>([])

  const filterDigitIds = (arr: any[]) => (arr || [])
    .map((id: any) => String(id))
    .filter((id: string) => /^\d+$/.test(id))

  const loadEmojiIdFile = async (filename: string, target: typeof nativeEmojiIds) => {
    try {
      const res = await fetch(`${QQ_EMOJI_BASE}/${filename}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      target.value = filterDigitIds(data?.emojiids)
    } catch (e) {
      console.error(`加载 QQ 表情列表失败(${filename}):`, e)
    }
  }
  void loadEmojiIdFile('normal_emojiids.json', nativeEmojiIds)

  // 大表情 = _index.json 里带 lottie 动画（assets 含 type:3）的条目
  const loadSuperEmojiIds = async () => {
    try {
      const res = await fetch(`${QQ_EMOJI_BASE}/_index.json`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const list = await res.json()
      const ids: string[] = []
      for (const item of list || []) {
        const id = String(item?.emojiId || '')
        if (!/^\d+$/.test(id)) continue
        if (item?.isHide === true) continue
        const assets: any[] = item?.assets || []
        if (assets.some((a: any) => String(a?.type) === '3')) ids.push(id)
      }
      superEmojiIds.value = ids
    } catch (e) {
      console.error('加载 QQ 大表情列表失败(_index.json):', e)
    }
  }
  void loadSuperEmojiIds()

  // 点击表情：直接把本地 qq_emoji apng 素材当图片发送（faceType=1 经典 / 3 大表情）
  const sendNativeEmoji = async (faceId: string, faceType?: string) => {
    if (!selectedBot.value || !selectedChannel.value) return
    if (inputDisabled.value) {
      ElMessage.warning(inputDisabledHint.value || '当前无法发送消息')
      return
    }
    const id = String(faceId || '').replace(/\D+/g, '')
    if (!id) return
    const type = String(faceType || '1') === '3' ? '3' : '1'
    const res = await (send as any)('send-qq-emoji', {
      selfId: selectedBot.value,
      channelId: selectedChannel.value,
      faceId: id,
      faceType: type
    })
    if (res?.warning) {
      ElMessage.warning(res.warning)
    }
    if (!res?.success) {
      ElMessage.error(res?.error || '表情发送失败')
      return
    }
    setTimeout(() => scrollToBottom(), 400)
  }

  // ===== 手机通知样式的顶部弹窗通知 =====
  const notifications = ref<any[]>([])

  const notificationPreview = (ev: any) => {
    let text = String(ev.content || '').trim()
    if (/^\[卡片消息\]/.test(text)) return '[卡片消息]'
    if (ev.elements?.some((el: any) => ['image', 'img', 'mface', 'face'].includes(el.type))) return '[图片]'
    // 纯 QQ 表情消息：预览成 [表情]
    if (text.replace(/<faceType\s*=\s*\d+\b[^>]*>/gi, '').replace(/\[face:\d+\]/gi, '').trim() === '') return '[表情]'
    return text
      .replace(/<faceType\s*=\s*\d+\b[^>]*>/gi, '[表情]')
      .replace(/\[face:\d+\]/gi, '[表情]')
      .replace(/\s+/g, ' ')
      .slice(0, 60)
  }

  const pushNotification = (ev: any) => {
    if (!ev || !ev.selfId || !ev.channelId) return
    // 当前正在查看的频道不弹通知
    if (ev.selfId === selectedBot.value && ev.channelId === selectedChannel.value) return
    const channels = getChannels(ev.selfId)
    const channelName = channels.find((c: any) => c.id === ev.channelId)?.name || ev.channelId
    const n = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      selfId: ev.selfId,
      channelId: ev.channelId,
      channelName,
      username: ev.username || ev.bot?.name || '未知用户',
      avatar: ev.avatar || ev.bot?.avatar || '',
      content: notificationPreview(ev),
      elements: ev.elements || [],
      ts: Date.now()
    }
    notifications.value.push(n)
    // 最多同时显示 3 条，超出移除最早的
    if (notifications.value.length > 3) notifications.value.shift()
    // 5 秒后自动消失
    setTimeout(() => {
      notifications.value = notifications.value.filter(x => x.id !== n.id)
    }, 5000)
  }

  const dismissNotification = (id: string) => {
    notifications.value = notifications.value.filter(x => x.id !== id)
  }

  const gotoNotification = (n: any) => {
    selectChannel(n.channelId, n.selfId)
    dismissNotification(n.id)
  }

  // 计算属性
  const currentChannels = allChannels
  const currentMessages = computed(() => getMessages(selectedBot.value, selectedChannel.value))
  const currentChannelName = computed(() => {
    const c = currentChannels.value.find(i => i.id === selectedChannel.value && i.selfId === selectedBot.value)
    return c ? c.name : ''
  })

  // 输入框是否禁用：私聊不禁用；群聊中仅当机器人不在群 / 群处于全员禁言（全体禁言）时禁用。
  // 没开全体禁言不禁止发言，与机器人是否管理员/群主无关。
  const inputDisabled = computed(() => {
    const info = currentChannels.value.find(c => c.id === selectedChannel.value && c.selfId === selectedBot.value)
    if (!info || info.isDirect) return false
    const bs = info.botState
    if (!bs) return false
    if (bs.inGroup === false) return true
    if (bs.globalMuted) return true
    return false
  })

  const inputDisabledHint = computed(() => {
    const info = currentChannels.value.find(c => c.id === selectedChannel.value && c.selfId === selectedBot.value)
    if (!info || info.isDirect) return ''
    const bs = info.botState
    if (!bs) return ''
    if (bs.inGroup === false) return '机器人已不在该群，无法发送消息'
    if (bs.globalMuted) return '全体禁言中，无法发送消息'
    return ''
  })
  const botName = (selfId: string) => bots.value.find(b => b.selfId === selfId)?.username || `Bot-${selfId}`
  const selectedBotPlatform = computed(() => {
    const bot = bots.value.find(b => b.selfId === selectedBot.value)
    return bot?.platform || 'unknown'
  })

  // 未读消息计数
  const unreadCounts = reactive<Record<string, number>>({})
  const unreadTotal = computed(() => Object.values(unreadCounts).reduce((a, b) => a + b, 0))

  // userId -> username 映射（用于渲染 @ 时显示名字）
  const userNames = computed<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    for (const msg of currentMessages.value) {
      if (msg.userId && msg.username && !map[msg.userId]) map[msg.userId] = msg.username
    }
    return map
  })

  const refreshTitle = () => {
    const total = unreadTotal.value
    const stripped = document.title.replace(/^\(\d+\)\s*/, '')
    document.title = total > 0 ? `(${total}) ${stripped}` : stripped
  }

  const markUnreadIfNotActive = (ev: any) => {
    if (!ev || !ev.selfId || !ev.channelId) return
    if (ev.selfId === selectedBot.value && ev.channelId === selectedChannel.value) return
    const key = `${ev.selfId}:${ev.channelId}`
    unreadCounts[key] = (unreadCounts[key] || 0) + 1
    refreshTitle()
  }

  // 方法
  const selectBot = (id: string) => {
    selectedBot.value = id
    selectedChannel.value = ''
    if (isMobile.value) mobileView.value = 'channels'
  }

  const selectChannel = async (id: string, botId?: string) => {
    if (botId) selectedBot.value = botId
    selectedChannel.value = id
    if (selectedBot.value) {
      unreadCounts[`${selectedBot.value}:${id}`] = 0
      refreshTitle()
      // 进入群聊时刷新机器人（自身）在群内的状态（是否接收主动推送 / 群成员角色）
      void refreshBotState(selectedBot.value, id)
    }
    if (isMobile.value) mobileView.value = 'messages'

    // 如果没有消息，加载第一页
    if (currentMessages.value.length === 0) {
      await loadHistory(selectedBot.value, id)
    }

    await nextTick()
    scrollToBottom()

    // 针对图片加载导致的滚动偏移，在 300ms 和 800ms 后再次校准底部
    setTimeout(scrollToBottom, 300)
    setTimeout(scrollToBottom, 800)
  }

  const goBack = () => {
    if (isMobile.value && mobileView.value !== 'channels') {
      // 手机端使用 history.back()，由 popstate 监听器处理视图切换
      window.history.back()
    } else {
      // PC 端或根视图（频道列表）的逻辑
      if (mobileView.value === 'image') {
        mobileView.value = 'messages'
        imageZoom.value = 1
      }
      else if (mobileView.value === 'forward') mobileView.value = 'messages'
      else if (mobileView.value === 'profile') mobileView.value = 'messages'
      else if (mobileView.value === 'raw') mobileView.value = 'messages'
      else if (mobileView.value === 'messages') mobileView.value = 'channels'
    }
  }

  // 处理手机物理返回键
  const handlePopState = (e: PopStateEvent) => {
    if (!isMobile.value) return
    if (e.state && e.state.view) {
      mobileView.value = e.state.view
    } else {
      mobileView.value = 'channels'
    }
  }

  // 监听视图变化，同步到 history state
  watch(mobileView, (newView, oldView) => {
    if (!isMobile.value) return
    // 只有在非 popstate 导致的改变时才 pushState (简单判断：如果当前 state 不匹配则 push)
    if (window.history.state?.view !== newView) {
      window.history.pushState({ view: newView }, '')
    }
  })

  const showForward = (elements: any[]) => {
    forwardData.messages = elements.filter(e => e.type === 'message')
    if (isMobile.value) {
      mobileView.value = 'forward'
    } else {
      forwardDialogVisible.value = true
    }
  }

  const openImageViewer = (url: string) => {
    imageViewer.url = url
    imageZoom.value = 1
    if (isMobile.value) {
      mobileView.value = 'image'
    } else {
      imageViewerVisible.value = true
    }
  }

  const handleImageWheel = (e: WheelEvent) => {
    if (e.deltaY < 0) {
      imageZoom.value = Math.min(imageZoom.value + 0.1, 3)
    } else {
      imageZoom.value = Math.max(imageZoom.value - 0.1, 0.5)
    }
  }

  const downloadImage = (url: string) => {
    const a = document.createElement('a')
    a.href = url
    a.download = `chat-image-${Date.now()}.png`
    a.click()
  }

  const scrollToBottom = () => {
    if (scrollRef.value) {
      const wrap = scrollRef.value.wrapRef
      if (wrap) wrap.scrollTop = wrap.scrollHeight
    }
  }

  const handleScroll = async ({ scrollTop }: { scrollTop: number }) => {
    if (scrollTop <= 10 && !isLoadingHistory.value && selectedBot.value && selectedChannel.value) {
      const pagination = getPagination(selectedBot.value, selectedChannel.value)
      if (pagination.hasMore) {
        isLoadingHistory.value = true
        const wrap = scrollRef.value?.wrapRef
        const oldHeight = wrap?.scrollHeight || 0

        await loadHistory(selectedBot.value, selectedChannel.value)

        await nextTick()
        // 保持滚动位置
        if (wrap) {
          wrap.scrollTop = wrap.scrollHeight - oldHeight
        }
        isLoadingHistory.value = false
      }
    }
  }

  const handleSend = async () => {
    if (!selectedBot.value || !selectedChannel.value) return
    if (inputDisabled.value) {
      ElMessage.warning(inputDisabledHint.value || '当前无法发送消息')
      return
    }
    if (!inputText.value.trim() && !uploadedImages.value.length && !uploadedFiles.value.length) return

    // 剔除输入内容里的 face 表情文本（但保留 faceType=3）
    let content = stripFaceText(inputText.value)
    if (replyingTo.value) {
      // 优先使用真实 ID 进行引用
      const quoteId = replyingTo.value.realId || replyingTo.value.id
      content = `<quote id="${quoteId}"/>${content}`
    }

    const res = await sendMessage(selectedBot.value, selectedChannel.value, content, uploadedImages.value, uploadedFiles.value)
    if (res?.warning) {
      ElMessage.warning(res.warning)
    }
    if (res?.success) {
      inputText.value = ''
      uploadedImages.value = []
      uploadedFiles.value = []
      replyingTo.value = null
      scrollToBottom()
    } else {
      ElMessage.error(res?.error || '发送失败')
    }
  }

  // 选择并上传音频 / 视频 / 文件
  const handleFileSelect = async (file: any, type: string) => {
    if (!file) return
    const res = await uploadFile(file, type)
    if (res?.success) {
      uploadedFiles.value.push({ tempId: res.tempId, filename: file.name || `file.${type}`, type })
    } else {
      ElMessage.error(res?.error || '文件上传失败')
    }
  }

  const removeUploadedFile = (tempId: string) => {
    uploadedFiles.value = uploadedFiles.value.filter(f => f.tempId !== tempId)
  }

  // 复读消息 (+1)：图片重新下载后按正常发图流程发送，文字部分剔除 face 表情文本与 img 标签
  const repeatMessage = async (msg: any) => {
    if (!selectedBot.value || !selectedChannel.value) return

    // 文字内容：剔除 face 表情文本与 img 标签（图片单独重新发送），不附加引用
    // 但保留 faceType=3 的表情（转换为 [face:n] 格式）
    let text = stripFaceText(msg.content).replace(/<img[^>]*>/gi, '').trim()
    
    // 如果内容中还有 <faceType=3>，转换为 [face:n] 格式以便发送
    text = text.replace(/<faceType=3>/gi, () => {
      // 这里需要从 elements 中获取对应的 faceId
      // 但由于无法在文本中直接获取，我们保留标签让后端处理
      return '<faceType=3>'
    })

    // 收集原消息里的图片（elements 优先，其次从 content 里的 <img> 提取）
    const imgs: any[] = (msg.elements || []).filter((el: any) => ['image', 'img', 'mface'].includes(el.type))
    if (!imgs.length) {
      const m = /<img\s+src="([^"]+)"[^>]*>/i.exec(msg.content || '')
      if (m) imgs.push({ attrs: { src: m[1] } })
    }

    // 逐张重新下载到服务器临时目录，走正常发图流程
    const tempImages: any[] = []
    for (const el of imgs) {
      const src = el.attrs?.src || el.attrs?.url
      if (!src) continue
      const res = await (send as any)('fetch-and-upload', { url: src, type: 'image' })
      if (res?.success) {
        tempImages.push({ tempId: res.tempId, filename: res.filename || 'image.jpg' })
      } else {
        ElMessage.warning(`图片下载失败：${res?.error || src}`)
      }
    }

    const res = await sendMessage(selectedBot.value, selectedChannel.value, text, tempImages)
    if (res?.warning) {
      ElMessage.warning(res.warning)
    }
    if (res?.success) {
      scrollToBottom()
    } else {
      ElMessage.error(res?.error || '复读失败')
    }
  }

  // 机器人右键菜单
  const onBotMenu = (e: MouseEvent, bot: any) => {
    e.preventDefault()
    e.stopPropagation()
    menu.value = {
      show: true,
      x: e.clientX,
      y: e.clientY,
      type: 'bot',
      id: bot.selfId,
      isPinned: pinnedBots.value.has(bot.selfId),
      hasMedia: false
    }
  }

  // 频道右键菜单
  const onChannelMenu = (e: MouseEvent, channel: any) => {
    e.preventDefault()
    e.stopPropagation()
    const botId = channel.selfId || selectedBot.value
    menu.value = {
      show: true,
      x: e.clientX,
      y: e.clientY,
      type: 'channel',
      id: channel.id,
      botId,
      isPinned: pinnedChannels.value.has(`${botId}:${channel.id}`),
      hasMedia: false
    }
  }

  // 消息右键菜单：每次右键都在光标位置打开，避免"关掉后再开"的重复点击
  const onMessageMenu = async (e: MouseEvent, msg: any) => {
    e.preventDefault()
    e.stopPropagation()

    const hasMedia = msg.elements?.some((el: any) => ['image', 'img', 'mface', 'audio', 'video'].includes(el.type))
    menu.value = {
      show: true,
      x: e.clientX,
      y: e.clientY,
      type: 'message',
      id: msg.id,
      isPinned: false,
      data: msg,
      hasMedia,
      targetRole: ''
    } as any

    // 异步查询目标成员身份（群主/管理员），用于控制撤回/禁言的显示；自己的消息无需查询
    const isOwn = msg.isBot || msg.userId === selectedBot.value
    if (!isOwn && selectedBot.value && selectedChannel.value && msg.userId) {
      const res = await (send as any)('get-member-role', {
        selfId: selectedBot.value,
        channelId: selectedChannel.value,
        memberOpenid: msg.userId
      })
      // 仅当菜单仍停留在这条消息上时更新，避免旧请求覆盖新菜单
      if (res?.success && menu.value.type === 'message' && menu.value.id === msg.id) {
        menu.value.targetRole = res.role
      }
    }
  }

  // 统一处理菜单动作
  const handleMenuAction = async (action: string) => {
    const type = menu.value.type
    const id = menu.value.id
    const botId = menu.value.botId || selectedBot.value
    const isPinned = menu.value.isPinned
    menu.value.show = false

    if (action === 'pin') {
      if (type === 'bot') await togglePinBot(id, isPinned, pinnedBots.value)
      else await togglePinChannel(botId, id, isPinned, pinnedChannels.value)
    } else if (action === 'delete') {
      // 删除逻辑保持在 index.vue 中通过 ElMessageBox 确认，或者这里直接处理
      if (type === 'bot') await deleteBotData(id)
      else await deleteChannelData(botId, id)
      location.reload()
    }
  }

  // 兼容手机端的复制函数
  const copyToClipboard = (text: string) => {
    if (!text) {
      ElMessage.warning('未复制任何内容')
      return Promise.resolve()
    }
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text)
    } else {
      // 回退方案
      const textArea = document.createElement("textarea")
      textArea.value = text
      textArea.style.position = "fixed"
      textArea.style.left = "-999999px"
      textArea.style.top = "-999999px"
      document.body.appendChild(textArea)
      textArea.focus()
      textArea.select()
      return new Promise<void>((res, rej) => {
        document.execCommand('copy') ? res() : rej()
        textArea.remove()
      })
    }
  }

  const handleMessageAction = async (action: string) => {
    const msg = (menu.value as any).data
    menu.value.show = false
    if (!msg) return

    if (action === 'copy') {
      // 移除 HTML 标签，但保留 [face:n] 格式
      let text = (msg.content || '').replace(/<[^>]+>/g, '')
      // 将 <faceType=3> 替换为 [face:n]
      text = text.replace(/<faceType=3>/gi, '[表情]')
      if (!text) {
        ElMessage.warning('未复制任何内容')
      } else {
        copyToClipboard(text).then(() => ElMessage.success('已复制到剪贴板'))
      }
    } else if (action === 'copy-raw') {
      // 查看原始消息，包含引用标签
      let raw = msg.content || ''
      if (msg.quote) {
        raw = `<quote id="${msg.quote.id}"/>${raw}`
      }
      rawMessage.content = raw
      if (isMobile.value) {
        mobileView.value = 'raw'
      } else {
        rawMessageVisible.value = true
      }
    } else if (action === 'plus1') {
      await repeatMessage(msg)
    } else if (action === 'reply') {
      replyingTo.value = msg
      // 自动聚焦输入框
      nextTick(() => {
        // Element Plus 的 el-input 需要访问其内部的 textarea
        const inputEl = inputRef.value?.$el?.querySelector('textarea') || inputRef.value?.ref
        if (inputEl) {
          inputEl.focus()
        } else {
          inputRef.value?.focus?.()
        }
      })
    } else if (action === 'download') {
      const media = msg.elements?.find((el: any) => ['image', 'img', 'mface', 'audio', 'video'].includes(el.type))
      const url = media?.attrs?.src || media?.attrs?.url || media?.attrs?.file
      if (url) downloadImage(url)
    } else if (action === 'recall') {
      const messageId = msg.realId || msg.id
      if (!messageId || messageId.startsWith('bot-msg-')) {
        ElMessage.warning('该消息缺少真实消息ID，无法撤回')
        return
      }
      const res = await recallMessage(selectedBot.value, selectedChannel.value, messageId)
      if (res?.success) {
        ElMessage.success('已撤回')
        removeMessage(selectedBot.value, selectedChannel.value, msg.id)
      } else {
        ElMessage.error(res?.error || '撤回失败')
      }
    }
  }

  // 显示用户资料
  const showUserProfile = async (msg: any) => {
    if (!selectedBot.value) return

    const res = await (send as any)('get-user-info', {
      selfId: selectedBot.value,
      userId: msg.userId,
      guildId: msg.guildId
    })

    if (res.success) {
      userProfile.data = res.data
      if (isMobile.value) {
        mobileView.value = 'profile'
      } else {
        userProfileVisible.value = true
      }
    } else {
      ElMessage.error(res.error || '获取用户信息失败')
    }
  }

  // 定位消息并高亮：优先按消息 ID，找不到时按引用内容完全匹配
  const scrollToMessage = async (id: string, quote?: any) => {
    const findByContent = () => {
      const content = String((quote as any)?.content || '').trim()
      if (!content) return null
      const match = currentMessages.value.find((m: any) => String(m.content || '').trim() === content)
      if (!match) return null
      return document.querySelector(`[data-id="${match.id}"]`)
    }

    // 尝试在当前列表中查找，优先匹配 data-id，找不到再按内容完全匹配
    let el = document.querySelector(`[data-id="${id}"]`) || document.getElementById(id) || findByContent()

    if (!el) {
      // 如果没找到，尝试向上加载历史记录
      if (isLoadingHistory.value) return

      ElMessage.info('正在向上查找历史消息...')

      // 最多尝试向上查找 3 次
      for (let i = 0; i < 3; i++) {
        await loadHistory(selectedBot.value, selectedChannel.value)
        // 等待 DOM 更新
        await new Promise(resolve => setTimeout(resolve, 150))
        el = document.querySelector(`[data-id="${id}"]`) || document.getElementById(id) || findByContent()
        if (el) break
      }
    }

    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      // 找到消息内容容器进行高亮
      const contentEl = el.querySelector('.cursor-context-menu') || el
      contentEl.classList.add('message-highlight')
      setTimeout(() => contentEl.classList.remove('message-highlight'), 1500)
    } else {
      ElMessage.warning('消息太久远，已不在当前列表中')
    }
  }

  // 处理粘贴图片
  const handlePaste = async (event: ClipboardEvent) => {
    const items = event.clipboardData?.items
    if (!items) return

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile()
        if (file) {
          // 模拟文件上传逻辑
          const reader = new FileReader()
          reader.onload = async (e) => {
            const base64 = e.target?.result as string
            const res = await (send as any)('upload-image', {
              file: base64,
              filename: `pasted_image_${Date.now()}.png`,
              mimeType: file.type
            })
            if (res.success) {
              uploadedImages.value.push({
                tempId: res.tempId,
                preview: URL.createObjectURL(file),
                filename: `pasted_image_${Date.now()}.png`
              })
            }
          }
          reader.readAsDataURL(file)
        }
      }
    }
  }

  const checkMobile = () => {
    isMobile.value = window.innerWidth <= 768
  }

  // 监听键盘弹出（通过 visualViewport 或 window resize）
  const updateKeyboardHeight = () => {
    if (!isMobile.value) {
      keyboardHeight.value = 0
      return
    }

    // 使用 visualViewport API（现代浏览器）
    if (window.visualViewport) {
      const viewportHeight = window.visualViewport.height
      const windowHeight = window.innerHeight
      const calculatedHeight = Math.max(0, windowHeight - viewportHeight)

      // 只有当键盘高度变化超过50px时才更新（避免小幅抖动）
      if (Math.abs(calculatedHeight - keyboardHeight.value) > 50) {
        keyboardHeight.value = calculatedHeight
      }
    } else {
      keyboardHeight.value = 0
    }
  }

  // 生命周期
  let dispose: any[] = []

  onMounted(async () => {
    checkMobile()
    window.addEventListener('resize', checkMobile)
    window.addEventListener('click', () => menu.value.show = false)
    window.addEventListener('popstate', handlePopState)

    // 监听键盘弹出
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', updateKeyboardHeight)
      window.visualViewport.addEventListener('scroll', updateKeyboardHeight)
    }
    window.addEventListener('resize', updateKeyboardHeight)

    // 监听输入框聚焦和失焦
    const handleFocus = () => {
      // 延迟更新，等待键盘完全弹出
      setTimeout(updateKeyboardHeight, 300)
    }
    const handleBlur = () => {
      // 延迟更新，等待键盘完全收起
      setTimeout(() => {
        keyboardHeight.value = 0
      }, 100)
    }

    // 为输入框添加事件监听
    nextTick(() => {
      const textarea = inputRef.value?.$el?.querySelector('textarea')
      if (textarea) {
        textarea.addEventListener('focus', handleFocus)
        textarea.addEventListener('blur', handleBlur)
        dispose.push(() => {
          textarea.removeEventListener('focus', handleFocus)
          textarea.removeEventListener('blur', handleBlur)
        })
      }
    })

    // 初始化 history state
    if (isMobile.value) {
      window.history.replaceState({ view: mobileView.value }, '')
    }

    await loadConfig()
    await loadInitialData()

    const d1 = receive('chat-message-event', (ev: any) => {
      addMessage(ev)
      markUnreadIfNotActive(ev)
      pushNotification(ev)
      if (ev.selfId === selectedBot.value && ev.channelId === selectedChannel.value) {
        // 只有在底部附近才自动滚动
        const wrap = scrollRef.value?.wrapRef
        if (wrap && wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 100) {
          nextTick(scrollToBottom)
        }
      }
    })
    if (typeof d1 === 'function') dispose.push(d1)

    const d2 = receive('bot-message-sent-event', (ev: any) => {
      addMessage(ev)
      markUnreadIfNotActive(ev)
      if (ev.selfId === selectedBot.value && ev.channelId === selectedChannel.value) {
        nextTick(scrollToBottom)
      }
    })
    if (typeof d2 === 'function') dispose.push(d2)

    const d3 = receive('chat-bot-message-event', (ev: any) => {
      addMessage(ev)
      markUnreadIfNotActive(ev)
      if (ev.selfId === selectedBot.value && ev.channelId === selectedChannel.value) {
        nextTick(scrollToBottom)
      }
    })
    if (typeof d3 === 'function') dispose.push(d3)

    // 监听机器人消息更新（发送成功后从虚拟 ID 转为真实 ID）
    const d4 = receive('bot-message-updated', (data: any) => {
      const channelKey = `${selectedBot.value}:${selectedChannel.value}`
      if (data.channelKey !== channelKey) return

      const msg = currentMessages.value.find(m => m.id === data.tempId)
      if (msg) {
        msg.sending = false
        msg.realId = data.realId
      }
    })
    if (typeof d4 === 'function') dispose.push(d4)
  })

  // 定时刷新当前群内状态（含全员禁言），让"全体禁言中"提示及时更新
  let muteStatusTimer: ReturnType<typeof setInterval> | undefined
  muteStatusTimer = setInterval(() => {
    if (!selectedBot.value || !selectedChannel.value) return
    const info = currentChannels.value.find(c => c.id === selectedChannel.value && c.selfId === selectedBot.value)
    if (!info || info.isDirect) return
    void refreshBotState(selectedBot.value, selectedChannel.value)
  }, 30000)

  onUnmounted(() => {
    window.removeEventListener('resize', checkMobile)
    window.removeEventListener('popstate', handlePopState)
    window.removeEventListener('resize', updateKeyboardHeight)
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', updateKeyboardHeight)
      window.visualViewport.removeEventListener('scroll', updateKeyboardHeight)
    }
    if (muteStatusTimer) clearInterval(muteStatusTimer)
    dispose.forEach(d => d?.())
  })

  return {
    // 数据
    bots,
    selectedBot,
    selectedChannel,
    currentChannels,
    currentMessages,
    currentChannelName,
    inputDisabled,
    inputDisabledHint,
    botName,
    inputText,
    uploadedImages,
    isSending,
    pinnedBots,
    pinnedChannels,
    scrollRef,
    isMobile,
    mobileView,
    forwardData,
    imageViewer,
    imageZoom,
    rawMessage,
    isLoadingHistory,
    forwardDialogVisible,
    imageViewerVisible,
    rawMessageVisible,
    replyingTo,
    userProfile,
    userProfileVisible,
    selectedBotPlatform,
    menu,
    keyboardHeight,

    // 未读 / 用户映射
    userNames,
    unreadCounts,
    unreadTotal,

    // 配置
    pluginConfig,

    // 顶部通知
    notifications,
    dismissNotification,
    gotoNotification,

    // 上传文件
    uploadedFiles,
    handleFileSelect,
    removeUploadedFile,

    // QQ表情相关
    parseMessageContent,
    getQQEmojiUrl,
    extractQQEmoji,
    nativeEmojiIds,
    superEmojiIds,
    sendNativeEmoji,

    // 方法
    selectBot,
    selectChannel,
    handleSend,
    togglePinBot,
    togglePinChannel,
    deleteBotData,
    deleteChannelData,
    getCachedImageUrl,
    cacheImage,
    loadVideo,
    isVideoLoading,
    isVideoLoaded,
    getMessages,
    goBack,
    refreshBotState,
    showForward,
    openImageViewer,
    handleImageWheel,
    downloadImage,
    handleScroll,
    repeatMessage,
    handlePaste,
    copyToClipboard,
    onBotMenu,
    onChannelMenu,
    onMessageMenu,
    handleMenuAction,
    handleMessageAction,
    showUserProfile,
    inputRef,
    scrollToMessage
  }
}