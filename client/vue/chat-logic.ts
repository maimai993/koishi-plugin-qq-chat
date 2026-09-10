import { ref, computed, onMounted, nextTick, onUnmounted, reactive, watch } from 'vue'
import { receive, send } from '@koishijs/client'
import { useChatData } from './composables/useChatData'
import { useChatActions } from './composables/useChatActions'
import { useImageCache } from './composables/useImageCache'
import { useVideoCache } from './composables/useVideoCache'
import { ElMessage } from 'element-plus'

/**
 * 清理要交给 v-html 的消息 HTML：
 * - 去掉 script/style/iframe/object/embed/link/meta/form/base/template 等可执行标签
 * - 去掉所有 on* 内联事件（消息里塞 onerror / onload 就能执行任意 JS）
 * - 中和 javascript: / vbscript: / data:text/html 协议
 * 我们自己生成的表情 / 语音 / 图片标记都不带内联事件，因此可以放心在输出前再清一遍。
 */
export const sanitizeMessageHtml = (html: string) => {
  const out = String(html || '')
    // 可执行标签整体删掉
    .replace(/<\s*(script|style|iframe|object|embed|link|meta|form|base|template)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*\/?\s*(script|style|iframe|object|embed|link|meta|form|base|template)\b[^>]*>/gi, '')
    // 所有内联事件（onerror / onload / onclick …）
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  // URL 类属性：去掉空白/控制字符后只放行安全协议（防 java\nscript: 这类绕过）
  return out.replace(/\b(href|src|xlink:href|formaction|poster|background)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi,
    (raw: string, name: string, dq: string | undefined, sq: string | undefined) => {
      const value = String(dq != null ? dq : (sq || ''))
      const compact = value.replace(/[\s\u0000-\u001f]+/g, '')
      if (/^(javascript|vbscript|data\s*:\s*text\/html)/i.test(compact)) return `${name}="#"`
      if (/^data:/i.test(compact) && !/^data:image\//i.test(compact)) return `${name}="#"`
      return raw
    })
}

/** 文件卡片右侧图标（对照参考图「文件卡片.png」：灰底文档 + 折角 + 半透明下载圆） */
export const FILE_ICON_SVG = '<svg viewBox="0 0 33 38" width="33" height="38" aria-hidden="true"><path d="M0 6a6 6 0 0 1 6-6h16l11 11v21a6 6 0 0 1-6 6H6a6 6 0 0 1-6-6V6z" fill="#8a8a8a"/><path d="M22 0l11 11h-8a3 3 0 0 1-3-3V0z" fill="#131418"/><circle cx="16.5" cy="20.5" r="12" fill="rgba(0,0,0,.5)"/><path d="M16.5 12.5v12M16.5 24.5l-4.3-4.3M16.5 24.5l4.3-4.3M10.5 29.5h12" fill="none" stroke="#e9e9e9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'

export function useChatLogic(options: { sandbox?: () => boolean } = {}) {
  const {
    chatData, bots, pinnedBots, pinnedChannels, getChannels, getMessages, pluginConfig,
    loadInitialData, loadConfig, addMessage, removeMessage, loadHistory, getPagination, allChannels,
    refreshBotState, setActiveChannel, unloadChannelMessages
  } = useChatData()

  // 沙盒窗口（/qq-chat/sandbox）：界面与主界面完全一致（同一个 Chat 组件、同一个真实频道、
  // 同一份历史与全部功能），唯一区别是「发送」不直接发到 QQ，而是先推进沙盒虚拟会话走一遍
  // Koishi 中间件；机器人回复被拦截后照常画进聊天列表，点「发送到当前频道」/「编辑发送」
  // 才真的发出去，并且按原始元素发送（图片 / 语音 / 视频不会被压成纯文本）。
  const sandboxMode = computed(() => !!options.sandbox?.())
  // 沙盒窗口里就是真实频道/机器人（所以成员、群设置、历史、@、引用等主界面功能都照常可用）
  const targetSelfId = computed(() => selectedBot.value)
  const targetChannelId = computed(() => selectedChannel.value)

  const {
    isSending, sendMessage, uploadFile, recallMessage, deleteBotData, deleteChannelData,
    togglePinBot, togglePinChannel
  } = useChatActions()

  const { getCachedImageUrl, cacheImage } = useImageCache()
  const { loadVideo, isVideoLoading, isVideoLoaded } = useVideoCache()

  // 状态管理
  const menu = ref({ show: false, x: 0, y: 0, type: '', id: '', botId: '', isPinned: false, hasMedia: false, targetRole: '', data: null as any, channel: null as any, submenu: '' })
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

  // ===== 私聊流式发送模式 =====
  // off=普通（默认）；fake=假流式（点击发送后才以随机间隔分片流式发出，发送前可自由修改错字）；
  // real=真流式（输入框打字即实时分片发出，删除文字不处理，回车/发送结束本条）
  // 假流式与真流式都走 QQ 官方 stream_messages 接口
  type StreamMode = 'off' | 'fake' | 'real'
  const streamMode = ref<StreamMode>('off')
  const fakeStreamBusy = ref(false)
  const isDirectChat = computed(() => {
    const info = currentChannels.value.find(c => c.id === selectedChannel.value && c.selfId === selectedBot.value)
    return !!info?.isDirect
  })
  // —— 真流式状态：active=服务端已开流，sent=最近一次已下发到 QQ 的全文 ——
  const realStreamState = reactive({ active: false, sent: '' })
  let realFlushTimer: ReturnType<typeof setTimeout> | null = null
  let realEndTimer: ReturnType<typeof setTimeout> | null = null
  let realFlushInFlight = false
  // 每次收尾 / 结束真流式时自增，用于让“迟到”的分片响应失效，避免误复活已结束的流
  let realStreamEpoch = 0
  const streamRandomDelay = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1))

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
    return `<img src="${primary}" alt="[face:${id}]" data-face-id="${id}" data-face-type="${type}" class="${cls}" data-fb="${fallback}" />`
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

  // 生成 v-html 用的文本时对用户内容转义，避免被当作标签执行
  const escapeHtmlText = (s: string) => String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

  // 渲染消息文本里的 QQ 表情占位符，返回可直接放入 v-html 的 HTML
  // 仅 faceType=1 / faceType=3 渲染本地 apng 图片；
  // 其余类型（2/4 等）统一显示“不支持的第三方表情”
  // 兼容格式：<faceType=3,faceId="479",ext="..."> / <faceType=3> / [face:n]
  const renderQQFaceContent = (content: string, msg?: any) => {
    if (!content) return ''
    // 先做一次实体反转义，兼容历史消息里被转义过的 <faceType=…> 标签
    // （反转义会把 &lt;img onerror=…&gt; 变成真标签，所以紧接着必须清理一遍）
    let result = sanitizeMessageHtml(decodeHtmlEntities(String(content)))
    const emojis = (msg && Array.isArray(msg.elements)) ? extractQQEmoji(msg.elements) : []
    let emojiIndex = 0

    // 顺序很重要：必须先处理旧格式 [face:n]（视为 faceType=1），
    // 再处理 <faceType=…>。否则 [face:n] 正则会把上一步刚生成的
    // <img alt="[face:479]" …/> 里的 alt 文本再次替换成 img，造成嵌套脏数据。
    result = result.replace(/\[face:(\d+)\]/gi, (match: string, id: string) => buildEmojiImg(id, '1'))

    // faceType=6 的表情包：消息里跟着一张 <img>，这里标记一下让图片按表情大小渲染
    const stickerMessage = /<faceType\s*=\s*6\b/i.test(result)

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
        return `<img${newAttrs} data-orig="${String(src).replace(/"/g, '&quot;')}" />`
      }
      // 地址不是能用的图片（例如 XSS 测试塞的 <img src=x>）：当纯文本显示，别留裂图
      if (!src || !/^(https?:|\/|data:image\/|blob:)/i.test(src)) {
        return escapeHtmlText(raw)
      }
      return raw
    })

    // faceType=6 的表情包：给消息里的图片打上小图类名
    if (stickerMessage) {
      result = result.replace(/<img\b([^>]*)>/gi, (raw: string, attrs: string) => {
        if (/chat-sticker-img/.test(attrs)) return raw
        if (/\bclass\s*=\s*"([^"]*)"/i.test(attrs)) {
          return raw.replace(/\bclass\s*=\s*"([^"]*)"/i, (_m: string, cls: string) => `class="${cls} chat-sticker-img"`)
        }
        return `<img class="chat-sticker-img"${attrs}>`
      })
    }

    // 序列化的 <audio/> <video/> <file/> 元素（如 bot 发送语音/文件后 echo 回的内容）：
    // v-html 无法直接给 audio/video 加播放控件，这里统一补成可交互的播放器/下载链接
    result = result.replace(/<audio\b([^>]*)>/gi, (raw: string, attrs: string) => {
      const srcMatch = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs || '')
      const src = srcMatch ? (srcMatch[1] || srcMatch[2] || '') : ''
      if (src) {
        // QQ 远程语音（silk / 需鉴权链接）浏览器播不了：点击时由服务端转码成 mp3 再播
        const remote = /^https?:\/\//i.test(src) && !/127\.0\.0\.1|localhost/i.test(src)
        const safeSrc = String(src).replace(/"/g, '&quot;')
        return `<span class="qq-chat-voice${remote ? ' is-remote' : ''}" data-src="${safeSrc}" data-remote="${remote ? '1' : '0'}" title="点击播放语音"><span class="qq-chat-voice-icon"></span><span class="qq-chat-voice-wave"><i></i><i></i><i></i><i></i><i></i></span><span class="qq-chat-voice-text">语音</span></span>`
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
        // 有些 gif / 图片会被当作文件发过来，这里按扩展名识别成图片
        if (/\.(png|jpe?g|gif|webp|bmp|avif|apng|svg)(?:$|\?)/i.test(src)) {
          return `<img src="${src}" alt="${String(name).replace(/"/g, '&quot;')}" class="qq-chat-file-image" />`
        }
        const safeName = String(name).replace(/"/g, '&quot;')
        return `<a class="chat-file-card" href="${src}" download="${safeName}" title="点击下载"><span class="chat-file-card-info"><span class="chat-file-card-name">${safeName}</span><span class="chat-file-card-meta">点击下载</span></span><span class="chat-file-card-icon">${FILE_ICON_SVG}</span></a>`
      }
      return raw
    })

    // @ 提及：<at id="..." /> 或 <at id="...">文字</at> → 蓝色 @昵称 胶囊。
    // 昵称优先取已缓存的用户名（userNames），再取 name 属性/内部文本/机器人自身名。
    result = result.replace(/<at\b([^>]*?)\s*\/>|<at\b([^>]*?)>([\s\S]*?)<\/at>/gi,
      (raw: string, selfAttrs: string, pairAttrs: string, inner: string) => {
        const attrsStr = String(selfAttrs != null ? selfAttrs : (pairAttrs || ''))
        const idM = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrsStr)
        const nameM = /\bname\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrsStr)
        const id = idM ? (idM[1] || idM[2] || '') : ''
        const attrName = nameM ? (nameM[1] || nameM[2] || '') : ''
        let label = ''
        if (id && userNames.value[id]) label = userNames.value[id]
        if (!label && attrName) label = attrName
        if (!label && id && msg?.selfId && id === msg.selfId) {
          // @ 到机器人自身：取机器人显示名
          const selfBot = bots.value.find((b: any) => b.selfId === msg.selfId)
          label = selfBot?.username || selfBot?.name || ''
        }
        if (!label) label = String(inner || '').replace(/<[^>]*>/g, '').trim()
        if (!label && id) label = id.length > 12 ? `${id.slice(0, 12)}…` : id
        if (!label) label = '有人'
        const isSelf = !!(id && msg?.selfId && id === msg.selfId)
        // 自己（机器人）用另一种蓝色，其他人用主蓝；颜色同时写进内联样式，避免皮肤 CSS 失效时看不出可点击
        const atColor = isSelf ? '#12b7f5' : '#409eff'
        return `<span class="chat-at${isSelf ? ' chat-at-self' : ''}" data-at-id="${escapeHtmlText(id)}" data-at-name="${escapeHtmlText(label)}" title="点击插入 @${escapeHtmlText(label)}" style="color:${atColor};font-weight:600;cursor:pointer;">@${escapeHtmlText(label)}</span>`
      })

    // 兜底：输出前再清一遍（此时模板里已不含任何内联事件处理器）
    return sanitizeMessageHtml(result)
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

  // @ 成员占位标签 <qqbot-at-user id name /> → 纯文本 "@名字"。
  // 流式发送（markdown 流内无法真正内嵌 @ 他人）等场景用它转换成可见文本。
  const mentionToPlainText = (text: string) => {
    if (!text || !/<qqbot-at-user\b/i.test(text)) return text
    const dec = (s: string) => String(s).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    return String(text).replace(/<qqbot-at-user\b([^>]*?)\/>/gi, (raw, attrs) => {
      const mId = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs || '')
      const mN = /\bname\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs || '')
      const id = mId ? (mId[1] || mId[2] || '') : ''
      if (!id) return raw
      const nm = (mN ? (mN[1] || mN[2] || '') : '').trim()
      return `@${dec(nm || id)}`
    })
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
    // 点表情是直接发到 QQ 的：沙盒模式下入口已隐藏，这里再兜一层
    if (sandboxMode.value) {
      ElMessage.warning('沙盒模式下不能直接发 QQ 表情到频道，请用回复下的「发送到当前频道 / 编辑后发送」')
      return
    }
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
    // 消息免打扰的群不弹通知卡片（除非被 @ 或被引用）
    const muteKey = `${ev.selfId}:${ev.channelId}`
    if (isChannelMuted(muteKey) && !ev.atBot && !isReplyToBotEvent(ev)) return
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

  // ===== 群聊备注 / 消息免打扰（本地设置） =====
  const CHANNEL_REMARKS_KEY = 'qq-chat:channel-remarks'
  const MUTED_CHANNELS_KEY = 'qq-chat:muted-channels'
  const channelRemarks = ref<Record<string, string>>({})
  const mutedChannels = ref<string[]>([])
  try {
    channelRemarks.value = JSON.parse(localStorage.getItem(CHANNEL_REMARKS_KEY) || '{}')
  } catch {
    channelRemarks.value = {}
  }
  try {
    mutedChannels.value = JSON.parse(localStorage.getItem(MUTED_CHANNELS_KEY) || '[]')
  } catch {
    mutedChannels.value = []
  }
  const persistChannelRemarks = () => {
    try {
      localStorage.setItem(CHANNEL_REMARKS_KEY, JSON.stringify(channelRemarks.value))
    } catch { /* 忽略写入失败 */ }
  }
  const persistMutedChannels = () => {
    try {
      localStorage.setItem(MUTED_CHANNELS_KEY, JSON.stringify(mutedChannels.value))
    } catch { /* 忽略写入失败 */ }
  }
  const isChannelMuted = (key: string) => mutedChannels.value.includes(key)
  const setChannelMuted = (key: string, muted: boolean) => {
    mutedChannels.value = muted
      ? [...new Set([...mutedChannels.value, key])]
      : mutedChannels.value.filter(k => k !== key)
    persistMutedChannels()
  }
  const setChannelRemark = (key: string, remark: string) => {
    const text = String(remark || '').trim()
    const next = { ...channelRemarks.value }
    if (text) next[key] = text
    else delete next[key]
    channelRemarks.value = next
    persistChannelRemarks()
  }
  // 频道显示名：优先用备注
  const channelDisplayName = (channel: any) => {
    if (!channel) return ''
    const key = `${channel.selfId || selectedBot.value}:${channel.id}`
    return channelRemarks.value[key] || channel.name || channel.id
  }

  // 「被引用」也算提醒：别人回复了机器人的消息
  const isReplyToBotEvent = (ev: any) => {
    const quoteUser = ev?.quote?.user
    if (!quoteUser || !ev?.selfId) return false
    return quoteUser.userId === ev.selfId || quoteUser.id === ev.selfId
  }

  // 群聊天设置弹窗
  const channelSettingsVisible = ref(false)
  const channelSettings = reactive({ botId: '', channelId: '', name: '', remark: '', pinned: false, muted: false })
  const openChannelSettings = (channel: any) => {
    const botId = channel?.selfId || selectedBot.value
    const channelId = channel?.id || selectedChannel.value
    const key = `${botId}:${channelId}`
    channelSettings.botId = botId
    channelSettings.channelId = channelId
    channelSettings.name = channel?.name || channelId
    channelSettings.remark = channelRemarks.value[key] || ''
    channelSettings.pinned = pinnedChannels.value.has(key)
    channelSettings.muted = isChannelMuted(key)
    channelSettingsVisible.value = true
  }
  const saveChannelSettings = async () => {
    const key = `${channelSettings.botId}:${channelSettings.channelId}`
    setChannelRemark(key, channelSettings.remark)
    setChannelMuted(key, channelSettings.muted)
    const pinned = pinnedChannels.value.has(key)
    if (pinned !== channelSettings.pinned) {
      await togglePinChannel(channelSettings.botId, channelSettings.channelId, pinned, pinnedChannels.value)
    }
    channelSettingsVisible.value = false
    ElMessage.success('设置已保存')
  }
  const clearChannelHistory = async () => {
    const { botId, channelId, name } = channelSettings
    try {
      await ElMessageBox.confirm(`确定删除「${channelRemarks.value[`${botId}:${channelId}`] || name}」的聊天记录吗？`, '删除聊天记录', { type: 'warning' })
    } catch {
      return
    }
    const res = await (send as any)('clear-channel-history', { selfId: botId, channelId })
    if (res?.success !== false) {
      ElMessage.success('已删除聊天记录')
      channelSettingsVisible.value = false
    } else {
      ElMessage.error(res?.error || '删除失败')
    }
  }

  // 「从消息列表中移除」的频道（本地记录；有未读/被选中时会重新出现）
  const HIDDEN_CHANNELS_KEY = 'qq-chat:hidden-channels'
  const hiddenChannels = ref<string[]>([])
  try {
    hiddenChannels.value = JSON.parse(localStorage.getItem(HIDDEN_CHANNELS_KEY) || '[]')
  } catch {
    hiddenChannels.value = []
  }
  const saveHiddenChannels = () => {
    try {
      localStorage.setItem(HIDDEN_CHANNELS_KEY, JSON.stringify(hiddenChannels.value))
    } catch { /* 忽略隐私模式下的写入失败 */ }
  }

  // 计算属性
  const currentChannels = computed(() => allChannels.value.filter((c: any) => {
    const key = `${c.selfId}:${c.id}`
    if (!hiddenChannels.value.includes(key)) return true
    if (key === `${selectedBot.value}:${selectedChannel.value}`) return true
    return !!unreadCounts[key] || !!atMeCounts[key]
  }))
  const currentMessages = computed(() => getMessages(selectedBot.value, selectedChannel.value))
  const currentChannelName = computed(() => {
    const c = currentChannels.value.find(i => i.id === selectedChannel.value && i.selfId === selectedBot.value)
    if (!c) return ''
    return channelRemarks.value[`${c.selfId}:${c.id}`] || c.name
  })

  // 输入框是否禁用：私聊不禁用；群聊中仅当机器人不在群 / 群处于全员禁言（全体禁言）时禁用。
  // 没开全体禁言不禁止发言，与机器人是否管理员/群主无关。
  // 沙盒窗口里发送只在本机跑，不受群里禁言 / 退群状态影响。
  const inputDisabled = computed(() => {
    if (sandboxMode.value) return false
    const info = currentChannels.value.find(c => c.id === selectedChannel.value && c.selfId === selectedBot.value)
    if (!info || info.isDirect) return false
    const bs = info.botState
    if (!bs) return false
    if (bs.inGroup === false) return true
    if (bs.globalMuted) return true
    return false
  })

  const inputDisabledHint = computed(() => {
    if (sandboxMode.value) return ''
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
  // 全部未读：消息免打扰的群不计入普通未读，但「有人@我 / 被引用」仍然计入
const unreadTotal = computed(() => {
  let total = 0
  for (const [key, count] of Object.entries(unreadCounts)) {
    if (isChannelMuted(key)) continue
    total += Number(count || 0)
  }
  for (const count of Object.values(atMeCounts)) total += Number(count || 0)
  for (const count of Object.values(replyMeCounts)) total += Number(count || 0)
  return total
})
  // 每群“有人@你”的未读提醒数（由 chat-message-event 的 atBot 字段驱动）
  const atMeCounts = reactive<Record<string, number>>({})
  // 每群“被引用/被回复”的提醒数（别人引用了机器人的消息）
  const replyMeCounts = reactive<Record<string, number>>({})

  // 纯数字 openid / 32 位十六进制 id 不能当昵称显示
  const isRawIdName = (value: any) => {
    const text = String(value || '').trim()
    if (!text) return true
    return /^\d{6,}$/.test(text) || /^[0-9a-f]{32}$/i.test(text)
  }

  // userId -> username 映射（用于渲染 @ 时显示名字）
  // 机器人自己的消息里存的常常是 openid，这里统一换成机器人昵称
  const userNames = computed<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    for (const msg of currentMessages.value) {
      const id = msg.userId
      if (!id || map[id]) continue
      if (msg.isBot || msg.type === 'bot') {
        map[id] = botName(msg.selfId)
        continue
      }
      const name = String(msg.username || '')
      if (name && !isRawIdName(name) && name !== 'unknown' && name !== '系统消息') map[id] = name
    }
    // 机器人自身的 selfId 也直接映射，@机器人时能显示名字
    for (const bot of bots.value as any[]) {
      if (bot?.selfId && !map[bot.selfId]) map[bot.selfId] = bot.username || botName(bot.selfId)
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

  // 某群有人 @ 机器人（且当前未打开该群）时，在频道列表点亮“有人@你”提醒
  const markAtMeIfNotActive = (ev: any) => {
    if (!ev || !ev.selfId || !ev.channelId) return
    if (ev.selfId === selectedBot.value && ev.channelId === selectedChannel.value) return
    const key = `${ev.selfId}:${ev.channelId}`
    if (ev.atBot) atMeCounts[key] = (atMeCounts[key] || 0) + 1
    if (isReplyToBotEvent(ev)) replyMeCounts[key] = (replyMeCounts[key] || 0) + 1
  }

  // 聚焦聊天输入框（兼容旧 el-input textarea 与富文本输入框），并把光标移到末尾
  const focusChatInput = () => {
    const root: any = inputRef.value
    const el: any = root?.$el?.querySelector?.('textarea') || root?.ref || root
    if (!el) return
    if (typeof el.focus === 'function') el.focus()
    if (typeof el.isContentEditable === 'boolean' && el.isContentEditable) {
      try {
        const sel = window.getSelection()
        const range = document.createRange()
        range.selectNodeContents(el)
        range.collapse(false)
        sel?.removeAllRanges()
        sel?.addRange(range)
      } catch { /* 忽略 */ }
    }
  }

  // 方法
  const selectBot = (id: string) => {
    // 切换机器人前收尾可能仍在进行的私聊真流式
    if (streamMode.value === 'real' || realStreamState.active || realStreamState.sent) void cancelRealStream()
    selectedBot.value = id
    selectedChannel.value = ''
    streamMode.value = 'off'
    if (isMobile.value) mobileView.value = 'channels'
  }

  const selectChannel = async (id: string, botId?: string) => {
    // 离开当前会话前先收尾仍在进行的真流式（结束后会复位输入状态）
    if (streamMode.value === 'real' || realStreamState.active || realStreamState.sent) await cancelRealStream()
    const prevBot = selectedBot.value
    const prevChannel = selectedChannel.value
    if (botId) selectedBot.value = botId
    selectedChannel.value = id
    // 切换频道后卸载上一个频道的数据，避免一直占着内存
    if (prevChannel && (prevBot !== selectedBot.value || prevChannel !== id)) {
      unloadChannelMessages(prevBot, prevChannel)
    }
    setActiveChannel(selectedBot.value, id)
    // 群聊不支持流式发送，切到群聊自动回到普通模式
    if (!isDirectChat.value && streamMode.value !== 'off') streamMode.value = 'off'
    if (selectedBot.value) {
      unreadCounts[`${selectedBot.value}:${id}`] = 0
      atMeCounts[`${selectedBot.value}:${id}`] = 0
      refreshTitle()
      // 进入群聊时刷新机器人（自身）在群内的状态（是否接收主动推送 / 群成员角色）
      void refreshBotState(selectedBot.value, id)
    }
    if (isMobile.value) mobileView.value = 'messages'

    // 如果没有消息，只加载第一页（50 条），往上滚动再按需加载
    if (currentMessages.value.length === 0) {
      await loadHistory(selectedBot.value, id, 50)
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

  // 距离顶部还有 260px 就提前加载上一页，避免看到"加载中"的空窗
  const HISTORY_PREFETCH_PX = 260

  const handleScroll = async ({ scrollTop }: { scrollTop: number }) => {
    if (scrollTop <= HISTORY_PREFETCH_PX && !isLoadingHistory.value && selectedBot.value && selectedChannel.value) {
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
    // 沙盒窗口：消息推进沙盒会话，不直接发到 QQ
    if (sandboxMode.value) return await sendSandboxMessage()
    if (fakeStreamBusy.value) {
      ElMessage.warning('假流式正在分片发送中，请稍候')
      return
    }
    if (inputDisabled.value) {
      ElMessage.warning(inputDisabledHint.value || '当前无法发送消息')
      return
    }
    if (!inputText.value.trim() && !uploadedImages.value.length && !uploadedFiles.value.length) return

    // 私聊流式发送：仅当为纯文本（无图片/文件、无引用回复）时才走流式逻辑
    const hasMedia = uploadedImages.value.length > 0 || uploadedFiles.value.length > 0
    const pureText = !replyingTo.value && !hasMedia
    if (pureText && isDirectChat.value && streamMode.value !== 'off') {
      if (streamMode.value === 'real') return await finalizeRealStream()
      return await sendFakeStream()
    }
    // 带图片 / 文件 / 引用回复时不支持流式：先收尾仍在进行的真流式，再按普通消息发送
    if (streamMode.value === 'real' && (realStreamState.active || realStreamState.sent)) await cancelRealStream()

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

  // ===== 控制台指令桥接：本地执行 Koishi 指令 → 拦截输出 → 编辑后发送（工具栏按钮触发） =====
  const bridgeRunning = ref(false)
  // 拦截到的指令输出：先放进可编辑弹窗，用户改完再发送
  const commandResultVisible = ref(false)
  const commandResultText = ref('')
  const commandResultCommand = ref('')
  const commandResultSending = ref(false)
  // 指令输出里的非文本元素（图片 / 语音 / 视频 / 文件）：渲染出来 + 原样发送，绝不压成纯文本
  const commandResultElements = ref<any[]>([])

  // 元素拆成「可编辑文本」+「原样保留的媒体元素」
  const splitEditableElements = (elements: any[]) => {
    const texts: string[] = []
    const media: any[] = []
    for (const el of elements || []) {
      if (!el) continue
      if (el.type === 'text') texts.push(el.attrs?.content != null ? String(el.attrs.content) : '')
      else if (el.type === 'br') texts.push('\n')
      else media.push(el)
    }
    return { text: texts.join('').replace(/\n{3,}/g, '\n\n').trim(), media }
  }

  const sendCommandResult = async () => {
    if (!selectedBot.value || !targetChannelId.value) return
    if (commandResultSending.value) return
    const text = commandResultText.value.trim()
    const elements = commandResultElements.value
    if (!text && !elements.length) {
      ElMessage.warning('内容为空，没什么可发的')
      return
    }
    commandResultSending.value = true
    try {
      // 走元素接口：文本 + 图片/语音/视频一起发，媒体不会被当纯文本丢掉
      const sent = await (send as any)('send-elements', {
        selfId: targetSelfId.value,
        channelId: targetChannelId.value,
        text,
        elements
      })
      if (sent?.success) {
        inputText.value = ''
        commandResultVisible.value = false
        scrollToBottom()
        ElMessage.success('已发送指令输出')
      } else {
        ElMessage.error(sent?.error || '发送失败')
      }
    } catch (error: any) {
      ElMessage.error(error?.message || '发送失败')
    } finally {
      commandResultSending.value = false
    }
  }

  const removeCommandResultElement = (index: number) => {
    commandResultElements.value.splice(index, 1)
  }

  // ===== 沙盒：多轮执行指令的对话框，关闭时清空上下文 =====
  const sandboxVisible = ref(false)
  const sandboxInput = ref('')
  const sandboxRunning = ref(false)
  const sandboxMessages = ref<{ role: 'user' | 'bot'; text: string; command?: string; ok?: boolean; elements?: any[] }[]>([])
  const sandboxImages = ref<string[]>([])
  const sandboxUploading = ref(false)

  // 沙盒里添加图片：用 assets 服务上传（upload-md-image 内部走 ctx.assets.upload），拿到公网地址
  const addSandboxImages = async (files: File[]) => {
    if (!files.length) return
    sandboxUploading.value = true
    try {
      for (const file of files) {
        if (!file || !String(file.type || '').startsWith('image/')) continue
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result || ''))
          reader.onerror = () => reject(new Error('读取图片失败'))
          reader.readAsDataURL(file)
        })
        // 上传走 assets 服务，可能比较慢：加超时并给出明确提示，避免一直卡住
        const res = await Promise.race([
          (send as any)('upload-md-image', { file: dataUrl, filename: file.name || 'sandbox.png' }),
          new Promise((resolve) => setTimeout(() => resolve({ success: false, error: '图片上传超时（assets 服务没响应），请检查 koishi-plugin-assets-* 插件' }), 15000))
        ]) as any
        if (res?.success && res.url) sandboxImages.value.push(res.url)
        else ElMessage.error(res?.error || '图片上传失败')
      }
    } catch (error: any) {
      ElMessage.error(error?.message || '图片上传失败')
    } finally {
      sandboxUploading.value = false
    }
  }

  const removeSandboxImage = (index: number) => { sandboxImages.value.splice(index, 1) }

  const resetSandboxSession = async () => {
    const payload = { selfId: selectedBot.value, channelId: selectedChannel.value }
    try {
      await (send as any)('sandbox-reset', payload)
    } catch { /* 服务端没重载插件时忽略 */ }
    try {
      await (send as any)('sandbox-clear', payload)
    } catch { /* 忽略 */ }
  }

  // 元素 → 纯文本（沙盒气泡展示用）
  const sandboxElementsText = (elements: any[]): string => {
    const one = (el: any): string => {
      if (!el) return ''
      if (typeof el === 'string') return el
      const attrs = el.attrs || {}
      switch (el.type) {
        case 'text': return attrs.content != null ? String(attrs.content) : (el.children || []).map(one).join('')
        case 'at': return '@' + (attrs.name || attrs.id || '')
        case 'image':
        case 'img': {
          // data: 图片的 src 是几 MB 的 base64，塞进文本气泡既没意义又会卡界面
          const src = String(attrs.src || '')
          return src && !/^data:/i.test(src) && src.length < 160 ? '[图片] ' + src : '[图片]'
        }
        case 'audio': return '[语音]'
        case 'video': return '[视频]'
        case 'file': return '[文件 ' + (attrs.filename || attrs.name || '') + ']'
        case 'br': return '\n'
        default: return (el.children || []).length ? (el.children || []).map(one).join('') : ''
      }
    }
    return (elements || []).map(one).join('').replace(/\n{3,}/g, '\n\n').trim()
  }

  // 机器人回复由服务端广播逐条推来
  receive('sandbox-message', (payload: any) => {
    if (!payload) return
    const elements = payload.elements || []
    // 服务端把回复的原始标记（<img>/<audio>/<video>/<file>）一起推过来：
    // 聊天列表按 content 渲染，只有用原始标记才能把图片 / 语音 / 视频画出来
    const replyMarkup = String(payload.content || '').trim()
    // 沙盒窗口：回复按普通聊天消息画进真实频道（可渲染图片/语音/视频，也可按元素转发）
    // 注意：控制台页面的「沙盒对话框」打开时仍走对话框那条分支
    if (sandboxMode.value && !sandboxVisible.value) {
      if (payload.selfId !== selectedBot.value || payload.channelId !== selectedChannel.value) return
      if (!elements.length) return
      addMessage({
        messageId: `qq-chat:sandbox-bot:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`,
        selfId: payload.selfId,
        channelId: selectedChannel.value,
        content: replyMarkup || sandboxElementsText(elements),
        elements: JSON.parse(JSON.stringify(elements)),
        username: botName(payload.selfId) || '机器人',
        userId: payload.selfId,
        isBot: true,
        sandbox: true,
        timestamp: Number(payload.timestamp) || Date.now()
      })
      nextTick(() => scrollToBottom())
      return
    }
    if (payload.selfId !== selectedBot.value || payload.channelId !== selectedChannel.value) return
    const text = sandboxElementsText(elements)
    if (!text && !elements.length) return
    // 保存原始元素，供 RenderElement 渲染（图片/语音/视频）和「编辑发送」原样转发
    sandboxMessages.value.push({ role: 'bot', text, ok: true, elements: JSON.parse(JSON.stringify(elements)) })
    nextTick(() => {
      const box = document.querySelector('.chat-sandbox-list') as HTMLElement | null
      if (box) box.scrollTop = box.scrollHeight
    })
  })

  const openSandbox = async () => {
    sandboxVisible.value = true
    sandboxMessages.value = []
    sandboxInput.value = ''
    await resetSandboxSession()
  }

  const clearSandbox = async () => {
    sandboxMessages.value = []
    sandboxInput.value = ''
    await resetSandboxSession()
    ElMessage.success('沙盒上下文已清空')
  }

  // 关闭界面不清空上下文（只有「清空上下文」按钮才重置）
  const closeSandbox = async () => {
    sandboxVisible.value = false
  }

  const runSandbox = async () => {
    if (!selectedBot.value || !selectedChannel.value) return
    if (sandboxRunning.value) return
    const raw = sandboxInput.value.trim()
    // 允许「只发图片」：没有文字但有图片也能发
    if (!raw && !sandboxImages.value.length) {
      ElMessage.warning('先在沙盒里写一条指令或加一张图片')
      return
    }
    // 文本 + 图片（<img src> 元素，服务端会解析成真正的图片元素）
    const imageTags = sandboxImages.value.map((url) => `<img src="${url}"/>`).join('')
    const content = raw + imageTags
    sandboxMessages.value.push({
      role: 'user',
      text: (raw || '（图片）') + (sandboxImages.value.length ? ` （+${sandboxImages.value.length} 张图片）` : '')
    })
    sandboxInput.value = ''
    sandboxImages.value = []
    sandboxRunning.value = true
    try {
      const payload = {
        selfId: selectedBot.value,
        channelId: selectedChannel.value,
        command: raw,
        content,
        isDirect: isDirectChat.value
      }
      // 假适配器流式沙盒：立刻返回，机器人回复通过 sandbox-message 广播逐条推来
      let res: any = null
      try {
        res = await (send as any)('sandbox-send', payload)
      } catch (error: any) {
        const text = String(error?.message || error || '')
        if (!/not implemented|unknown message/i.test(text)) throw error
        // 服务端没重载插件时退回旧接口
        try {
          res = await (send as any)('simulate-message', payload)
        } catch (error2: any) {
          const text2 = String(error2?.message || error2 || '')
          if (!/not implemented|unknown message/i.test(text2)) throw error2
          res = await (send as any)('sandbox-run', payload)
        }
      }
      if (!res?.success) {
        sandboxMessages.value.push({ role: 'bot', text: res?.error || res?.message || '发送失败', ok: false })
        return
      }
      // 老接口（同步返回）才补一条气泡；新流式接口的回复走广播
      const output = String(res.edited ?? res.output ?? '').trim()
      if (output) {
        sandboxMessages.value.push({
          role: 'bot',
          text: output,
          command: String(res.command || raw),
          ok: true
        })
      }
    } catch (error: any) {
      sandboxMessages.value.push({ role: 'bot', text: error?.message || '发送失败', ok: false })
    } finally {
      sandboxRunning.value = false
      nextTick(() => {
        const box = document.querySelector('.chat-sandbox-list') as HTMLElement | null
        if (box) box.scrollTop = box.scrollHeight
      })
    }
  }

  // 沙盒里的机器人回复：直接把捕获到的元素发到真实频道（图片/语音/视频原样）
  const forwardSandboxResult = async (message: { text: string; elements?: any[] }) => {
    if (!selectedBot.value || !selectedChannel.value) return
    const elements = message?.elements || []
    if (!elements.length) {
      ElMessage.warning('这条没有可发送的内容')
      return
    }
    const res = await (send as any)('sandbox-forward', {
      selfId: selectedBot.value,
      channelId: selectedChannel.value,
      elements
    })
    if (res?.success) ElMessage.success('已发送到当前频道')
    else ElMessage.error(res?.error || '发送失败')
  }

  // ===== 沙盒窗口（/qq-chat/sandbox）：用聊天页的界面跑沙盒 =====
  const sandboxSending = ref(false)

  // 进入沙盒：就是选中那条真实频道（界面、历史、成员、群设置全都和主界面一致），
  // 只是这个窗口里的「发送」会先走本机沙盒会话；顺手清一次本机会话，保证从干净上下文开始
  const enterSandbox = async (realChannelId: string, botId: string) => {
    if (!realChannelId || !botId) return
    await selectChannel(String(realChannelId), botId)
    await resetSandboxSession()
    ElMessage.info('沙盒模式：消息只在本机执行，点回复下的「发送到当前频道」才真的发到 QQ')
  }

  // 沙盒窗口里发消息：文本 + 图片/语音/视频一起推进沙盒会话（服务端拼好元素再派发）
  const sendSandboxMessage = async () => {
    if (!sandboxMode.value || sandboxSending.value) return
    const botId = targetSelfId.value
    const realChannelId = targetChannelId.value
    if (!botId || !realChannelId) return
    const content = stripFaceText(inputText.value)
    if (!content.trim() && !uploadedImages.value.length && !uploadedFiles.value.length) return
    sandboxSending.value = true
    try {
      const res = await (send as any)('sandbox-send-message', {
        selfId: botId,
        channelId: realChannelId,
        content,
        images: uploadedImages.value.map((img: any) => ({ tempId: img.tempId, filename: img.filename })),
        files: uploadedFiles.value.map((f: any) => ({ tempId: f.tempId, filename: f.filename, type: f.type })),
        isDirect: isDirectChat.value
      })
      if (!res?.success) {
        ElMessage.error(res?.error || '沙盒执行失败')
        return
      }
      // 把用户这条消息（含图片/语音/视频）也画进聊天列表，和主界面一样有个自己的气泡
      addMessage({
        messageId: `qq-chat:sandbox-user:${Date.now()}`,
        selfId: botId,
        channelId: realChannelId,
        content: String(res.content || content),
        elements: res.elements || [],
        username: '控制台',
        userId: `qq-chat:console:${botId}`,
        isBot: false,
        sandbox: true,
        timestamp: Date.now()
      })
      inputText.value = ''
      uploadedImages.value = []
      uploadedFiles.value = []
      replyingTo.value = null
      nextTick(() => scrollToBottom())
    } catch (error: any) {
      ElMessage.error(error?.message || '沙盒执行失败')
    } finally {
      sandboxSending.value = false
    }
  }

  // 沙盒回复：直接按元素发到真实频道（图片/语音/视频原样）
  const sandboxForwarding = ref(false)
  const forwardSandboxMessage = async (msg: any) => {
    const elements = msg?.elements || []
    if (!elements.length) {
      ElMessage.warning('这条没有可发送的内容')
      return
    }
    if (!targetSelfId.value || !targetChannelId.value) return
    if (sandboxForwarding.value) return
    sandboxForwarding.value = true
    try {
      const res = await (send as any)('sandbox-forward', {
        selfId: targetSelfId.value,
        channelId: targetChannelId.value,
        elements
      })
      if (res?.success) ElMessage.success('已发送到当前频道')
      else ElMessage.error(res?.error || '发送失败')
    } catch (error: any) {
      ElMessage.error(error?.message || '发送失败')
    } finally {
      sandboxForwarding.value = false
    }
  }

  // 沙盒回复「编辑发送」：改完文字、删掉不要的元素，再按元素发出去
  const elementEditorVisible = ref(false)
  const elementEditorText = ref('')
  const elementEditorElements = ref<any[]>([])
  const elementEditorSending = ref(false)
  const elementEditorHint = ref('')

  const openElementEditor = (elements: any[], hint = '') => {
    const { text, media } = splitEditableElements(elements)
    if (!text && !media.length) {
      ElMessage.warning('这条没有可发送的内容')
      return
    }
    elementEditorText.value = text
    elementEditorElements.value = media
    elementEditorHint.value = hint
    elementEditorVisible.value = true
  }

  const removeElementEditorItem = (index: number) => {
    elementEditorElements.value.splice(index, 1)
  }

  const sendEditedElements = async () => {
    if (!targetSelfId.value || !targetChannelId.value) return
    if (elementEditorSending.value) return
    const text = elementEditorText.value.trim()
    const elements = elementEditorElements.value
    if (!text && !elements.length) {
      ElMessage.warning('内容为空，没什么可发的')
      return
    }
    elementEditorSending.value = true
    try {
      const res = await (send as any)('send-elements', {
        selfId: targetSelfId.value,
        channelId: targetChannelId.value,
        text,
        elements
      })
      if (res?.success) {
        elementEditorVisible.value = false
        ElMessage.success('已按原样发送（图片/语音/视频不会被压成文本）')
      } else {
        ElMessage.error(res?.error || '发送失败')
      }
    } catch (error: any) {
      ElMessage.error(error?.message || '发送失败')
    } finally {
      elementEditorSending.value = false
    }
  }

  // 沙盒窗口：清空本机会话 + 移除列表里那些「只在本机出现过」的沙盒消息（真实历史不动）
  const clearSandboxWindow = async () => {
    await resetSandboxSession()
    const key = `${selectedBot.value}:${selectedChannel.value}`
    const list = chatData.value.messages[key]
    if (list?.length) {
      const kept = list.filter((msg: any) => !msg.sandbox)
      if (kept.length !== list.length) {
        chatData.value.messages[key] = kept
        chatData.value = { ...chatData.value, messages: { ...chatData.value.messages } }
      }
    }
    ElMessage.success('沙盒上下文已清空')
  }

  const runBridgeCommand = async () => {
    if (!selectedBot.value || !selectedChannel.value) return
    if (bridgeRunning.value) return
    const raw = inputText.value.trim()
    if (!raw) {
      ElMessage.warning('先在输入框里写一条指令，例如 /help')
      return
    }
    const bridgeConfig: any = pluginConfig.value || {}
    if (bridgeConfig.commandBridge === false) {
      ElMessage.warning('控制台指令桥接已在插件设置里关闭')
      return
    }
    bridgeRunning.value = true
    try {
      const res = await (send as any)('run-command', {
        selfId: targetSelfId.value,
        // 沙盒窗口里用的就是真实频道，指令看到的频道信息与主界面一致
        channelId: targetChannelId.value,
        command: raw,
        isDirect: isDirectChat.value
      })
      if (!res?.success) {
        ElMessage.error(res?.error || res?.message || '指令执行失败（详情见控制台日志）')
        return
      }
      // 服务端会把拦截到的原始元素一起回传（图片/语音/视频用它渲染与发送）
      const outElements = Array.isArray(res.elements) ? res.elements : []
      const { text: elementText, media } = splitEditableElements(outElements)
      const output = String(res.edited ?? res.output ?? '').trim()
      if (!output && !media.length) {
        ElMessage.warning(`指令 /${res.command || raw} 没有输出`)
        return
      }
      // 拦截到的输出先放进可编辑弹窗，用户改完再点发送
      commandResultCommand.value = String(res.command || raw)
      commandResultText.value = elementText || output
      commandResultElements.value = media
      commandResultVisible.value = true
    } catch (error: any) {
      ElMessage.error(error?.message || '指令执行失败')
    } finally {
      bridgeRunning.value = false
    }
  }

  // ==================== 私聊流式发送（真流式 / 假流式） ====================

  // 真流式：结束当前流（QQ stream_messages input_state=10）。返回服务端结果。
  const finalizeRealStream = async () => {
    if (realFlushTimer) { clearTimeout(realFlushTimer); realFlushTimer = null }
    if (realEndTimer) { clearTimeout(realEndTimer); realEndTimer = null }
    if (!selectedBot.value || !selectedChannel.value) return { success: true }
    const content = mentionToPlainText(stripFaceText(inputText.value))
    const botId = selectedBot.value
    const channelId = selectedChannel.value
    let sessionText = realStreamState.sent
    const hasLiveStream = realStreamState.active || !!sessionText
    let diverge = false
    if (!hasLiveStream) {
      // 还从未发过任何分片：先 begin 首片，再立即 end，保证本条也以流式消息呈现
      if (!content.trim()) return { success: true }
      const begin = await (send as any)('stream-message', { action: 'begin', selfId: botId, channelId, content })
      if (!begin?.success) {
        ElMessage.error(begin?.error || '真流式发送失败')
        return begin || { success: false }
      }
      sessionText = content
    } else if (content.trim() && content.startsWith(sessionText) && content.length >= sessionText.length) {
      // 最新输入是已下发全文的纯增量（还没触发分片 flush），让结束片一并带上
      sessionText = content
    } else if (content.trim() && content !== sessionText) {
      // 期间发生过删除 / 整段重写，当前输入已无法作为旧流前缀：结束旧流后改用普通消息补发
      diverge = true
    }
    const res = await (send as any)('stream-message', { action: 'end', selfId: botId, channelId, content: sessionText })
    realStreamState.active = false
    realStreamState.sent = ''
    realStreamEpoch += 1
    if (res?.success) {
      if (diverge && content.trim()) {
        // 当前文字与已流式发出的内容不一致：单独按普通消息发送，避免丢字
        const normalRes = await sendMessage(botId, channelId, content, [], [])
        if (!normalRes?.success) {
          ElMessage.error(normalRes?.error || '补发消息失败，文字仍在输入框，可手动重试')
          return normalRes || { success: false }
        }
      }
      inputText.value = ''
      uploadedImages.value = []
      uploadedFiles.value = []
      replyingTo.value = null
      scrollToBottom()
    } else {
      ElMessage.error(res?.error || '真流式结束失败，请重试')
    }
    return res
  }

  // 真流式：收尾当前流（通常用于切频道 / 退出模式 / 卸载页面）
  const cancelRealStream = async () => {
    if (realFlushTimer) { clearTimeout(realFlushTimer); realFlushTimer = null }
    if (realEndTimer) { clearTimeout(realEndTimer); realEndTimer = null }
    const hadStream = realStreamState.active || !!realStreamState.sent
    const botId = selectedBot.value
    const channelId = selectedChannel.value
    const text = realStreamState.sent
    realStreamState.active = false
    realStreamState.sent = ''
    realStreamEpoch += 1
    if (!hadStream || !botId || !channelId) return
    try {
      await (send as any)('stream-message', { action: 'end', selfId: botId, channelId, content: text })
    } catch { /* 收尾失败时静默忽略 */ }
  }

  // 真流式：把“打字停顿后新增的全文”作为分片发给 QQ
  const flushRealFragment = async () => {
    realFlushTimer = null
    if (realFlushInFlight) {
      // 上一个分片还在路上：稍后重试，避免乱序覆盖全文
      if (!realFlushTimer) realFlushTimer = setTimeout(() => { void flushRealFragment() }, 300)
      return
    }
    if (streamMode.value !== 'real' || !isDirectChat.value) return
    const botId = selectedBot.value
    const channelId = selectedChannel.value
    const content = mentionToPlainText(stripFaceText(inputText.value))
    if (!botId || !channelId || !content.trim()) return
    const epoch = realStreamEpoch
    const sent = realStreamState.sent
    // 若期间发生过删除 / 改写导致不再是“纯增量”，则本次不发送任何分片
    if (sent && !(content.length > sent.length && content.startsWith(sent))) return
    const action = realStreamState.active ? 'append' : 'begin'
    realFlushInFlight = true
    try {
      const res = await (send as any)('stream-message', { action, selfId: botId, channelId, content })
      // 若期间用户已结束 / 切换会话，迟到响应直接丢弃，不复活已结束的流
      if (realStreamEpoch !== epoch || streamMode.value !== 'real'
        || selectedBot.value !== botId || selectedChannel.value !== channelId) return
      if (res?.success) {
        realStreamState.active = true
        realStreamState.sent = content
      } else {
        ElMessage.error(res?.error || '真流式分片发送失败')
        realStreamState.active = false
        realStreamState.sent = ''
        streamMode.value = 'off'
        realStreamEpoch += 1
      }
    } finally {
      realFlushInFlight = false
    }
  }

  // 真流式：切换模式
  const toggleStreamMode = () => {
    // 先收尾当前模式可能未结束的真流式
    if (streamMode.value === 'real' && (realStreamState.active || realStreamState.sent)) void cancelRealStream()
    if (!isDirectChat.value) {
      streamMode.value = 'off'
      return
    }
    const order: StreamMode[] = ['off', 'fake', 'real']
    const idx = Math.max(0, order.indexOf(streamMode.value))
    streamMode.value = order[(idx + 1) % order.length]
  }

  // 假流式分片：按随机长度切片（优先在标点/空白处断开，拼接后与原文一致）
  const splitFakeChunks = (text: string) => {
    const chunks: string[] = []
    let rest = text
    while (rest.length) {
      let size = streamRandomDelay(4, 10)
      if (size >= rest.length) {
        chunks.push(rest)
        break
      }
      const slice = rest.slice(0, size)
      let cut = -1
      for (const ch of ['\n', '。', '！', '？', '，', '、', '；', '.', '!', '?', ',', ' ', ';', '：', ':']) {
        const at = slice.lastIndexOf(ch)
        if (at > 2) cut = Math.max(cut, at)
      }
      if (cut > 0) size = cut + 1
      chunks.push(rest.slice(0, size))
      rest = rest.slice(size)
    }
    return chunks.filter(c => c.length > 0)
  }

  // 假流式：点击“发送”后把整段文字按 QQ stream_messages 以随机间隔分片发出。
  // 与真流式的区别：输入阶段不发送任何内容，因此发送前可以随意修改错字；
  // 点击发送后才在 QQ 端模拟“逐字/逐句生成”的流式效果。
  const sendFakeStream = async () => {
    if (fakeStreamBusy.value) return
    if (!selectedBot.value || !selectedChannel.value || !isDirectChat.value) return
    const botId = selectedBot.value
    const channelId = selectedChannel.value
    const content = mentionToPlainText(stripFaceText(inputText.value))
    if (!content.trim()) return
    // 先按随机长度切块，再算出每块对应的“已累计全文”前缀
    const chunks = splitFakeChunks(content)
    const prefixes: string[] = []
    let acc = ''
    for (const c of chunks) { acc += c; prefixes.push(acc) }
    if (!prefixes.length) prefixes.push(content)
    fakeStreamBusy.value = true
    isSending.value = true
    let sentPrefix = ''
    try {
      for (let i = 0; i < prefixes.length; i++) {
        // 期间切走频道 / 退出假流式 → 停止后续分片
        if (selectedBot.value !== botId || selectedChannel.value !== channelId || streamMode.value !== 'fake') break
        const action = i === 0 ? 'begin' : 'append'
        const res = await (send as any)('stream-message', { action, selfId: botId, channelId, content: prefixes[i] })
        if (!res?.success) {
          ElMessage.error(`假流式第 ${i + 1}/${prefixes.length} 段发送失败：${res?.error || '未知错误'}`)
          break
        }
        sentPrefix = prefixes[i]
        // 随机停顿，模拟“打字中”的节奏
        if (i < prefixes.length - 1) {
          await new Promise(resolve => setTimeout(resolve, streamRandomDelay(300, 1000)))
        }
      }
      // 无论完整发完还是中途停止，都要把这条流式消息正常闭合（input_state=10）
      if (sentPrefix) {
        const completed = sentPrefix === content
        const end = await (send as any)('stream-message', { action: 'end', selfId: botId, channelId, content: sentPrefix })
        if (end?.success) {
          if (completed && selectedBot.value === botId && selectedChannel.value === channelId && streamMode.value === 'fake') {
            inputText.value = ''
            replyingTo.value = null
            scrollToBottom()
          } else if (!completed) {
            ElMessage.warning('假流式已中断，已发出的部分已正常收尾，剩余文字保留在输入框')
          }
        } else {
          ElMessage.error(end?.error || '假流式收尾失败，请重试')
        }
      } else if (streamMode.value === 'fake' && selectedBot.value === botId && selectedChannel.value === channelId) {
        // 首个分片都没发出去：循环内已提示具体错误，此处无需处理
      }
    } finally {
      isSending.value = false
      fakeStreamBusy.value = false
    }
  }

  // 真流式：监听输入框变化，只对“纯新增”文字发送分片（删除/改写不处理）
  watch(inputText, (text: string) => {
    // 非私聊或非真流式：复位任何残留流式状态
    if (streamMode.value !== 'real' || !isDirectChat.value || !selectedBot.value || !selectedChannel.value) {
      if (realStreamState.active || realStreamState.sent) void cancelRealStream()
      else {
        if (realFlushTimer) { clearTimeout(realFlushTimer); realFlushTimer = null }
        if (realEndTimer) { clearTimeout(realEndTimer); realEndTimer = null }
      }
      return
    }
    if (!text.trim()) {
      // 清空输入 = 删除文字：不发送分片；短暂延迟后自动收尾残留流
      if (realFlushTimer) { clearTimeout(realFlushTimer); realFlushTimer = null }
      if (!realStreamState.active && !realStreamState.sent) return
      if (realEndTimer) return
      realEndTimer = setTimeout(() => {
        realEndTimer = null
        void cancelRealStream()
      }, 1500)
      return
    }
    if (realEndTimer) { clearTimeout(realEndTimer); realEndTimer = null }
    const sent = realStreamState.sent
    // 仅当为“纯增量”（已下发全文上继续追加）才调度分片；删除 / 改写一律不处理
    const isGrowth = !sent || (text.length > sent.length && text.startsWith(sent))
    if (!isGrowth) return
    if (realFlushTimer) clearTimeout(realFlushTimer)
    realFlushTimer = setTimeout(() => {
      void flushRealFragment()
    }, streamRandomDelay(250, 650))
  })


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
    // 复读是直接发到 QQ 的，沙盒模式下会绕过沙盒：按钮已经隐藏，这里再兜一层
    if (sandboxMode.value) {
      ElMessage.warning('沙盒模式下不能直接复读到 QQ，请用回复下的「发送到当前频道 / 编辑后发送」')
      return
    }

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
      hasMedia: false,
      data: null,
      channel,
      submenu: ''
    }
  }

  // 头像右键菜单（QQ：发送消息 / @TA / 查看资料 / 复制昵称）
  const onUserMenu = (e: MouseEvent, msg: any) => {
    e.preventDefault()
    e.stopPropagation()
    menu.value = {
      show: true,
      x: e.clientX,
      y: e.clientY,
      type: 'user',
      id: msg.userId || '',
      botId: selectedBot.value,
      isPinned: false,
      hasMedia: false,
      targetRole: '',
      data: msg,
      channel: null,
      submenu: ''
    } as any
  }

  // 消息右键菜单：每次右键都在光标位置打开，避免"关掉后再开"的重复点击
  const onMessageMenu = async (e: MouseEvent, msg: any) => {
    e.preventDefault()
    e.stopPropagation()

    const hasMedia = msg.elements?.some((el: any) => ['image', 'img', 'mface', 'audio', 'video'].includes(el.type))
    // 菜单一打开就预取图片，点「复制」时能立刻写剪贴板（保留用户手势）
    const menuImages = extractImageUrls(msg)
    if (menuImages.length) prefetchImageBlob(menuImages[0], `${msg.selfId || selectedBot.value}:${msg.channelId || selectedChannel.value}`)
    menu.value = {
      show: true,
      x: e.clientX,
      y: e.clientY,
      type: 'message',
      id: msg.id,
      isPinned: false,
      data: msg,
      hasMedia,
      targetRole: '',
      channel: null,
      submenu: ''
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
    } else if (action === 'copy-id') {
      await copyToClipboard(String(id))
      ElMessage.success('已复制群号')
    } else if (action === 'mark-unread') {
      const key = `${botId}:${id}`
      unreadCounts[key] = Math.max(1, Number(unreadCounts[key] || 0))
      refreshTitle()
      ElMessage.success('已标记为未读')
    } else if (action === 'mark-read') {
      unreadCounts[`${botId}:${id}`] = 0
      atMeCounts[`${botId}:${id}`] = 0
      refreshTitle()
    } else if (action === 'open-standalone') {
      // 独立窗口走 /qq-chat/window，只渲染这一个频道（不带控制台外壳）
      const url = `${location.origin}/qq-chat/window?bot=${encodeURIComponent(botId)}&channel=${encodeURIComponent(String(id))}`
      window.open(url, '_blank', 'width=1040,height=760,menubar=no,toolbar=no')
    } else if (action === 'open-sandbox') {
      // 沙盒窗口走 /qq-chat/sandbox：同样是聊天界面，但消息只在本机执行，回复按元素转发
      const url = `${location.origin}/qq-chat/sandbox?bot=${encodeURIComponent(botId)}&channel=${encodeURIComponent(String(id))}`
      window.open(url, '_blank', 'width=1040,height=760,menubar=no,toolbar=no')
    } else if (action === 'open-sandbox-console') {
      // 直接用控制台主页面的沙盒模式（连控制台外壳都是主界面原样）
      const url = `${location.origin}/qq-chat?sandbox=1&bot=${encodeURIComponent(botId)}&channel=${encodeURIComponent(String(id))}`
      window.open(url, '_blank', 'width=1280,height=860,menubar=no,toolbar=no')
    } else if (action === 'remove-channel') {
      hiddenChannels.value = [...new Set([...hiddenChannels.value, `${botId}:${id}`])]
      saveHiddenChannels()
      if (selectedChannel.value === id) selectedChannel.value = ''
      ElMessage.success('已从消息列表中移除（收到新消息会重新出现）')
    } else if (action === 'clear-history') {
      if (type === 'channel') {
        await (send as any)('clear-channel-history', { selfId: botId, channelId: id })
        ElMessage.success('已清空该频道历史消息')
      }
    }
  }

  // ===== 收藏（本地 localStorage，QQ 右键菜单的「收藏」） =====
  const FAVORITES_KEY = 'qq-chat:favorites'
  const favorites = ref<any[]>([])
  const favoritesVisible = ref(false)
  const loadFavorites = () => {
    try {
      favorites.value = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]')
    } catch {
      favorites.value = []
    }
  }
  const persistFavorites = () => {
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites.value))
    } catch { /* 忽略写入失败 */ }
  }
  loadFavorites()

  const messagePlainText = (msg: any) => String(msg?.content || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .trim()

  // 收藏项类型：图片 / 语音 / 视频 / 文件 / 卡片 / 文本
  const favoriteKind = (msg: any) => {
    const types = new Set(((msg?.elements || []) as any[]).map(el => String(el?.type || '')))
    const content = String(msg?.content || '')
    if (types.has('audio') || /<audio\b/i.test(content)) return 'audio'
    if (types.has('video') || /<video\b/i.test(content)) return 'video'
    if (types.has('file') || /<file\b/i.test(content)) return 'file'
    if (types.has('img') || types.has('image') || types.has('mface') || /<img\b/i.test(content) || /<faceType\b/i.test(content)) return 'image'
    if (types.has('forward') || types.has('json') || /<(json|forward)\b/i.test(content)) return 'card'
    return 'text'
  }

  // 收藏时把整条消息（含元素）快照下来，收藏列表才能还原图片/语音/视频/文件
  const snapshotElements = (msg: any) => {
    const els = Array.isArray(msg?.elements) ? msg.elements : []
    if (!els.length) return []
    try {
      const json = JSON.stringify(els)
      const picked = json.length > 20000 ? els.slice(0, 3) : els
      return JSON.parse(JSON.stringify(picked))
    } catch {
      return []
    }
  }

  const addFavorite = (msg: any) => {
    if (!msg) return
    const plain = messagePlainText(msg)
    const elements = snapshotElements(msg)
    if (!plain && !elements.length) {
      ElMessage.warning('这条消息没有可收藏的内容')
      return
    }
    const key = `${msg.channelId || ''}:${msg.id || Date.now()}`
    if (favorites.value.some(f => f.key === key)) {
      ElMessage.info('已经收藏过这条消息了')
      return
    }
    favorites.value = [{
      key,
      id: msg.id,
      selfId: msg.selfId || selectedBot.value,
      channelId: msg.channelId,
      channelName: currentChannelName.value,
      username: msg.username,
      avatar: msg.avatar,
      content: msg.content || '',
      plain,
      elements,
      kind: favoriteKind(msg),
      timestamp: msg.timestamp || Date.now()
    }, ...favorites.value].slice(0, 300)
    persistFavorites()
    ElMessage.success('已收藏')
  }

  // 打开收藏面板时预取图片收藏的像素
  const prefetchFavoriteImage = (fav: any) => {
    const imgs = extractImageUrls(fav)
    if (imgs.length) prefetchImageBlob(imgs[0], `${fav?.selfId || ''}:${fav?.channelId || ''}`)
  }

  // 收藏项「复制」：图片收藏复制图片，其余复制文本
  const copyFavorite = async (fav: any) => {
    if (!fav) return
    const images = extractImageUrls(fav)
    const text = String(fav.plain || fav.content || '').replace(/<[^>]+>/g, '').trim()
    if (images.length) {
      try {
        await copyImageToClipboard(images[0], `${fav.selfId || ''}:${fav.channelId || ''}`, text, `.chat-fav-item[data-key="${fav.key}"] img`)
        ElMessage.success('已复制图片到剪贴板')
        return
      } catch {
        try {
          await copyToClipboard(images[0])
          ElMessage.warning('浏览器不允许写入图片，已改为复制图片地址')
          return
        } catch { /* 落到文本 */ }
      }
    }
    if (!text) {
      ElMessage.warning('这条收藏没有可复制的文本')
      return
    }
    await copyToClipboard(text)
    ElMessage.success('已复制到剪贴板')
  }

  const removeFavorite = (key: string) => {
    favorites.value = favorites.value.filter(f => f.key !== key)
    persistFavorites()
  }

  const clearFavorites = () => {
    favorites.value = []
    persistFavorites()
    ElMessage.success('已清空收藏')
  }

  // ===== 多选（QQ 右键菜单的「多选」） =====
  const multiMode = ref(false)
  const multiSelected = ref<string[]>([])
  const toggleMultiMode = () => {
    multiMode.value = !multiMode.value
    if (!multiMode.value) multiSelected.value = []
  }
  const isMultiSelected = (id: string) => multiSelected.value.includes(id)
  const toggleMultiSelect = (id: string) => {
    multiSelected.value = multiSelected.value.includes(id)
      ? multiSelected.value.filter(x => x !== id)
      : [...multiSelected.value, id]
  }
  const multiMessages = computed(() => currentMessages.value.filter((m: any) => multiSelected.value.includes(m.id)))
  const exitMultiMode = () => {
    multiMode.value = false
    multiSelected.value = []
  }
  const deleteMultiLocal = () => {
    const list = multiMessages.value
    if (!list.length) {
      ElMessage.warning('先选择要删除的消息')
      return
    }
    for (const m of list) removeMessage(selectedBot.value, selectedChannel.value, (m as any).id)
    ElMessage.success(`已从本地移除 ${list.length} 条消息`)
    exitMultiMode()
  }
  const copyMulti = async () => {
    const list = multiMessages.value
    if (!list.length) {
      ElMessage.warning('先选择要复制的消息')
      return
    }
    // 只选了一条且是图片：按图片复制
    if (list.length === 1) {
      const only = list[0] as any
      const images = extractImageUrls(only)
      if (images.length) {
        try {
          await copyImageToClipboard(images[0], `${only.selfId || selectedBot.value}:${only.channelId || selectedChannel.value}`, messagePlainText(only), `.chat-row[data-id="${only.id}"] .chat-bubble img`)
          ElMessage.success('已复制图片到剪贴板')
          exitMultiMode()
          return
        } catch { /* 落到文本复制 */ }
      }
    }
    const text = list.map((m: any) => `${m.username}: ${messagePlainText(m)}`).join('\n')
    await copyToClipboard(text)
    ElMessage.success(`已复制 ${list.length} 条消息`)
  }
  const forwardMulti = () => {
    const list = multiMessages.value
    if (!list.length) {
      ElMessage.warning('先选择要转发的消息')
      return
    }
    openForwardDialog(list as any[])
  }

  // ===== 转发（QQ「转发到」对话框） =====
  const forwardToVisible = ref(false)
  const forwardSource = ref<any[]>([])
  const forwardTargets = ref<string[]>([])
  const forwardNote = ref('')
  const forwardKeyword = ref('')
  const forwardSending = ref(false)

  const openForwardDialog = (msgs: any[]) => {
    // 转发是真发到目标频道：沙盒模式下入口已隐藏，这里再兜一层
    if (sandboxMode.value) {
      ElMessage.warning('沙盒模式下不能转发到频道，请用回复下的「发送到当前频道 / 编辑后发送」')
      return
    }
    forwardSource.value = msgs || []
    forwardTargets.value = []
    forwardNote.value = ''
    forwardKeyword.value = ''
    forwardToVisible.value = true
  }

  const forwardCandidates = computed(() => currentChannels.value.filter((c: any) => {
    const kw = forwardKeyword.value.trim()
    return !kw || String(c.name || '').includes(kw) || String(c.id || '').includes(kw)
  }))

  const isForwardTarget = (key: string) => forwardTargets.value.includes(key)
  const toggleForwardTarget = (key: string) => {
    forwardTargets.value = isForwardTarget(key)
      ? forwardTargets.value.filter(k => k !== key)
      : [...forwardTargets.value, key]
  }

  const forwardTextPreview = computed(() => forwardSource.value
    .map((m: any) => messagePlainText(m))
    .filter(Boolean)
    .join('\n'))

  const confirmForward = async () => {
    if (sandboxMode.value) {
      ElMessage.warning('沙盒模式下不能转发到频道')
      return
    }
    if (!forwardTargets.value.length) {
      ElMessage.warning('请先选择转发目标')
      return
    }
    const msgs = forwardSource.value
    if (!msgs.length) return
    forwardSending.value = true
    let ok = 0
    let failed = 0
    try {
      for (const key of forwardTargets.value) {
        const idx = key.indexOf(':')
        const targetBot = key.slice(0, idx)
        const targetChannel = key.slice(idx + 1)
        const sendText = async (content: string) => {
          const res = await (send as any)('send-message', {
            selfId: targetBot,
            channelId: targetChannel,
            content,
            images: [],
            files: []
          })
          if (res?.success) ok += 1
          else failed += 1
        }
        for (const m of msgs) {
          const text = messagePlainText(m)
          if (text) await sendText(text)
        }
        // QQ 的「留言」是转发之后单独再发一条，不拼在正文里
        const note = forwardNote.value.trim()
        if (note) await sendText(note)
      }
      if (failed && !ok) ElMessage.error('转发失败')
      else if (failed) ElMessage.warning(`已转发 ${ok} 条，${failed} 条失败`)
      else ElMessage.success(`已转发到 ${forwardTargets.value.length} 个会话`)
      forwardToVisible.value = false
      exitMultiMode()
    } finally {
      forwardSending.value = false
    }
  }

  // ===== 群成员面板（QQ 官方群成员接口） =====
  const memberPanelVisible = ref(false)
  const memberPanelTab = ref<'members' | 'blacklist'>('members')
  const memberList = ref<any[]>([])
  const memberLoading = ref(false)
  const memberCursor = ref('')
  const memberKeyword = ref('')
  const memberManageMode = ref(false)
  const memberSelected = ref<string[]>([])
  const blacklist = ref<any[]>([])
  const blacklistLoading = ref(false)
  const blacklistCursor = ref('')

  // 群内禁言名单（用于成员面板标记 / 右键「解除禁言」）
  const mutedMembers = ref<string[]>([])
  const loadMutedMembers = async () => {
    if (!selectedBot.value || !selectedChannel.value) return
    try {
      const res = await (send as any)('get-muted-members', {
        selfId: selectedBot.value,
        channelId: selectedChannel.value
      })
      mutedMembers.value = res?.success ? (res.members || []).map((m: any) => m.member_openid).filter(Boolean) : []
    } catch {
      mutedMembers.value = []
    }
  }
  const isMemberMuted = (openid: string) => mutedMembers.value.includes(openid)

  const memberName = (m: any) => {
    const id = m?.member_openid || ''
    return m?.username || userNames.value[id] || (id ? id.slice(0, 10) + '…' : '未知成员')
  }

  const filteredMembers = computed(() => {
    const kw = memberKeyword.value.trim().toLowerCase()
    if (!kw) return memberList.value
    return memberList.value.filter((m: any) => memberName(m).toLowerCase().includes(kw) || String(m.member_openid || '').toLowerCase().includes(kw))
  })

  const memberCount = computed(() => memberList.value.length)

  const loadGroupMembers = async (reset = true) => {
    if (!selectedBot.value || !selectedChannel.value || memberLoading.value) return
    memberLoading.value = true
    try {
      const res = await (send as any)('get-group-members', {
        selfId: selectedBot.value,
        channelId: selectedChannel.value,
        cursor: reset ? '' : memberCursor.value
      })
      if (!res?.success) {
        ElMessage.error(res?.error || '获取群成员列表失败')
        return
      }
      memberList.value = reset ? res.members : [...memberList.value, ...res.members]
      memberCursor.value = res.nextCursor || ''
    } catch (e) {
      ElMessage.error('获取群成员列表失败')
    } finally {
      memberLoading.value = false
    }
  }

  const loadBlacklist = async (reset = true) => {
    if (!selectedBot.value || !selectedChannel.value || blacklistLoading.value) return
    blacklistLoading.value = true
    try {
      const res = await (send as any)('get-group-blacklist', {
        selfId: selectedBot.value,
        channelId: selectedChannel.value,
        cursor: reset ? '' : blacklistCursor.value,
        limit: 50
      })
      if (!res?.success) {
        ElMessage.error(res?.error || '获取群黑名单失败')
        return
      }
      blacklist.value = reset ? res.users : [...blacklist.value, ...res.users]
      blacklistCursor.value = res.nextCursor || ''
    } catch (e) {
      ElMessage.error('获取群黑名单失败')
    } finally {
      blacklistLoading.value = false
    }
  }

  const toggleMemberPanel = () => {
    memberPanelVisible.value = !memberPanelVisible.value
    if (memberPanelVisible.value) {
      if (memberPanelTab.value === 'members' && !memberList.value.length) void loadGroupMembers(true)
      if (memberPanelTab.value === 'blacklist' && !blacklist.value.length) void loadBlacklist(true)
      void loadMutedMembers()
    }
  }

  const switchMemberTab = (tab: 'members' | 'blacklist') => {
    memberPanelTab.value = tab
    memberSelected.value = []
    if (tab === 'members' && !memberList.value.length) void loadGroupMembers(true)
    if (tab === 'blacklist' && !blacklist.value.length) void loadBlacklist(true)
  }

  const isMemberSelected = (id: string) => memberSelected.value.includes(id)
  const toggleMemberSelect = (id: string) => {
    memberSelected.value = memberSelected.value.includes(id)
      ? memberSelected.value.filter(x => x !== id)
      : [...memberSelected.value, id]
  }
  const exitMemberManage = () => {
    memberManageMode.value = false
    memberSelected.value = []
  }

  const batchRemoveMembers = async (addToBlacklist = false) => {
    const ids = memberSelected.value.slice(0, 20)
    if (!ids.length) {
      ElMessage.warning('请先勾选要移出的成员')
      return
    }
    try {
      await ElMessageBox.confirm(`确定把选中的 ${ids.length} 位成员移出本群吗？${addToBlacklist ? '（同时加入黑名单）' : ''}`, '移出群成员', { type: 'warning' })
    } catch {
      return
    }
    const res = await (send as any)('batch-remove-group-members', {
      selfId: selectedBot.value,
      channelId: selectedChannel.value,
      memberOpenids: ids,
      addToBlacklist
    })
    if (res?.success) {
      ElMessage.success(`已移出 ${ids.length} 位成员`)
      memberList.value = memberList.value.filter((m: any) => !ids.includes(m.member_openid))
      exitMemberManage()
    } else {
      ElMessage.error(res?.error || '移出群成员失败')
    }
  }

  const setBlacklist = async (op: 'add' | 'del', ids: string[]) => {
    const list = (ids || []).slice(0, 20)
    if (!list.length) {
      ElMessage.warning('请先选择成员')
      return
    }
    const res = await (send as any)('set-group-blacklist', {
      selfId: selectedBot.value,
      channelId: selectedChannel.value,
      op,
      memberOpenids: list
    })
    if (res?.success) {
      ElMessage.success(op === 'add' ? `已加入黑名单 ${list.length} 人` : `已移出黑名单 ${list.length} 人`)
      if (op === 'del') blacklist.value = blacklist.value.filter((u: any) => !list.includes(u.member_openid))
      if (op === 'add') void loadBlacklist(true)
      memberSelected.value = []
    } else {
      ElMessage.error(res?.error || (op === 'add' ? '加入黑名单失败' : '移出黑名单失败'))
    }
  }

  const memberApiAction = async (action: string, member: any) => {
    const id = member?.member_openid
    if (!id) return
    if (action === 'member-profile') {
      await showUserProfile({ userId: id, username: memberName(member), guildId: selectedChannel.value })
    } else if (action === 'member-mention') {
      if (inputText.value && !/[\s]$/.test(inputText.value)) inputText.value += ' '
      inputText.value += `<qqbot-at-user id="${id}" name="${String(memberName(member)).replace(/"/g, '&quot;')}"/>`
      nextTick(() => focusChatInput())
    } else if (action === 'member-copy-id') {
      await copyToClipboard(id)
      ElMessage.success('已复制成员 OpenID')
    } else if (action === 'member-remove') {
      try {
        await ElMessageBox.confirm(`确定把 ${memberName(member)} 移出本群吗？`, '移出群成员', { type: 'warning' })
      } catch {
        return
      }
      const res = await (send as any)('batch-remove-group-members', {
        selfId: selectedBot.value,
        channelId: selectedChannel.value,
        memberOpenids: [id]
      })
      if (res?.success) {
        ElMessage.success('已移出该成员')
        memberList.value = memberList.value.filter((m: any) => m.member_openid !== id)
      } else {
        ElMessage.error(res?.error || '移出群成员失败')
      }
    } else if (action === 'member-private') {
      await selectChannel(`private:${id}`, selectedBot.value)
      if (isMobile.value) mobileView.value = 'messages'
    } else if (action === 'member-mute') {
      const expire = Date.now() + 3600000
      const res = await (send as any)('mute-user', {
        selfId: selectedBot.value,
        channelId: selectedChannel.value,
        memberOpenid: id,
        muteExpireAt: expire
      })
      if (res?.success) {
        mutedMembers.value = [...new Set([...mutedMembers.value, id])]
        ElMessage.success(`已屏蔽 ${memberName(member)} 发言（1 小时）`)
      } else {
        ElMessage.error(res?.error || '禁言失败')
      }
    } else if (action === 'member-unmute') {
      const res = await (send as any)('mute-user', {
        selfId: selectedBot.value,
        channelId: selectedChannel.value,
        memberOpenid: id,
        muteExpireAt: null
      })
      if (res?.success) {
        mutedMembers.value = mutedMembers.value.filter(x => x !== id)
        ElMessage.success('已解除禁言')
      } else {
        ElMessage.error(res?.error || '解除禁言失败')
      }
    } else if (action === 'member-blacklist-add') {
      await setBlacklist('add', [id])
    } else if (action === 'member-blacklist-del') {
      await setBlacklist('del', [id])
    }
  }

  // 成员右键菜单
  const onMemberMenu = (e: MouseEvent, member: any) => {
    e.preventDefault()
    e.stopPropagation()
    menu.value = {
      show: true,
      x: e.clientX,
      y: e.clientY,
      type: 'member',
      id: member?.member_openid || '',
      botId: selectedBot.value,
      isPinned: false,
      hasMedia: false,
      targetRole: member?.member_role || '',
      data: member,
      channel: null,
      submenu: ''
    } as any
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

  // ===== 复制图片（真正写进剪贴板的图片，而不是文本） =====

  // 从消息 / 收藏项里取出所有图片地址（元素 + 序列化标签两条路）
  const extractImageUrls = (msg: any): string[] => {
    const urls: string[] = []
    const push = (u: any) => {
      const s = String(u || '').trim()
      if (!s) return
      if (!urls.includes(s)) urls.push(s)
    }
    const IMG_RE = /\.(png|jpe?g|gif|webp|bmp|avif|apng|svg)(?:$|\?)/i
    for (const el of (msg?.elements || []) as any[]) {
      if (!el) continue
      const type = String(el.type || '')
      const attrs = el.attrs || {}
      const url = attrs.src || attrs.url || attrs.file
      if (['img', 'image', 'mface'].includes(type)) push(url)
      else if (type === 'file' && IMG_RE.test(String(url || ''))) push(url)
    }
    const content = String(msg?.content || '')
    let m: RegExpExecArray | null
    const reImg = /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)')/gi
    while ((m = reImg.exec(content))) push(m[1] || m[2])
    const reFile = /<file\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)')/gi
    while ((m = reFile.exec(content))) {
      const u = m[1] || m[2] || ''
      if (IMG_RE.test(u)) push(u)
    }
    return urls
  }

  // 取回图片像素：优先走服务端缓存（同源，跨域图片也能拿到），再转成 png
  const urlToPngBlob = async (url: string, channelKey?: string): Promise<Blob | null> => {
    let src = url
    if (channelKey && /^https?:/i.test(url)) {
      try {
        const cached = await getCachedImageUrl(channelKey, url)
        if (cached) src = cached
        else {
          const fresh = await cacheImage(channelKey, url)
          if (fresh) src = fresh
        }
      } catch { /* 缓存失败就直连试试 */ }
    }
    const res = await fetch(src, { credentials: 'include' })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const blob = await res.blob()
    if (blob.type === 'image/png') return blob
    const bitmap = await createImageBitmap(blob)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas-unavailable')
    ctx.drawImage(bitmap, 0, 0)
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  }

  // 图片 blob 缓存：右键菜单打开时就预取，点「复制」时能立刻写入剪贴板
  const imageBlobCache = new Map<string, Promise<Blob | null>>()
  const prefetchImageBlob = (url: string, channelKey?: string) => {
    if (!url) return
    if (!imageBlobCache.has(url)) {
      imageBlobCache.set(url, urlToPngBlob(url, channelKey).catch(() => null))
    }
  }

  // 兜底：直接复制已经渲染出来的 <img>（剪贴板 API 被拒时仍能拿到图片）
  const copyRenderedImage = (selector: string) => {
    const source = document.querySelector(selector) as HTMLImageElement | null
    if (!source || !source.complete || !source.naturalWidth) return false
    const holder = document.createElement('div')
    holder.contentEditable = 'true'
    holder.style.cssText = 'position:fixed;left:-99999px;top:0;opacity:0'
    const clone = document.createElement('img')
    clone.src = source.currentSrc || source.src
    holder.appendChild(clone)
    document.body.appendChild(holder)
    try {
      const range = document.createRange()
      range.selectNodeContents(holder)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
      const ok = document.execCommand('copy')
      sel?.removeAllRanges()
      return ok
    } catch {
      return false
    } finally {
      holder.remove()
    }
  }

  const copyImageToClipboard = async (url: string, channelKey?: string, text?: string, domSelector?: string) => {
    const ClipboardItemCtor = (window as any).ClipboardItem
    let lastError: any = null
    if (navigator.clipboard && typeof ClipboardItemCtor === 'function') {
      try {
        const cached = imageBlobCache.get(url)
        const png = cached ? await cached : await urlToPngBlob(url, channelKey)
        if (png) {
          try {
            const data: Record<string, Blob> = { 'image/png': png }
            if (text) data['text/plain'] = new Blob([text], { type: 'text/plain' })
            await navigator.clipboard.write([new ClipboardItemCtor(data)])
            return
          } catch {
            // 有些浏览器一次只接受一种类型
            await navigator.clipboard.write([new ClipboardItemCtor({ 'image/png': png })])
            return
          }
        }
      } catch (err) {
        lastError = err
      }
    }
    if (domSelector && copyRenderedImage(domSelector)) return
    throw lastError || new Error('copy-image-failed')
  }

  const handleMessageAction = async (action: string) => {
    const msg = (menu.value as any).data
    menu.value.show = false
    if (!msg) return

    if (action === 'copy') {
      // 移除 HTML 标签，但保留 [face:n] 格式
      let text = (msg.content || '').replace(/<[^>]+>/g, '')
      // 将 <faceType=3> 替换为 [face:n]
      text = text.replace(/<faceType=3>/gi, '[表情]').trim()
      // 带图片的消息：优先把真正的图片写进剪贴板（文本一起带上，粘到输入框仍然是文字）
      const images = extractImageUrls(msg)
      if (images.length) {
        try {
          await copyImageToClipboard(images[0], `${msg.selfId || selectedBot.value}:${msg.channelId || selectedChannel.value}`, text, `.chat-row[data-id="${msg.id}"] .chat-bubble img`)
          ElMessage.success('已复制图片到剪贴板')
        } catch {
          try {
            await copyToClipboard(images[0])
            ElMessage.warning('浏览器不允许写入图片，已改为复制图片地址')
          } catch {
            ElMessage.error('复制图片失败')
          }
        }
      } else if (!text) {
        ElMessage.warning('未复制任何内容')
      } else {
        copyToClipboard(text).then(() => ElMessage.success('已复制到剪贴板'))
      }
    } else if (action === 'copy-raw') {
      // 查看原始消息报文：直接给出服务端/适配器返回的整条消息对象
      try {
        rawMessage.content = JSON.stringify(msg, null, 2)
      } catch {
        rawMessage.content = String(msg?.content || '')
      }
      if (isMobile.value) {
        mobileView.value = 'raw'
      } else {
        rawMessageVisible.value = true
      }
    } else if (action === 'plus1') {
      await repeatMessage(msg)
    } else if (action === 'mention') {
      // 右键菜单：@ 该成员，填入输入框
      const uid = msg.userId
      const uname = msg.username
      if (!uid || uid === msg.selfId || uid === 'system' || isDirectChat.value) return
      const esc = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      const label = uname && uname !== 'unknown' && uname !== '系统消息' ? uname : uid
      if (inputText.value && !/[\s]$/.test(inputText.value)) inputText.value += ' '
      inputText.value += `<qqbot-at-user id="${esc(uid)}" name="${esc(label)}"/>`
      nextTick(() => focusChatInput())
    } else if (action === 'reply') {
      replyingTo.value = msg
      // 自动聚焦输入框
      nextTick(() => {
        focusChatInput()
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
    } else if (action === 'forward') {
      openForwardDialog([msg])
    } else if (action === 'favorite') {
      addFavorite(msg)
    } else if (action === 'multi') {
      // 多选主要用于批量转发（真发到频道），沙盒模式下不开放
      if (sandboxMode.value) {
        ElMessage.warning('沙盒模式下不能用多选转发')
        return
      }
      multiMode.value = true
      if (!multiSelected.value.includes(msg.id)) multiSelected.value = [...multiSelected.value, msg.id]
    } else if (action === 'delete-local') {
      removeMessage(selectedBot.value, selectedChannel.value, msg.id)
      ElMessage.success('已从本地列表移除')
    } else if (action === 'profile') {
      await showUserProfile(msg)
    } else if (action === 'copy-name') {
      await copyToClipboard(msg.username || msg.userId || '')
      ElMessage.success('已复制昵称')
    } else if (action === 'private') {
      const openid = String(msg.userId || '')
      if (!openid || openid === 'system' || msg.isBot || openid === selectedBot.value) {
        ElMessage.warning('无法与该用户私聊')
        return
      }
      await selectChannel(`private:${openid}`, selectedBot.value)
      if (isMobile.value) mobileView.value = 'messages'
    }
  }

  // 显示用户资料
  const showUserProfile = async (msg: any) => {
    if (!selectedBot.value) return

    // 自己（机器人）的消息：直接用机器人资料，避免接口查不到导致没头像 / 显示 openid
    const isSelf = !!(msg?.isBot || msg?.type === 'bot' || msg?.userId === selectedBot.value)
    if (isSelf) {
      const bot: any = (bots.value as any[]).find(b => b.selfId === (msg?.selfId || selectedBot.value))
      userProfile.data = {
        username: bot?.username || botName(selectedBot.value),
        name: bot?.username || botName(selectedBot.value),
        avatar: bot?.avatar || msg?.avatar || '',
        userId: msg?.userId || selectedBot.value,
        id: msg?.userId || selectedBot.value
      }
      if (isMobile.value) mobileView.value = 'profile'
      else userProfileVisible.value = true
      return
    }

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
      const file = items[i].getAsFile?.()
      // 有些系统粘贴 gif 时拿不到 MIME，这里按文件名兜底
      const looksImage = items[i].type.indexOf('image') !== -1
        || (!!file && /\.(png|jpe?g|gif|webp|bmp|avif|apng|svg)$/i.test(file.name || ''))
      if (looksImage) {
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

  // 把 dataURL 图片加入待发送列表（粘贴图片 / 截图共用）
  const uploadImageDataUrl = async (dataUrl: string, filename?: string) => {
    const name = filename || `image_${Date.now()}.png`
    try {
      const res = await (send as any)('upload-image', {
        file: dataUrl,
        filename: name,
        mimeType: 'image/png'
      })
      if (res?.success) {
        uploadedImages.value.push({ tempId: res.tempId, preview: dataUrl, filename: name })
        return true
      }
      ElMessage.error(res?.error || '图片上传失败')
      return false
    } catch (e) {
      ElMessage.error('图片上传失败')
      return false
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

    // 为输入框添加事件监听（兼容旧 textarea 与新富文本输入框）
    nextTick(() => {
      const target = (inputRef.value as any)?.$el?.querySelector?.('textarea') || inputRef.value
      if (target && typeof target.addEventListener === 'function') {
        target.addEventListener('focus', handleFocus)
        target.addEventListener('blur', handleBlur)
        dispose.push(() => {
          target.removeEventListener('focus', handleFocus)
          target.removeEventListener('blur', handleBlur)
        })
      }
    })

    // 初始化 history state
    if (isMobile.value) {
      window.history.replaceState({ view: mobileView.value }, '')
    }

    await loadConfig()
    await loadInitialData()

    // 沙盒窗口 / 控制台沙盒模式深链：/qq-chat/sandbox?bot=<selfId>&channel=<channelId>
    // 等基础数据加载完再进入，避免和 loadInitialData 抢频道选择
    if (sandboxMode.value) {
      try {
        const q = new URLSearchParams(location.search)
        const qBot = q.get('bot')
        const qChannel = q.get('channel')
        if (qBot && qChannel && (selectedBot.value !== qBot || selectedChannel.value !== String(qChannel))) {
          await enterSandbox(qChannel, qBot)
        } else {
          await resetSandboxSession()
        }
      } catch { /* 忽略非法 URL */ }
    }

    const d1 = receive('chat-message-event', (ev: any) => {
      addMessage(ev)
      markUnreadIfNotActive(ev)
      markAtMeIfNotActive(ev)
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
    // 卸载时收尾仍在进行的私聊真流式（best-effort）
    void cancelRealStream()
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
    isRawIdName,
    unreadCounts,
    atMeCounts,
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
    runBridgeCommand,
    bridgeRunning,
    commandResultVisible,
    commandResultText,
    commandResultCommand,
    commandResultSending,
    sendCommandResult,
    commandResultElements,
    removeCommandResultElement,
    // 沙盒窗口（/qq-chat/sandbox）
    sandboxMode,
    targetSelfId,
    targetChannelId,
    enterSandbox,
    sendSandboxMessage,
    sandboxSending,
    forwardSandboxMessage,
    sandboxForwarding,
    clearSandboxWindow,
    resetSandboxSession,
    elementEditorVisible,
    elementEditorText,
    elementEditorElements,
    elementEditorSending,
    elementEditorHint,
    openElementEditor,
    removeElementEditorItem,
    sendEditedElements,
    sandboxVisible,
    sandboxInput,
    sandboxImages,
    sandboxUploading,
    addSandboxImages,
    removeSandboxImage,
    sandboxRunning,
    sandboxMessages,
    openSandbox,
    clearSandbox,
    closeSandbox,
    runSandbox,
    forwardSandboxResult,
    // 流式发送（仅私聊）
    streamMode,
    isDirectChat,
    toggleStreamMode,
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
    setActiveChannel,
    unloadChannelMessages,
    repeatMessage,
    handlePaste,
    uploadImageDataUrl,
    copyToClipboard,
    onBotMenu,
    onChannelMenu,
    onMessageMenu,
    onUserMenu,
    handleMenuAction,
    handleMessageAction,
    showUserProfile,
    // 收藏 / 多选 / 转发
    favorites,
    favoritesVisible,
    copyFavorite,
    prefetchFavoriteImage,
    removeFavorite,
    clearFavorites,
    addFavorite,
    multiMode,
    multiSelected,
    toggleMultiMode,
    isMultiSelected,
    toggleMultiSelect,
    exitMultiMode,
    deleteMultiLocal,
    copyMulti,
    forwardMulti,
    forwardToVisible,
    forwardSource,
    forwardTargets,
    forwardNote,
    forwardKeyword,
    forwardCandidates,
    forwardSending,
    isForwardTarget,
    toggleForwardTarget,
    forwardTextPreview,
    confirmForward,
    openForwardDialog,
    // 频道列表隐藏
    hiddenChannels,
    // 群聊备注 / 免打扰 / 群聊天设置
    channelRemarks,
    mutedChannels,
    isChannelMuted,
    setChannelMuted,
    setChannelRemark,
    channelDisplayName,
    isReplyToBotEvent,
    replyMeCounts,
    channelSettingsVisible,
    channelSettings,
    openChannelSettings,
    saveChannelSettings,
    clearChannelHistory,
    // 群成员面板
    memberPanelVisible,
    memberPanelTab,
    memberList,
    memberLoading,
    memberKeyword,
    memberManageMode,
    memberSelected,
    blacklist,
    blacklistLoading,
    filteredMembers,
    memberCount,
    memberName,
    loadGroupMembers,
    loadBlacklist,
    toggleMemberPanel,
    switchMemberTab,
    isMemberSelected,
    toggleMemberSelect,
    exitMemberManage,
    batchRemoveMembers,
    setBlacklist,
    memberApiAction,
    onMemberMenu,
    mutedMembers,
    loadMutedMembers,
    isMemberMuted,
    inputRef,
    focusChatInput,
    scrollToMessage
  }
}