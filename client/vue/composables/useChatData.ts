import { ref, computed } from 'vue'
import { receive, send } from '@koishijs/client'
import type { ChatData, BotInfo, ChannelInfo, MessageInfo, PluginConfig } from '../types'

export function useChatData() {
  const chatData = ref<ChatData>({
    bots: {},
    channels: {},
    messages: {}
  })

  const pluginConfig = ref<PluginConfig>({
    maxMessagesPerChannel: 1000,
    loggerinfo: false,
    chatContainerHeight: 80,
    clearIndexedDBOnStart: true
  })

  const pinnedBots = ref<Set<string>>(new Set())
  const pinnedChannels = ref<Set<string>>(new Set())

  // 记录每个频道的分页状态
  const channelPagination = ref<Record<string, { offset: number, hasMore: boolean }>>({})

  // 计算属性
  const bots = computed(() => {
    return Object.values(chatData.value.bots).sort((a, b) => {
      const aPinned = pinnedBots.value.has(a.selfId)
      const bPinned = pinnedBots.value.has(b.selfId)
      return aPinned === bPinned ? 0 : aPinned ? -1 : 1
    })
  })

  const getChannels = (botId: string) => {
    if (!botId || !chatData.value.channels[botId]) return []
    return Object.values(chatData.value.channels[botId]).sort((a, b) => {
      const aPinned = pinnedChannels.value.has(`${botId}:${a.id}`)
      const bPinned = pinnedChannels.value.has(`${botId}:${b.id}`)
      return aPinned === bPinned ? 0 : aPinned ? -1 : 1
    })
  }

  // 所有机器人频道的扁平列表（合并所有机器人，每条带上所属机器人的 selfId）
  const allChannels = computed(() => {
    const list: (ChannelInfo & { selfId: string })[] = []
    for (const selfId of Object.keys(chatData.value.channels)) {
      for (const channel of Object.values(chatData.value.channels[selfId])) {
        list.push({ ...channel, selfId })
      }
    }
    return list.sort((a, b) => {
      const aPinned = pinnedChannels.value.has(`${a.selfId}:${a.id}`)
      const bPinned = pinnedChannels.value.has(`${b.selfId}:${b.id}`)
      return aPinned === bPinned ? 0 : aPinned ? -1 : 1
    })
  })

  const getMessages = (botId: string, channelId: string) => {
    const key = `${botId}:${channelId}`
    return chatData.value.messages[key] || []
  }

  const getPagination = (botId: string, channelId: string) => {
    const key = `${botId}:${channelId}`
    return channelPagination.value[key] || { offset: 0, hasMore: true }
  }

  // 加载数据
  async function loadInitialData() {
    const result = await (send as any)('get-chat-data')
    if (result.success && result.data) {
      chatData.value = {
        bots: result.data.bots || {},
        channels: result.data.channels || {},
        messages: result.data.messages || {}
      }
      pinnedBots.value = new Set(result.data.pinnedBots || [])
      pinnedChannels.value = new Set(result.data.pinnedChannels || [])
    }
  }

  async function loadConfig() {
    const result = await (send as any)('get-plugin-config')
    if (result.success && result.config) {
      pluginConfig.value = result.config
    }
  }

  // 后端频道信息（含机器人群内状态）更新时合并到本地
  receive('chat-data-updated', (payload: any) => {
    const ch = payload?.channel
    if (ch?.selfId && ch?.channelId && ch?.channelInfo) {
      if (!chatData.value.channels[ch.selfId]) chatData.value.channels[ch.selfId] = {}
      chatData.value.channels[ch.selfId][ch.channelId] = {
        ...(chatData.value.channels[ch.selfId][ch.channelId] || {}),
        ...ch.channelInfo
      }
      chatData.value = { ...chatData.value }
    }
  })

  // 主动刷新机器人在群内的状态（是否接收主动推送 / 群成员角色）
  async function refreshBotState(botId: string, channelId: string) {
    try {
      const result = await (send as any)('get-bot-state', { selfId: botId, channelId })
      if (result.success && result.botState) {
        if (!chatData.value.channels[botId]) chatData.value.channels[botId] = {}
        chatData.value.channels[botId][channelId] = {
          ...(chatData.value.channels[botId][channelId] || { id: channelId, name: channelId, type: 0, channelId }),
          botState: result.botState
        }
        chatData.value = { ...chatData.value }
        return result.botState
      }
      return null
    } catch (e) {
      return null
    }
  }

  // 消息处理
  function addMessage(msg: any) {
    const selfId = msg.selfId
    const channelId = msg.channelId
    const key = `${selfId}:${channelId}`

    // 1. 确保机器人存在
    if (!chatData.value.bots[selfId]) {
      chatData.value.bots[selfId] = {
        selfId,
        platform: msg.platform || 'unknown',
        username: msg.bot?.name || `Bot-${selfId}`,
        avatar: msg.bot?.avatar,
        status: 'online'
      }
    }

    // 2. 确保频道存在
    if (!chatData.value.channels[selfId]) {
      chatData.value.channels[selfId] = {}
    }
    if (!chatData.value.channels[selfId][channelId]) {
      const isDirect = msg.isDirect || channelId.includes('private')
      chatData.value.channels[selfId][channelId] = {
        id: channelId,
        name: isDirect ? `私聊（${msg.username || channelId}）` : (msg.guildName || channelId),
        type: msg.channelType || 0,
        isDirect
      }
    }

    // 3. 消息去重与添加
    if (!chatData.value.messages[key]) chatData.value.messages[key] = []

    const messages = chatData.value.messages[key]
    // 严格去重：检查 ID，如果是机器人发送的临时消息，则通过内容和时间戳近似匹配
    const isDuplicate = messages.some(m => {
      if (m.id === msg.messageId || m.id === msg.id) return true
      // 针对机器人发送消息的特殊去重逻辑
      if ((msg.type === 'bot-message' || msg.type === 'bot-message-sent' || msg.type === 'bot') && m.isBot && Math.abs(m.timestamp - msg.timestamp) < 2000 && m.content === msg.content) return true
      return false
    })

    if (!isDuplicate) {
      const newMsg: MessageInfo = {
        id: msg.messageId || msg.id,
        content: msg.content,
        userId: msg.userId,
        username: msg.username,
        avatar: msg.avatar,
        role: msg.role,
        timestamp: msg.timestamp,
        channelId: channelId,
        selfId: selfId,
        elements: msg.elements,
        isBot: msg.isBot || msg.type === 'bot-message' || msg.type === 'bot',
        type: msg.type === 'system' ? 'system' : msg.isBot || msg.type === 'bot' || msg.type === 'bot-message' || msg.type === 'bot-message-sent' ? 'bot' : 'user',
        systemType: msg.systemType || (msg.type === 'system' ? 'member' : undefined),
        quote: msg.quote
      }
      messages.push(newMsg)
      messages.sort((a, b) => a.timestamp - b.timestamp)
    }

    // 强制触发响应式更新，确保列表实时刷新
    chatData.value = { ...chatData.value }
  }

  function removeMessage(botId: string, channelId: string, messageId: string) {
    const key = `${botId}:${channelId}`
    const list = chatData.value.messages[key]
    if (!list) return
    const idx = list.findIndex(m => m.id === messageId || m.realId === messageId)
    if (idx >= 0) {
      list.splice(idx, 1)
      chatData.value = { ...chatData.value }
    }
  }

  async function loadHistory(botId: string, channelId: string, limit = 50) {
    const key = `${botId}:${channelId}`
    const pagination = getPagination(botId, channelId)
    if (!pagination.hasMore) return

    const result = await (send as any)('get-history-messages', {
      selfId: botId,
      channelId: channelId,
      limit,
      offset: pagination.offset
    })

    if (result.success && result.messages) {
      if (!chatData.value.messages[key]) chatData.value.messages[key] = []
      const existing = chatData.value.messages[key]

      // 合并并去重
      const newMsgs = result.messages.filter((m: any) => !existing.find(e => e.id === m.id))
      chatData.value.messages[key] = [...newMsgs, ...existing].sort((a, b) => a.timestamp - b.timestamp)

      channelPagination.value[key] = {
        offset: pagination.offset + result.messages.length,
        hasMore: result.messages.length >= limit && result.total > (pagination.offset + result.messages.length)
      }

      chatData.value = { ...chatData.value }
      return result.messages.length
    }
    return 0
  }

  return {
    chatData,
    pluginConfig,
    pinnedBots,
    pinnedChannels,
    bots,
    getChannels,
    allChannels,
    getMessages,
    getPagination,
    loadInitialData,
    loadConfig,
    addMessage,
    removeMessage,
    loadHistory,
    refreshBotState
  }
}
