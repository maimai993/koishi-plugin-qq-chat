import { ref } from 'vue'
import { send } from '@koishijs/client'
import type { MessageInfo } from '../types'

export function useChatActions() {
  const isSending = ref(false)

  async function sendMessage(botId: string, channelId: string, content: string, images: any[], files: any[] = []) {
    if (isSending.value) return
    isSending.value = true
    try {
      const result = await (send as any)('send-message', {
        selfId: botId,
        channelId: channelId,
        content: content,
        images: images.map(img => ({
          tempId: img.tempId,
          filename: img.filename
        })),
        files: files.map(f => ({
          tempId: f.tempId,
          filename: f.filename,
          type: f.type
        }))
      })
      return result
    } finally {
      isSending.value = false
    }
  }

  // 通用文件上传（音频 / 视频 / 文件），返回 tempId
  async function uploadFile(file: File, type: string) {
    return await new Promise<any>((resolve) => {
      const reader = new FileReader()
      reader.onload = async () => {
        try {
          const res = await (send as any)('upload-file', {
            file: reader.result as string,
            filename: file.name,
            mimeType: file.type,
            type
          })
          resolve(res)
        } catch (e) {
          resolve({ success: false, error: String(e) })
        }
      }
      reader.onerror = () => resolve({ success: false, error: '文件读取失败' })
      reader.readAsDataURL(file)
    })
  }

  async function recallMessage(botId: string, channelId: string, messageId: string) {
    return await (send as any)('recall-message', {
      selfId: botId,
      channelId: channelId,
      messageId: messageId
    })
  }

  async function deleteBotData(botId: string) {
    return await (send as any)('delete-bot-data', { selfId: botId })
  }

  async function deleteChannelData(botId: string, channelId: string) {
    return await (send as any)('delete-channel-data', { selfId: botId, channelId: channelId })
  }

  async function clearHistory(botId: string, channelId: string) {
    return await (send as any)('clear-channel-history', { selfId: botId, channelId: channelId })
  }

  async function togglePinBot(botId: string, pinned: boolean, pinnedBots: Set<string>) {
    if (pinned) pinnedBots.delete(botId)
    else pinnedBots.add(botId)
    await (send as any)('set-pinned-bots', { pinnedBots: Array.from(pinnedBots) })
  }

  async function togglePinChannel(botId: string, channelId: string, pinned: boolean, pinnedChannels: Set<string>) {
    const key = `${botId}:${channelId}`
    if (pinned) pinnedChannels.delete(key)
    else pinnedChannels.add(key)
    await (send as any)('set-pinned-channels', { pinnedChannels: Array.from(pinnedChannels) })
  }

  return {
    isSending,
    sendMessage,
    uploadFile,
    recallMessage,
    deleteBotData,
    deleteChannelData,
    clearHistory,
    togglePinBot,
    togglePinChannel
  }
}
