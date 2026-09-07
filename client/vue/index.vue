<template>
  <div
    class="qq-chat-wrapper absolute inset-0 flex overflow-hidden bg-[var(--k-page-bg)] text-[var(--k-text-color)] font-sans"
    :style="isMobile ? 'height: 100dvh; width: 100vw; position: fixed; top: 0; left: 0;' : 'height: 100%; width: 100%;'">

    <!-- 顶部手机通知 -->
    <div v-if="notifications.length" class="chat-notify-stack">
      <div v-for="n in notifications" :key="n.id" class="chat-notify-item" @click.stop="gotoNotification(n)">
        <img v-if="n.avatar" :src="n.avatar" class="chat-notify-avatar"
          @error="(e: any) => e.target.style.display = 'none'" />
        <div class="chat-notify-body">
          <div class="chat-notify-head">
            <span class="chat-notify-name">{{ n.username }}</span>
            <span class="chat-notify-channel">{{ n.channelName }}</span>
          </div>
          <div class="chat-notify-text">
            <!-- 使用 parseMessageContent 解析表情 -->
            <template v-if="n.elements && n.elements.length">
              <render-element v-for="(el, i) in n.elements" :key="i" :element="el"
                :bot-id="n.selfId" :channel-id="n.channelId" :in-quote="true" />
            </template>
            <template v-else>
              <span v-html="parseMessageContent({ content: n.content, elements: n.elements })"></span>
            </template>
          </div>
        </div>
        <el-icon class="chat-notify-close" @click.stop="dismissNotification(n.id)">
          <Close />
        </el-icon>
      </div>
    </div>

    <el-container class="h-full w-full overflow-hidden">
      <!-- 左侧栏：合并所有机器人的频道列表 -->
      <el-aside v-show="!isMobile || mobileView === 'channels'"
        :width="isMobile ? '100%' : '280px'"
        class="flex flex-col border-r border-[var(--k-border-color)] bg-[var(--k-page-bg)] brightness-95 dark:brightness-90 h-full overflow-hidden">
        <!-- 频道列表（合并所有机器人） -->
        <div
          class="flex h-14 items-center px-4 font-bold border-b border-[var(--k-border-color)] text-lg text-[var(--k-text-color)] flex-shrink-0">
          <el-button v-if="isMobile" icon="ArrowLeft" circle size="small" class="mr-3" @click="goBack" />
          频道
        </div>
        <el-scrollbar class="flex-1 overflow-auto">
          <div v-if="currentChannels.length === 0" class="p-10 text-center opacity-40 text-sm">暂无频道数据</div>
          <div v-for="channel in currentChannels" :key="`${channel.selfId}:${channel.id}`"
            :class="['flex items-center p-4 cursor-pointer transition-all hover:bg-[var(--k-button-hover-bg)] border-l-4 border-transparent', { '!border-[var(--k-color-primary)] bg-[var(--k-button-active-bg)] text-[var(--k-color-primary)]': selectedBot === channel.selfId && selectedChannel === channel.id }]"
            @click="selectChannel(channel.id, channel.selfId)" @contextmenu.prevent="onChannelMenu($event, channel)">
            <div class="flex-1 overflow-hidden min-w-0">
              <div class="flex items-center gap-1 text-sm font-medium min-w-0">
                <span class="truncate flex-1 min-w-0">{{ channel.name }}</span>
                <span v-if="!channel.isDirect && channel.botState?.inGroup === false" class="chat-proactive-badge chat-kicked-badge" title="机器人已不在该群（可能被移出）">已退群</span>
                <el-icon v-if="pinnedChannels.has(`${channel.selfId}:${channel.id}`)" class="text-orange-400 flex-shrink-0">
                  <StarFilled />
                </el-icon>
              </div>
              <div class="text-xs text-[var(--k-text-color-secondary)] truncate opacity-80">{{ botName(channel.selfId) }}</div>
            </div>
            <div v-if="unreadCounts[`${channel.selfId}:${channel.id}`]" class="chat-unread-badge">
              {{ unreadCounts[`${channel.selfId}:${channel.id}`] > 99 ? '99+' : unreadCounts[`${channel.selfId}:${channel.id}`] }}
            </div>
          </div>
        </el-scrollbar>
      </el-aside>

      <!-- 消息主区域 -->
      <el-main v-show="(!isMobile && selectedBot && selectedChannel) || (isMobile && mobileView === 'messages')"
        :class="['flex flex-col p-0 bg-[var(--k-page-bg)] relative brightness-105 dark:brightness-100 h-full overflow-hidden']">
        <template v-if="selectedBot && selectedChannel">
          <div
            class="flex h-14 items-center px-4 font-bold border-b border-[var(--k-border-color)] bg-[var(--k-card-bg)] shadow-sm z-10 text-[var(--k-text-color)]">
            <el-button v-if="isMobile" icon="ArrowLeft" circle size="small" class="mr-3" @click="goBack" />
            <span class="truncate min-w-0 flex-1">{{ currentChannelName }}</span>
            <div class="flex items-center gap-2 flex-shrink-0 ml-2">
              <template v-if="currentChannelInfo?.botState">
                <span v-if="currentChannelInfo.botState.inGroup === false" class="chat-proactive-badge chat-kicked-badge" title="机器人已不在该群（可能被移出）">已退群</span>
                <template v-else>
                  <span v-if="currentChannelInfo.botState.memberRole === 'owner'" class="chat-role-badge chat-role-owner">群主</span>
                  <span v-else-if="currentChannelInfo.botState.memberRole === 'admin'" class="chat-role-badge chat-role-admin">管理员</span>
                  <span v-if="currentChannelInfo.botState.allowProactiveMsg === true" class="chat-proactive-badge chat-proactive-on" title="机器人允许接收主动推送">📢 主动推送</span>
                  <span v-if="recvMsgLabel(currentChannelInfo.botState.recvMsgSetting)" class="text-xs opacity-50 hidden lg:inline flex-shrink-0" title="接收消息设置">{{ recvMsgLabel(currentChannelInfo.botState.recvMsgSetting) }}</span>
                </template>
              </template>
              <span v-if="selectedChannel"
                class="text-xs opacity-40 font-mono hidden md:inline truncate max-w-[150px] flex-shrink-0">({{ selectedChannel }})</span>
              <el-button circle size="small" title="刷新群内状态（是否接收主动推送 / 群成员角色）"
                @click="refreshCurrentBotState">
                <el-icon><Refresh /></el-icon>
              </el-button>
              <el-button
                v-if="!currentChannelInfo?.isDirect && (currentChannelInfo?.botState?.memberRole === 'admin' || currentChannelInfo?.botState?.memberRole === 'owner')"
                size="small" title="管理群（入群申请 / 禁言解除）"
                @click="openManageGroup(selectedBot, selectedChannel)">
                管理群
              </el-button>
            </div>
          </div>

          <div :class="['flex-1 overflow-hidden relative bg-opacity-50 bg-gray-100 dark:bg-black/20']">
            <el-scrollbar ref="scrollRef" @scroll="handleScroll" class="h-full">
              <div class="p-6 flex flex-col"
                :style="isMobile ? { paddingBottom: 'calc(180px + env(safe-area-inset-bottom))' } : { minHeight: '100%' }">
                <div v-if="isLoadingHistory" class="flex justify-center py-4">
                  <el-icon class="is-loading text-[var(--k-color-primary)]">
                    <Loading />
                  </el-icon>
                </div>
                <!-- 系统消息：居中显示 -->
                <div v-for="msg in systemMessages" :key="`sys-${msg.id}`" class="flex flex-col items-center my-2 group gap-1">
                  <span
                    class="px-3 py-1 text-xs text-[var(--k-text-color-secondary)] bg-black/5 dark:bg-white/5 rounded-full opacity-80">{{ msg.content }}</span>
                  <el-button v-if="msg.systemType === 'join-request'" size="small" type="primary" plain
                    class="!h-7 !px-3 !text-xs" @click.stop="openManageGroup(msg.selfId, msg.channelId)">去处理</el-button>
                </div>
                <div v-for="msg in normalMessages" :key="msg.id" :data-id="msg.id"
                  :class="['flex mb-6 gap-3 group', (msg.isBot || msg.userId === selectedBot) ? 'flex-row-reverse' : 'flex-row']">
                  <el-avatar :size="40" :src="msg.avatar" class="flex-shrink-0 shadow-sm">
                    {{ msg.username[0] }}
                  </el-avatar>
                  <div
                    :class="['max-w-[85%] md:max-w-[75%] flex flex-col', (msg.isBot || msg.userId === selectedBot) ? 'items-end' : 'items-start']">
                    <div class="flex items-center gap-2 mb-1.5 text-xs text-[var(--k-text-color-secondary)]">
                      <span v-if="msgRole(msg) === 'owner'" class="chat-role-badge chat-role-owner">群主</span>
                      <span v-else-if="msgRole(msg) === 'admin'" class="chat-role-badge chat-role-admin">管理员</span>
                      <span class="font-bold" :class="{ 'opacity-70': msg.username === '系统消息' }">{{ msg.username }}</span>
                      <el-button v-if="msg.systemType === 'join-request'" size="small" type="primary" plain
                        class="!h-6 !px-2 !text-xs" @click.stop="openManageGroup(msg.selfId, msg.channelId)">去处理</el-button>
                      <span class="opacity-60">{{ formatTime(msg.timestamp) }}</span>
                    </div>
                    <div
                      :class="['flex items-end gap-2 group/msg', (msg.isBot || msg.userId === selectedBot) ? 'flex-row' : 'flex-row-reverse']">
                      <!-- +1 按钮 -->
                      <div
                        :class="['transition-opacity cursor-pointer text-blue-500 hover:scale-110 active:scale-95 mb-1', isMobile ? 'opacity-100' : 'opacity-0 group-hover/msg:opacity-100']"
                        title="复读这条消息" @click.stop="repeatMessage(msg)">
                        <div v-if="msg.sending" class="w-8 h-8 flex items-center justify-center">
                          <el-icon class="is-loading">
                            <Loading />
                          </el-icon>
                        </div>
                        <div v-else
                          class="w-8 h-8 rounded-full border-2 border-blue-500 flex items-center justify-center font-bold text-xs bg-blue-50/10">
                          +1</div>
                      </div>

                      <div
                        :class="['p-3.5 rounded-2xl shadow-sm text-[15px] leading-relaxed break-all relative cursor-context-menu', (msg.isBot || msg.userId === selectedBot) ? 'bg-[#95ec69] text-black rounded-tr-none' : 'bg-[var(--k-card-bg)] text-[var(--k-text-color)] rounded-tl-none border border-[var(--k-border-color)]']"
                        @contextmenu.stop="onMessageMenu($event, msg)">
                        <!-- 引用消息渲染 -->
                        <div v-if="msg.quote"
                          class="mb-2.5 p-2.5 text-sm bg-black/5 dark:bg-white/5 rounded-lg border-l-4 border-gray-400/50 text-left relative group/quote">
                          <div class="font-bold opacity-70 mb-1 text-xs">{{ getQuoteDisplayName(msg.quote) }}:</div>
                          <div class="opacity-90">
                            <template v-if="visibleQuoteElements(msg.quote).length">
                              <render-element v-for="(el, i) in visibleQuoteElements(msg.quote)" :key="i" :element="el"
                                :bot-id="selectedBot" :channel-id="selectedChannel" :in-quote="true" />
                            </template>
                            <template v-else>
                              <!-- 使用 parseMessageContent 渲染表情 -->
                              <span v-html="parseMessageContent({ content: msg.quote.content, elements: msg.quote.elements })"></span>
                            </template>
                          </div>
                          <!-- 定位消息按钮 -->
                          <div
                            class="absolute top-1 right-1 cursor-pointer text-[var(--k-color-primary)] hover:scale-110 transition-transform"
                            title="定位到原消息" @click.stop="scrollToMessage(msg.quote.id, msg.quote)">
                            <el-icon>
                              <Top />
                            </el-icon>
                          </div>
                        </div>
                        <!-- 消息内容渲染 -->
                        <div class="text-left min-w-[20px]">
                          <!-- 使用 parseMessageContent 解析表情 -->
                          <div v-if="!isForwardText(msg) && !isCardMessage(msg) && !hasCmdChips(msg) && !isMdOnlyMessage(msg)"
                               v-html="parseMessageContent(msg)"></div>
                          <!-- 纯 markdown 消息（如发送的 QQ 表情 = markdown 图片） -->
                          <template v-else-if="isMdOnlyMessage(msg)">
                            <div class="chat-md-preview" v-html="renderMarkdown(getMdText(msg))"></div>
                          </template>
                          <template v-else-if="isForwardText(msg)">
                            <div
                              class="my-2 p-3 bg-black/5 dark:bg-white/5 rounded-xl border border-black/10 dark:border-white/10 max-w-[300px] cursor-pointer hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                              @click.stop="openTextForward(msg)">
                              <div class="flex items-center gap-2 mb-2 font-bold text-sm opacity-80">
                                <el-icon>
                                  <Collection />
                                </el-icon>
                                <span>{{ forwardTitle(msg) }}</span>
                              </div>
                              <div class="space-y-1.5">
                                <div v-for="(m, i) in parseForwardText(msg).slice(0, 4)" :key="i"
                                  class="text-xs truncate opacity-70">
                                  <span class="font-bold mr-1">{{ m.attrs.nickname }}:</span>
                                  <span>{{ forwardPreviewText(m) }}</span>
                                </div>
                              </div>
                              <div v-if="parseForwardText(msg).length > 4"
                                class="mt-2 pt-2 border-t border-black/5 dark:border-white/5 text-[10px] opacity-50">
                                查看更多 {{ parseForwardText(msg).length }} 条内容...
                              </div>
                            </div>
                          </template>
                          <template v-else-if="isCardMessage(msg)">
                            <div class="chat-card-msg" :class="{ 'chat-card-msg-link': parseCardMessage(msg).jumpUrl }"
                              @click="parseCardMessage(msg).jumpUrl && openCardLink(parseCardMessage(msg).jumpUrl)">
                              <img v-if="getCardPreview(msg)" :src="getCardPreview(msg)"
                                class="chat-card-msg-preview" @click.stop="onCardPreviewClick(msg)"
                                @error="(e: any) => e.target.style.display = 'none'" />
                              <div class="chat-card-msg-body">
                                <div v-if="parseCardMessage(msg).title" class="chat-card-msg-title">
                                  {{ parseCardMessage(msg).title }}
                                </div>
                                <div v-if="parseCardMessage(msg).desc" class="chat-card-msg-desc">
                                  {{ parseCardMessage(msg).desc }}
                                </div>
                                <div v-if="parseCardMessage(msg).summary" class="chat-card-msg-summary">
                                  {{ parseCardMessage(msg).summary }}
                                </div>
                                <div v-if="parseCardMessage(msg).source || parseCardMessage(msg).tag"
                                  class="chat-card-msg-source">
                                  <img v-if="parseCardMessage(msg).sourceLogo" :src="parseCardMessage(msg).sourceLogo"
                                    class="chat-card-msg-logo" @error="(e: any) => e.target.style.display = 'none'" />
                                  <span>{{ parseCardMessage(msg).source || parseCardMessage(msg).tag }}</span>
                                  <el-popover
                                    v-if="parseCardMessage(msg).jumpUrl || parseCardMessage(msg).preview"
                                    placement="bottom-end" :width="320" trigger="manual"
                                    :visible="biliSearchOpenId === msg.id" :teleported="true"
                                    popper-class="chat-bili-popper" @hide="biliSearchOpenId = ''">
                                    <template #reference>
                                      <button class="chat-card-msg-open" title="打开详情"
                                        @click.stop="openCardDetail(msg)">
                                        打开详情 ↗
                                      </button>
                                    </template>
                                    <div class="chat-bili-pop">
                                      <div class="chat-bili-pop-head">
                                        <span class="chat-bili-pop-head-title">B 站搜索结果</span>
                                        <el-icon class="chat-bili-pop-close" @click.stop="biliSearchOpenId = ''">
                                          <Close />
                                        </el-icon>
                                      </div>
                                      <div v-if="biliSearchState.loading" class="chat-bili-pop-tip">
                                        <el-icon class="is-loading">
                                          <Loading />
                                        </el-icon>
                                        正在搜索「{{ biliSearchState.keyword }}」...
                                      </div>
                                      <div v-else-if="biliSearchState.error"
                                        class="chat-bili-pop-tip chat-bili-pop-error">
                                        {{ biliSearchState.error }}
                                      </div>
                                      <div v-else-if="biliSearchState.results.length" class="chat-bili-pop-list">
                                        <div v-for="item in biliSearchState.results" :key="item.bvid"
                                          class="chat-bili-pop-item" @click.stop="openBiliVideo(item.bvid)">
                                          <img v-if="item.pic" :src="item.pic" class="chat-bili-pop-thumb"
                                            loading="lazy" @error="(e: any) => e.target.style.display = 'none'" />
                                          <div class="chat-bili-pop-info">
                                            <div class="chat-bili-pop-title">{{ item.title }}</div>
                                            <div class="chat-bili-pop-meta">
                                              <span>{{ item.author }}</span>
                                              <span v-if="item.play">播放 {{ formatPlayCount(item.play) }}</span>
                                              <span v-if="item.duration">{{ formatDuration(item.duration) }}</span>
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                      <div v-else class="chat-bili-pop-tip">正在搜索 B 站视频...</div>
                                    </div>
                                  </el-popover>
                                </div>
                              </div>
                            </div>
                          </template>
                          <template v-else-if="hasCmdChips(msg)">
                            <template v-for="(seg, i) in buildMessageSegments(msg)" :key="i">
                              <span v-if="seg.kind === 'text' && seg.md" class="chat-md-preview" v-html="renderMarkdown(seg.text)"></span>
                              <span v-else-if="seg.kind === 'text'" v-html="parseMessageContent({ content: seg.text })"></span>
                              <span v-else-if="seg.kind === 'chip'" class="chat-cmd-chip"
                                :title="`点击插入：${seg.tag.text}`" @click.stop="onCmdChipClick(seg.tag, msg)">/{{ seg.tag.show || seg.tag.text }}</span>
                              <render-element v-else :element="seg.element" :bot-id="selectedBot"
                                :channel-id="selectedChannel" />
                            </template>
                          </template>
                          <template v-else-if="visibleElements(msg).length">
                            <render-element v-for="(el, i) in visibleElements(msg)" :key="i" :element="el" :bot-id="selectedBot"
                              :channel-id="selectedChannel" />
                          </template>
                          <template v-else-if="msg.content">
                            <span v-html="parseMessageContent(msg)"></span>
                          </template>
                          <!-- 正文含 B 站链接的非卡片消息 -->
                          <div v-if="!isCardMessage(msg) && hasBiliLink(msg)" class="mt-1.5">
                            <span class="chat-bili-play" @click.stop="playBili(msg)">▶ 播放 B 站视频</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </el-scrollbar>
          </div>

          <!-- 网易云悬浮播放器 -->
          <div v-if="neteasePlayer.visible" class="chat-netease-float"
            :style="{ bottom: isMobile ? `${(keyboardHeight > 0 ? keyboardHeight : 0) + 80}px` : '84px' }">
            <img v-if="neteasePlayer.cover" :src="neteasePlayer.cover" class="chat-netease-float-cover"
              :class="{ 'is-playing': audioPlaying }" @click.stop="toggleNeteasePlay"
              @error="(e: any) => e.target.style.display = 'none'" />
            <div class="chat-netease-float-info">
              <div class="chat-netease-float-title">{{ neteasePlayer.title }}</div>
              <div class="chat-netease-float-artist">{{ neteasePlayer.artist }}</div>
            </div>
            <el-button class="chat-netease-float-btn" :icon="audioPlaying ? VideoPause : VideoPlay"
              circle size="small" @click.stop="toggleNeteasePlay" />
            <el-button class="chat-netease-float-btn chat-netease-float-close" :icon="Close" circle size="small"
              @click.stop="closeNeteasePlayer" />
            <audio ref="audioRef" @play="audioPlaying = true" @pause="audioPlaying = false"
              @ended="audioPlaying = false" />
          </div>

          <!-- 输入区域 -->
          <div
            :class="['p-4 border-t border-[var(--k-border-color)] bg-[var(--k-card-bg)] shadow-[0_-2px_10px_rgba(0,0,0,0.05)]', isMobile ? 'fixed left-0 right-0 z-50 transition-all duration-200' : '']"
            :style="isMobile ? {
              bottom: keyboardHeight > 0 ? `${keyboardHeight}px` : '0',
              paddingBottom: 'max(env(safe-area-inset-bottom), 16px)'
            } : {}">
            <!-- 图片预览区域 -->
            <div v-if="uploadedImages.length" class="flex gap-3 mb-3 overflow-x-auto pb-2 scrollbar-hide">
              <div v-for="img in uploadedImages" :key="img.tempId" class="relative w-20 h-20 flex-shrink-0 group">
                <el-image :src="img.preview" fit="cover"
                  class="w-full h-full rounded-lg border-2 border-[var(--k-border-color)] shadow-sm cursor-pointer hover:brightness-90"
                  @click="openImageViewer(img.preview)" />
                <el-icon
                  class="absolute -top-1.5 -right-1.5 cursor-pointer text-red-500 bg-white rounded-full shadow-md opacity-0 group-hover:opacity-100 transition-opacity z-10"
                  @click.stop="removeImage(img.tempId)">
                  <CircleCloseFilled />
                </el-icon>
              </div>
            </div>
            <!-- 已选文件预览 -->
            <div v-if="uploadedFiles.length" class="flex gap-2 mb-3 overflow-x-auto pb-2 scrollbar-hide">
              <div v-for="f in uploadedFiles" :key="f.tempId" class="chat-file-chip">
                <span>{{ f.type === 'audio' ? '🎤' : f.type === 'video' ? '📹' : '📎' }}</span>
                <span class="max-w-[140px] truncate">{{ f.filename }}</span>
                <el-icon class="cursor-pointer hover:text-red-500" @click="removeUploadedFile(f.tempId)">
                  <Close />
                </el-icon>
              </div>
            </div>
            <div v-if="replyingTo"
              class="mb-2 px-3 py-1.5 bg-black/5 dark:bg-white/5 rounded-lg flex items-center justify-between text-xs">
              <div class="flex items-center gap-2 truncate opacity-70">
                <el-icon>
                  <ChatLineRound />
                </el-icon>
                <span>回复 {{ replyingTo.username }}: {{ replyingTo.content.slice(0, 20) }}{{ replyingTo.content.length > 20 ? '...' : '' }}</span>
              </div>
              <el-icon class="cursor-pointer hover:text-red-500" @click="replyingTo = null">
                <Close />
              </el-icon>
            </div>
            <div class="flex gap-3 items-end">
              <!-- 图片上传按钮 -->
              <el-upload action="#" :auto-upload="false" :show-file-list="false" :on-change="handleFileChange" multiple :disabled="inputDisabled">
                <el-button circle class="!w-10 !h-10 !text-xl shadow-sm hover:scale-105 transition-transform">
                  <el-icon>
                    <Picture />
                  </el-icon>
                </el-button>
              </el-upload>
              <!-- 语音上传按钮 -->
              <el-upload action="#" :auto-upload="false" :show-file-list="false" :on-change="(f: any) => handleFileSelect(f.raw, 'audio')" accept="audio/*" :disabled="inputDisabled">
                <el-button circle class="!w-10 !h-10 !text-base shadow-sm hover:scale-105 transition-transform" title="发送语音">🎤</el-button>
              </el-upload>
              <!-- 视频上传按钮 -->
              <el-upload action="#" :auto-upload="false" :show-file-list="false" :on-change="(f: any) => handleFileSelect(f.raw, 'video')" accept="video/*" :disabled="inputDisabled">
                <el-button circle class="!w-10 !h-10 !text-base shadow-sm hover:scale-105 transition-transform" title="发送视频">📹</el-button>
              </el-upload>
              <!-- 文件上传按钮 -->
              <el-upload action="#" :auto-upload="false" :show-file-list="false" :on-change="(f: any) => handleFileSelect(f.raw, 'file')" :disabled="inputDisabled">
                <el-button circle class="!w-10 !h-10 !text-base shadow-sm hover:scale-105 transition-transform" title="发送文件">📎</el-button>
              </el-upload>
              <!-- QQ 原生表情按钮：点选经典小表情 → 直接当图片发送 -->
              <el-popover v-model:visible="emojiPanelVisible" placement="top-start" :width="344" trigger="click"
                :disabled="inputDisabled" popper-class="qq-emoji-popover">
                <template #reference>
                  <el-button circle class="chat-tool-btn !w-10 !h-10 !text-base shadow-sm hover:scale-105 transition-transform"
                    title="发送 QQ 表情" :disabled="inputDisabled">😊</el-button>
                </template>
                <div class="qq-emoji-panel">
                  <div class="flex items-center gap-1 mb-2">
                    <span class="text-xs opacity-70">QQ 表情</span>
                    <span class="ml-auto flex rounded-lg bg-black/5 dark:bg-white/10 p-0.5">
                      <button type="button"
                        class="qq-emoji-tab px-2.5 py-0.5 text-xs rounded-md transition-colors"
                        :class="emojiTab === 'native' ? 'qq-emoji-tab-active' : ''"
                        @click="emojiTab = 'native'">经典</button>
                      <button type="button"
                        class="qq-emoji-tab px-2.5 py-0.5 text-xs rounded-md transition-colors"
                        :class="emojiTab === 'super' ? 'qq-emoji-tab-active' : ''"
                        @click="emojiTab = 'super'">大表情</button>
                    </span>
                  </div>
                  <template v-if="emojiTab === 'native'">
                    <div v-if="nativeEmojiIds.length" class="qq-emoji-grid qq-emoji-grid-native">
                      <div v-for="id in nativeEmojiIds" :key="'n' + id" class="qq-emoji-cell"
                        :title="`发送经典表情 ${id}`" @click="pickNativeEmoji(id, '1')">
                        <img :src="getQQEmojiUrl(id, '1')" alt="[face]" loading="lazy"
                          @error="(e: any) => e.target.style.display = 'none'" />
                      </div>
                    </div>
                    <div v-else class="py-6 text-center text-xs opacity-60">表情加载中…</div>
                  </template>
                  <template v-else>
                    <div v-if="superEmojiIds.length" class="qq-emoji-grid qq-emoji-grid-super">
                      <div v-for="id in superEmojiIds" :key="'s' + id" class="qq-emoji-cell qq-emoji-cell-lg"
                        :title="`发送大表情 ${id}`" @click="pickNativeEmoji(id, '3')">
                        <img :src="getQQEmojiUrl(id, '3')" alt="[face]" loading="lazy"
                          @error="(e: any) => e.target.style.display = 'none'" />
                      </div>
                    </div>
                    <div v-else class="py-6 text-center text-xs opacity-60">大表情加载中…</div>
                  </template>
                </div>
              </el-popover>
              <!-- 发送 Markdown 按钮 -->
              <el-tooltip content="发送 Markdown 消息（原生 / 按钮交互）" placement="top">
                <el-button circle class="chat-tool-btn !w-10 !h-10 !text-base shadow-sm hover:scale-105 transition-transform"
                  title="发送 Markdown" :disabled="inputDisabled" @click="openMdDialog">📝</el-button>
              </el-tooltip>
              <!-- 文本输入框 -->
              <el-input ref="inputRef" v-model="inputText" type="textarea" :autosize="{ minRows: 1, maxRows: 4 }"
                :placeholder="inputPlaceholder" class="flex-1 !text-base" @keydown.enter.prevent="handleSend"
                @paste="handlePaste" :disabled="inputDisabled" />
              <!-- 发送按钮 -->
              <el-button type="primary" :loading="isSending" :disabled="inputDisabled" @click="handleSend"
                class="px-6 h-10 !text-base font-bold shadow-md">发送</el-button>
            </div>
          </div>
        </template>
        <el-empty v-else description="请选择频道开始对话" class="h-full flex items-center justify-center opacity-60" />
      </el-main>

      <!-- 合并转发详情页 (手机端全屏) -->
      <el-main v-if="isMobile && mobileView === 'forward'"
        class="flex flex-col p-0 bg-[var(--k-page-bg)] absolute inset-0 z-50 overflow-hidden" style="height: 100dvh;">
        <div
          class="flex h-14 items-center px-4 font-bold border-b border-[var(--k-border-color)] bg-[var(--k-card-bg)] shadow-sm">
          <el-button icon="ArrowLeft" circle size="small" class="mr-3" @click="goBack" />
          <span>聊天记录</span>
        </div>
        <el-scrollbar class="flex-1 bg-gray-50 dark:bg-black/10">
          <div class="p-4 space-y-6">
            <div v-for="(msg, idx) in forwardData.messages" :key="idx" class="flex gap-3">
              <el-avatar :size="36" :src="msg.attrs?.avatar" class="flex-shrink-0 shadow-sm">{{ msg.attrs?.nickname?.[0] }}</el-avatar>
              <div class="flex-1 overflow-hidden">
                <div class="text-xs text-[var(--k-text-color-secondary)] mb-1 font-bold">{{ msg.attrs?.nickname }}</div>
                <div
                  class="p-3 bg-[var(--k-card-bg)] rounded-2xl rounded-tl-none shadow-sm text-sm break-all border border-[var(--k-border-color)]">
                  <render-element v-for="(el, i) in msg.children" :key="i" :element="el" :bot-id="selectedBot"
                    :channel-id="selectedChannel" />
                </div>
              </div>
            </div>
          </div>
        </el-scrollbar>
      </el-main>

      <!-- 图片查看器 (手机端全屏) -->
      <el-main v-if="isMobile && mobileView === 'image'"
        class="flex flex-col p-0 bg-black absolute inset-0 z-[60] overflow-hidden" style="height: 100dvh;">
        <div
          class="flex h-14 items-center px-4 font-bold border-b border-white/10 bg-black text-white shadow-sm flex-shrink-0">
          <el-button icon="ArrowLeft" circle size="small" class="mr-3 !bg-white/10 !border-none !text-white"
            @click="goBack" />
          <span class="truncate mr-2">查看图片</span>
          <div class="flex-1"></div>
          <el-button type="primary" icon="Download" size="small" @click="downloadImage(imageViewer.url)">下载</el-button>
        </div>
        <div class="flex-1 overflow-hidden relative flex items-center justify-center" @wheel="handleImageWheel">
          <img :src="imageViewer.url"
            class="transition-transform duration-200 ease-out will-change-transform"
            :style="{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              width: 'auto',
              height: 'auto',
              transform: `scale(${imageZoom})`
            }" />
        </div>
      </el-main>

      <!-- 原始消息查看页 -->
      <el-main v-if="isMobile && mobileView === 'raw'"
        class="flex flex-col p-0 bg-[var(--k-page-bg)] absolute inset-0 z-[80] overflow-hidden" style="height: 100dvh;">
        <div
          class="flex h-14 items-center px-4 font-bold border-b border-[var(--k-border-color)] bg-[var(--k-card-bg)] shadow-sm">
          <el-button icon="ArrowLeft" circle size="small" class="mr-3" @click="goBack" />
          <div class="flex-1 text-center pr-8">原始消息</div>
        </div>
        <div class="p-4 flex flex-col gap-4 h-full overflow-hidden">
          <el-input v-model="rawMessage.content" type="textarea" :rows="15" readonly class="flex-1 raw-content-area" />
          <div class="flex gap-3 pb-8">
            <el-button type="primary" class="flex-1"
              @click="copyToClipboard(rawMessage.content).then(() => ElMessage.success('已复制'))">复制内容</el-button>
            <el-button class="flex-1" @click="goBack">返回</el-button>
          </div>
        </div>
      </el-main>

      <!-- 用户资料页 -->
      <el-main v-if="isMobile && mobileView === 'profile'"
        class="flex flex-col p-0 bg-[var(--k-page-bg)] absolute inset-0 z-[70] overflow-hidden" style="height: 100dvh;">
        <div
          class="flex h-14 items-center px-4 font-bold border-b border-[var(--k-border-color)] bg-[var(--k-card-bg)] shadow-sm">
          <el-button icon="ArrowLeft" circle size="small" class="mr-3" @click="goBack" />
          <div class="flex-1 text-center pr-8">用户资料</div>
        </div>
        <div class="p-8 flex flex-col items-center gap-6">
          <el-avatar :size="120" :src="userProfile.data?.avatar" class="shadow-lg">{{ userProfile.data?.username?.[0] }}</el-avatar>
          <div class="text-center">
            <div class="text-2xl font-bold mb-2">{{ userProfile.data?.username || userProfile.data?.name || '未知用户' }}</div>
            <div class="text-sm opacity-60 font-mono">ID: {{ userProfile.data?.userId || userProfile.data?.id }}</div>
          </div>
          <el-descriptions :column="1" border class="w-full mt-4">
            <el-descriptions-item label="昵称">{{ userProfile.data?.username || userProfile.data?.name }}</el-descriptions-item>
            <el-descriptions-item label="平台">{{ selectedBotPlatform }}</el-descriptions-item>
          </el-descriptions>
        </div>
      </el-main>
    </el-container>

    <!-- 用户资料弹窗 (桌面端) -->
    <el-dialog v-if="!isMobile" v-model="userProfileVisible" title="用户资料" width="400px" center teleported align-center>
      <div class="flex flex-col items-center gap-4 py-4">
        <el-avatar :size="80" :src="userProfile.data?.avatar" class="shadow">{{ userProfile.data?.username?.[0] }}</el-avatar>
        <div class="text-center">
          <div class="text-xl font-bold">{{ userProfile.data?.username || userProfile.data?.name || '未知用户' }}</div>
          <div class="text-xs opacity-50 mt-1 font-mono">ID: {{ userProfile.data?.userId || userProfile.data?.id }}</div>
        </div>
        <el-descriptions :column="1" border class="w-full mt-4">
          <el-descriptions-item label="昵称">{{ userProfile.data?.username || userProfile.data?.name }}</el-descriptions-item>
          <el-descriptions-item label="平台">{{ selectedBotPlatform }}</el-descriptions-item>
        </el-descriptions>
      </div>
    </el-dialog>

    <!-- 合并转发详情弹窗 (桌面端) -->
    <el-dialog v-if="!isMobile" v-model="forwardDialogVisible" title="聊天记录" width="550px" class="forward-dialog"
      teleported>
      <el-scrollbar max-height="70vh">
        <div class="p-6 space-y-6 bg-gray-50 dark:bg-black/10">
          <div v-for="(msg, idx) in forwardData.messages" :key="idx" class="flex gap-3">
            <el-avatar :size="36" :src="msg.attrs?.avatar" class="flex-shrink-0 shadow-sm">{{ msg.attrs?.nickname?.[0] }}</el-avatar>
            <div class="flex-1 overflow-hidden">
              <div class="text-xs text-[var(--k-text-color-secondary)] mb-1 font-bold">{{ msg.attrs?.nickname }}</div>
              <div
                class="p-3 bg-[var(--k-card-bg)] rounded-2xl rounded-tl-none shadow-sm text-sm break-all border border-[var(--k-border-color)]">
                <render-element v-for="(el, i) in msg.children" :key="i" :element="el" :bot-id="selectedBot"
                  :channel-id="selectedChannel" />
              </div>
            </div>
          </div>
        </div>
      </el-scrollbar>
    </el-dialog>

    <!-- 图片查看器弹窗 (桌面端) -->
    <el-dialog v-if="!isMobile" v-model="imageViewerVisible" title="查看图片" width="fit-content"
      class="image-viewer-dialog" teleported center>
      <div class="flex flex-col items-center gap-4">
        <img :src="imageViewer.url" class="rounded shadow-lg"
          style="max-width: 90vw; max-height: 70vh; object-fit: contain; width: auto; height: auto;" />
        <el-button type="primary" icon="Download" @click="downloadImage(imageViewer.url)">下载图片</el-button>
      </div>
    </el-dialog>

    <!-- B 站视频悬浮播放器 -->
    <div v-if="biliPlayer.visible" class="chat-bili-float" :style="{
      left: biliPlayer.x + 'px',
      top: biliPlayer.y + 'px',
      width: isMobile ? 'calc(100vw - 16px)' : 'min(280px, calc(100vw - 24px))'
    }">
      <div class="chat-bili-float-head" @pointerdown="onBiliFloatDragStart">
        <span class="chat-bili-float-title">{{ biliPlayer.title || 'B 站视频' }}</span>
        <el-button class="chat-bili-float-close" :icon="FullScreen" circle size="small"
          :class="{ 'is-active': biliFullscreen }" :title="biliFullscreen ? '退出全屏' : '全屏'"
          @click.stop="onBiliFullscreen" />
        <el-button class="chat-bili-float-close" :icon="Close" circle size="small"
          @click.stop="closeBiliPlayer" />
      </div>
      <div v-if="biliPlayer.author || biliPlayer.duration" class="chat-bili-float-meta">
        <span v-if="biliPlayer.author">UP：{{ biliPlayer.author }}</span>
        <span v-if="biliPlayer.duration">时长 {{ biliPlayer.duration }}</span>
      </div>
      <video ref="biliVideoRef" controls autoplay class="chat-bili-float-video"></video>
    </div>

    <!-- 原始消息查看弹窗 (桌面端) -->
    <el-dialog v-if="!isMobile" v-model="rawMessageVisible" title="原始消息内容" width="600px" center teleported align-center>
      <div class="flex flex-col gap-4">
        <el-input v-model="rawMessage.content" type="textarea" :rows="12" readonly class="raw-content-area" />
        <div class="flex justify-center gap-3">
          <el-button type="primary"
            @click="copyToClipboard(rawMessage.content).then(() => ElMessage.success('已复制到剪贴板'))">复制全部内容</el-button>
          <el-button @click="rawMessageVisible = false">关闭</el-button>
        </div>
      </div>
    </el-dialog>

    <!-- 管理群对话框 -->
    <el-dialog v-model="manageDialog.visible" :title="`管理群 - ${manageDialog.name}`" width="480px"
      :close-on-click-modal="false" @open="onManageDialogOpen">
      <el-tabs v-model="manageTab">
        <el-tab-pane label="入群申请" name="join">
          <div v-if="joinRequestsLoading" class="text-center opacity-50 py-6 text-sm">加载中...</div>
          <div v-else-if="!joinRequests.length" class="text-center opacity-50 py-6 text-sm">暂无入群申请</div>
          <div v-else>
            <div v-for="req in joinRequests" :key="req.join_request_id"
              class="flex items-center gap-2 py-2.5 border-b border-black/5 dark:border-white/5">
              <div class="flex-1 min-w-0">
                <div class="font-bold truncate text-sm">{{ req.username || req.member_openid }}</div>
                <div class="text-xs opacity-60 truncate mt-0.5">{{ joinRequestInfo(req) }}</div>
              </div>
              <el-button size="small" type="success" @click="approveJoinRequest(req, true)">通过</el-button>
              <el-button size="small" type="danger" plain @click="approveJoinRequest(req, false)">拒绝</el-button>
            </div>
            <div class="flex justify-end mt-2">
              <el-button size="small" @click="loadJoinRequests">刷新</el-button>
            </div>
          </div>
        </el-tab-pane>
        <el-tab-pane label="被禁言" name="mute">
          <div v-if="mutedLoading" class="text-center opacity-50 py-6 text-sm">加载中...</div>
          <div v-else-if="!mutedMembers.length" class="text-center opacity-50 py-6 text-sm">暂无被禁言成员</div>
          <div v-else>
            <div v-for="m in mutedMembers" :key="m.member_openid"
              class="flex items-center gap-2 py-2.5 border-b border-black/5 dark:border-white/5">
              <div class="flex-1 min-w-0">
                <div class="font-bold truncate text-sm">{{ m.username || m.member_openid }}</div>
                <div class="text-xs opacity-60 truncate mt-0.5">禁言至 {{ formatMuteTime(m.mute_expire_at) }}</div>
              </div>
              <el-button size="small" type="warning" plain @click="unmuteMember(m)">解除禁言</el-button>
            </div>
            <div class="flex justify-end mt-2">
              <el-button size="small" @click="loadMutedMembers">刷新</el-button>
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-dialog>

    <!-- Markdown 发送对话框 -->
    <el-dialog v-model="mdDialog.visible" :title="`发送 Markdown - ${mdDialog.name}`" width="760px"
      :close-on-click-modal="false">
      <el-tabs v-model="mdTab">
        <el-tab-pane label="原生 Markdown" name="native">
          <div class="flex gap-3">
            <div class="flex-1 min-w-0">
              <el-input v-model="mdContent" type="textarea" :rows="14" resize="vertical"
                placeholder="# 标题&#10;输入 Markdown 内容…&#10;支持 **加粗**、*斜体*、[链接](https://)、图片 ![](url)、列表、引用等" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-xs opacity-50 mb-1">预览</div>
              <div class="border rounded-lg p-3 bg-black/5 dark:bg-white/5 overflow-auto max-h-[340px] chat-md-preview"
                v-html="renderMarkdown(mdContent)"></div>
            </div>
          </div>
        </el-tab-pane>
        <el-tab-pane label="扩展 Markdown" name="ext">
          <div class="text-xs opacity-60 mb-1">Markdown 内容（可在其中插入参数指令标签，与按钮交互同时发送）</div>
          <el-input v-model="mdContent" type="textarea" :rows="8" resize="vertical" class="mb-3"
            placeholder="# 标题&#10;内容...&#10;可插入 &lt;qqbot-cmd-input /&gt; 参数指令标签，客户端显示为可点击的「/指令」" />
          <div class="text-xs opacity-60 mb-1">参数指令（客户端显示为可点击标签，点击后文本插入输入框）</div>
          <div class="flex items-center gap-2 mb-2">
            <el-input v-model="cmdText" maxlength="100" placeholder="text：点击后插入输入框的文本（必填，≤100）" class="flex-1" />
            <el-input v-model="cmdShow" maxlength="100" placeholder="show：展示文本（选填，默认取 text）" class="flex-1" />
            <span class="text-xs whitespace-nowrap opacity-70">引用</span>
            <el-switch v-model="cmdReference" size="small" />
            <el-button type="primary" @click="addCmdToMd">添加</el-button>
          </div>
          <div class="flex items-center gap-2 mb-3 text-xs">
            <span class="opacity-50 flex-shrink-0">生成：</span>
            <code class="break-all opacity-70">{{ cmdTag || '（先填写 text）' }}</code>
          </div>
          <div class="text-xs opacity-60 my-2">按钮（点击后回调 data，收到 INTERACTION_CREATE 事件）</div>
          <div v-for="(b, i) in mdButtons" :key="i" class="flex gap-2 mb-2 items-center">
            <el-input v-model="b.label" placeholder="按钮文字" class="w-36 flex-shrink-0" />
            <el-input v-model="b.data" placeholder="回调 data（如 /command 或 JSON）" class="flex-1" />
            <el-button circle size="small" @click="mdButtons.splice(i, 1)"><el-icon><Close /></el-icon></el-button>
          </div>
          <el-button size="small" @click="mdButtons.push({ label: '', data: '' })">+ 添加按钮</el-button>
        </el-tab-pane>
      </el-tabs>
      <div class="flex justify-end gap-2 mt-4">
        <el-button size="small" @click="mdDialog.visible = false">取消</el-button>
        <el-button size="small" type="primary" :loading="mdSending" @click="sendMdMessage">发送</el-button>
      </div>
    </el-dialog>

    <!-- 禁言对话框 -->
    <el-dialog v-model="muteDialog.visible" title="禁言成员" width="380px" :close-on-click-modal="false">
      <div class="text-sm text-[var(--k-text-color)] mb-1">
        禁言 <b>{{ muteDialog.username }}</b>
        <div class="mt-1 text-xs opacity-50 break-all font-mono">{{ muteDialog.memberOpenid }}</div>
      </div>
      <div class="flex items-center gap-2 mt-3">
        <span class="text-sm flex-shrink-0">时长</span>
        <el-time-picker v-model="muteDuration" format="HH:mm:ss" placeholder="滚动选择禁言时长" class="flex-1" />
      </div>
      <div class="flex justify-end gap-2 mt-4">
        <el-button size="small" type="warning" plain @click="unmuteUser">解除禁言</el-button>
        <el-button size="small" type="primary" @click="confirmMute">确定</el-button>
      </div>
      <div class="text-xs opacity-50 mt-2">机器人需群管理员/群主身份，最大禁言时长为 30 天</div>
    </el-dialog>

    <!-- 右键菜单 -->
    <div v-if="menu.show"
      class="fixed bg-[var(--k-card-bg)] border border-[var(--k-border-color)] shadow-xl z-[2000] py-1.5 rounded-lg min-w-[140px] backdrop-blur-sm bg-opacity-90"
      :style="{ left: menu.x + 'px', top: menu.y + 'px' }">

      <!-- 机器人/频道菜单 -->
      <template v-if="menu.type === 'bot' || menu.type === 'channel'">
        <div
          class="px-4 py-2.5 cursor-pointer text-sm hover:bg-[var(--k-button-hover-bg)] transition-colors flex items-center gap-2"
          @click="onHandleMenuAction('pin')">
          <el-icon>
            <Star />
          </el-icon> {{ menu.isPinned ? '取消置顶' : '置顶' }}
        </div>
        <div
          class="px-4 py-2.5 cursor-pointer text-sm text-red-500 hover:bg-[var(--k-button-hover-bg)] transition-colors flex items-center gap-2"
          @click="onHandleMenuAction('delete')">
          <el-icon>
            <Delete />
          </el-icon> 删除数据
        </div>
      </template>

      <!-- 消息菜单 -->
      <template v-else-if="menu.type === 'message'">
        <div
          class="px-4 py-2.5 cursor-pointer text-sm hover:bg-[var(--k-button-hover-bg)] transition-colors flex items-center gap-2"
          @click="handleMessageAction('copy')">
          <el-icon>
            <DocumentCopy />
          </el-icon> 复制文本
        </div>
        <div
          class="px-4 py-2.5 cursor-pointer text-sm hover:bg-[var(--k-button-hover-bg)] transition-colors flex items-center gap-2"
          @click="handleMessageAction('copy-raw')">
          <el-icon>
            <Collection />
          </el-icon> 查看原始消息
        </div>
        <div
          class="px-4 py-2.5 cursor-pointer text-sm hover:bg-[var(--k-button-hover-bg)] transition-colors flex items-center gap-2"
          @click="handleMessageAction('plus1')">
          <el-icon>
            <CirclePlus />
          </el-icon> +1 复读
        </div>
        <div
          class="px-4 py-2.5 cursor-pointer text-sm hover:bg-[var(--k-button-hover-bg)] transition-colors flex items-center gap-2"
          @click="handleMessageAction('reply')">
          <el-icon>
            <ChatLineRound />
          </el-icon> 回复
        </div>
        <div v-if="canMuteMsg"
          class="px-4 py-2.5 cursor-pointer text-sm text-red-500 hover:bg-[var(--k-button-hover-bg)] transition-colors flex items-center gap-2"
          @click="openMuteDialog" title="设置该成员禁言（需机器人是群管理员/群主）">
          <el-icon>
            <Mute />
          </el-icon> 禁言
        </div>
        <div v-if="canRecallMsg"
          class="px-4 py-2.5 cursor-pointer text-sm text-red-500 hover:bg-[var(--k-button-hover-bg)] transition-colors flex items-center gap-2"
          @click="handleMessageAction('recall')" title="撤回该消息（撤回他人消息需机器人是群管理员）">
          <el-icon>
            <Delete />
          </el-icon> 撤回消息
        </div>
        <div
          class="px-4 py-2.5 cursor-pointer text-sm hover:bg-[var(--k-button-hover-bg)] transition-colors flex items-center gap-2"
          @click="viewUserOpenid">
          <el-icon>
            <Key />
          </el-icon> 查看用户 OpenID
        </div>
        <div v-if="menu.hasMedia"
          class="px-4 py-2.5 cursor-pointer text-sm hover:bg-[var(--k-button-hover-bg)] transition-colors flex items-center gap-2"
          @click="handleMessageAction('download')">
          <el-icon>
            <Download />
          </el-icon> 下载媒体
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, h, defineComponent, onMounted, onBeforeUnmount, reactive, watch, computed, nextTick } from 'vue'
import { StarFilled, Star, Picture, CircleCloseFilled, ArrowLeft, Delete, Collection, Download, Loading, DocumentCopy, CirclePlus, ChatLineRound, Close, Top, VideoPlay, VideoPause, Refresh, Mute, Key, FullScreen } from '@element-plus/icons-vue'
import { ElMessageBox, ElMessage } from 'element-plus'
import { send } from '@koishijs/client'
import { useChatLogic } from './chat-logic'

// ========== 从 useChatLogic 导入 ==========
const {
  bots, selectedBot, selectedChannel, currentChannels, currentMessages, currentChannelName, botName,
  inputText, uploadedImages, isSending, pinnedBots, pinnedChannels, scrollRef,
  isMobile, mobileView, goBack, forwardData, imageViewer, imageZoom, rawMessage, isLoadingHistory,
  forwardDialogVisible, imageViewerVisible, rawMessageVisible, replyingTo, userProfile, userProfileVisible,
  selectedBotPlatform, keyboardHeight,
  userNames, unreadCounts, unreadTotal,
  uploadedFiles, handleFileSelect, removeUploadedFile,
  selectBot, selectChannel, handleSend, togglePinBot, togglePinChannel, deleteBotData, deleteChannelData,
  getCachedImageUrl, cacheImage, loadVideo, isVideoLoading, isVideoLoaded, showForward, openImageViewer, handleImageWheel, downloadImage, handleScroll,
  repeatMessage, handlePaste, copyToClipboard, onBotMenu, onChannelMenu, onMessageMenu, handleMenuAction, handleMessageAction, showUserProfile,
  menu, inputRef, scrollToMessage, notifications, dismissNotification, gotoNotification, refreshBotState,
  inputDisabled, inputDisabledHint,
  // QQ表情相关
  parseMessageContent, getQQEmojiUrl, extractQQEmoji, nativeEmojiIds, superEmojiIds, sendNativeEmoji
} = useChatLogic()

// 表情面板开关（点击发送后自动收起）
const emojiPanelVisible = ref(false)
// 表情面板分类：native=经典小表情，super=大表情
const emojiTab = ref<'native' | 'super'>('native')

// 点击 QQ 表情：直接当图片（apng 动图）发送
const pickNativeEmoji = (faceId: string, faceType?: string) => {
  emojiPanelVisible.value = false
  void sendNativeEmoji(faceId, faceType)
}

// ========== 语音“转码播放” ==========
// 内容里的远程 QQ 语音（silk / 需鉴权链接）浏览器直接播不了，
// 通过服务端 silk 服务 + ffmpeg 服务转成本地 mp3 后再播放
;(window as any).__qqChatTranscodeAudio = async (btn: HTMLButtonElement) => {
  try {
    const wrap = btn?.parentElement
    const audio = wrap?.querySelector('audio')
    const src = (audio?.getAttribute('data-src') || audio?.currentSrc || audio?.src || '').toString()
    if (!audio || !src) return
    btn.disabled = true
    const original = btn.textContent
    btn.textContent = '转码中…'
    const res = await (send as any)('transcode-audio', { url: src })
    if (res?.success && res.url) {
      audio.src = res.url
      btn.textContent = '✓ 已转码'
      setTimeout(() => {
        if (btn.isConnected) btn.remove()
      }, 1200)
      audio.play().catch(() => {})
    } else {
      btn.disabled = false
      btn.textContent = res?.error || '转码失败'
      setTimeout(() => { if (btn.isConnected) btn.textContent = original }, 2500)
    }
  } catch (e) {
    console.error('语音转码失败:', e)
    if (btn?.isConnected) {
      btn.disabled = false
      btn.textContent = '转码失败'
    }
  }
}

// ========== 以下为模板中使用的本地变量和函数 ==========

// 当前选中频道的完整信息
const currentChannelInfo = computed(() => {
  return currentChannels.value.find(c => c.id === selectedChannel.value && c.selfId === selectedBot.value) || null
})

// 输入框 placeholder
const inputPlaceholder = computed(() => {
  if (currentChannelInfo.value?.botState?.globalMuted) return '全体禁言中，无法发送消息'
  if (inputDisabledHint.value) return inputDisabledHint.value
  if (currentChannelInfo.value?.botState?.allowProactiveMsg === false) {
    return '该群未开启机器人主动推送权限，发送的消息可能无法送达'
  }
  return '输入消息...'
})

// 消息发送者的群角色
const msgRole = (msg: any) => {
  if (msg?.role === 'owner' || msg?.role === 'admin') return msg.role
  const isOwn = msg?.isBot || msg?.userId === selectedBot.value
  if (isOwn) {
    const role = currentChannelInfo.value?.botState?.memberRole
    if (role === 'owner' || role === 'admin') return role
  }
  return ''
}

// 目标消息发送者是否为群主/管理员
const isTargetAdminOrOwner = (msg: any) => {
  const targetRole = (menu.value as any)?.targetRole
  if (targetRole === 'owner' || targetRole === 'admin') return true
  if (targetRole === 'member') return false
  const r = msgRole(msg)
  return r === 'owner' || r === 'admin'
}

// 是否允许撤回
const canRecallMsg = computed(() => {
  const msg = (menu.value as any)?.data
  if (!msg) return false
  const isOwn = msg.isBot || msg.userId === selectedBot.value
  if (isOwn) return true
  const botRole = currentChannelInfo.value?.botState?.memberRole
  if (botRole === 'owner') return true
  if (botRole === 'admin') return !isTargetAdminOrOwner(msg)
  return false
})

// 是否可禁言
const canMuteMsg = computed(() => {
  const msg = (menu.value as any)?.data
  if (!msg) return false
  const isOwn = msg.isBot || msg.userId === selectedBot.value
  if (isOwn) return false
  const botRole = currentChannelInfo.value?.botState?.memberRole
  if (botRole === 'owner') return true
  if (botRole === 'admin') return !isTargetAdminOrOwner(msg)
  return false
})

// 禁言对话框
const muteDialog = ref({ visible: false, botId: '', channelId: '', memberOpenid: '', username: '' })
const muteDuration = ref<Date>(new Date(0, 0, 0, 0, 10, 0))

// 管理群面板
const manageDialog = ref({ visible: false, botId: '', channelId: '', name: '' })
const manageTab = ref('join')
const joinRequests = ref<any[]>([])
const mutedMembers = ref<any[]>([])
const joinRequestsLoading = ref(false)
const mutedLoading = ref(false)

// Markdown 对话框
const mdDialog = ref({ visible: false, botId: '', channelId: '', name: '' })
const mdTab = ref('native')
const mdContent = ref('')
const mdButtons = ref<any[]>([{ label: '', data: '' }])
const mdSending = ref(false)

// 参数指令
const cmdText = ref('')
const cmdShow = ref('')
const cmdReference = ref(false)

// B 站相关
const biliSearchOpenId = ref('')
const biliSearchState = reactive({
  loading: false,
  results: [] as any[],
  keyword: '',
  error: ''
})
const biliResolved = reactive<Record<string, any>>({})
const biliResolving = ref('')
const biliPlayer = reactive({
  visible: false,
  title: '',
  author: '',
  duration: '',
  cover: '',
  src: '',
  id: '',
  x: 0,
  y: 0
})
const biliVideoRef = ref<HTMLVideoElement | null>(null)
const biliFullscreen = ref(false)

// 网易云相关
const neteaseResolved = reactive<Record<string, any>>({})
const neteaseResolving = ref('')
const neteasePlayer = reactive({
  visible: false,
  title: '',
  artist: '',
  cover: '',
  src: '',
  id: ''
})
const audioRef = ref<HTMLAudioElement | null>(null)
const audioPlaying = ref(false)

// ========== 函数定义 ==========

const recvMsgLabel = (setting?: string) => {
  if (setting === 'all') return '接收全部消息'
  if (setting === 'only_mention') return '仅接收@消息'
  if (setting === 'mention_and_context') return '接收@及上下文'
  return ''
}

const refreshCurrentBotState = async () => {
  if (!selectedBot.value || !selectedChannel.value) return
  const state = await refreshBotState(selectedBot.value, selectedChannel.value)
  if (state) {
    ElMessage.success('群内状态已刷新')
  } else {
    ElMessage.warning('刷新失败（请检查机器人是否已申请获取群内状态接口权限）')
  }
}

const openManageGroup = (botId: string, channelId: string) => {
  const ch = currentChannels.value.find(c => c.id === channelId && c.selfId === botId)
  manageDialog.value = { visible: true, botId, channelId, name: ch?.name || channelId }
  void loadJoinRequests()
  void loadMutedMembers()
}

const onManageDialogOpen = () => {
  void loadJoinRequests()
  void loadMutedMembers()
}

const loadJoinRequests = async () => {
  const d = manageDialog.value
  if (!d.botId || !d.channelId) return
  joinRequestsLoading.value = true
  try {
    const res = await (send as any)('get-join-requests', { selfId: d.botId, channelId: d.channelId, limit: 20 })
    if (res?.success) joinRequests.value = res.list || []
    else ElMessage.error(res?.error || '获取入群申请失败')
  } finally {
    joinRequestsLoading.value = false
  }
}

const approveJoinRequest = async (req: any, approve: boolean) => {
  const d = manageDialog.value
  const res = await (send as any)('handle-join-request', {
    selfId: d.botId,
    channelId: d.channelId,
    memberOpenid: req.member_openid,
    joinRequestId: req.join_request_id,
    op: approve ? 'approve' : 'decline'
  })
  if (res?.success) {
    ElMessage.success(approve ? '已通过申请' : '已拒绝申请')
    joinRequests.value = joinRequests.value.filter(r => r.join_request_id !== req.join_request_id)
  } else {
    ElMessage.error(res?.error || (approve ? '通过失败' : '拒绝失败'))
  }
}

const loadMutedMembers = async () => {
  const d = manageDialog.value
  if (!d.botId || !d.channelId) return
  mutedLoading.value = true
  try {
    const res = await (send as any)('get-muted-members', { selfId: d.botId, channelId: d.channelId })
    if (res?.success) mutedMembers.value = res.members || []
    else ElMessage.error(res?.error || '获取禁言列表失败')
  } finally {
    mutedLoading.value = false
  }
}

const unmuteMember = async (member: any) => {
  const d = manageDialog.value
  const res = await (send as any)('mute-user', {
    selfId: d.botId,
    channelId: d.channelId,
    memberOpenid: member.member_openid,
    muteExpireAt: null
  })
  if (res?.success) {
    ElMessage.success('已解除禁言')
    mutedMembers.value = mutedMembers.value.filter(m => m.member_openid !== member.member_openid)
  } else {
    ElMessage.error(res?.error || '解除禁言失败')
  }
}

const formatMuteTime = (iso: string) => {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? (iso || '') : d.toLocaleString()
}

// 判断 face 元素
const isFaceElement = (el: any) => {
  if (!el) return false
  if (el.type === 'face' || el.type === 'faceType') return true
  if (el.attrs && ('faceId' in el.attrs || 'faceType' in el.attrs)) return true
  if (el.type === 'text' && /^<face[^>]*>\s*$/i.test((el.attrs?.content || '').trim())) return true
  return false
}

// 过滤掉 face 元素后的可见元素
const visibleElements = (msg: any) => {
  if (!msg.elements || !msg.elements.length) return []
  return msg.elements.filter((el: any) => !isFaceElement(el))
}

const isMessageVisible = (msg: any) => {
  if (visibleElements(msg).length) return true
  const content = String(msg.content || '')
  if (!content.trim()) return false
  // 只去掉 QQ 表情占位符（它们会渲染成图片 / “不支持的第三方表情”提示）
  const stripped = content
    .replace(/<faceType\s*=\s*\d+\b[^>]*>/gi, '')
    .replace(/\[face:\d+\]/gi, '')
    .trim()
  if (stripped.length) return true
  // 仅包含表情标签的消息：只要前端能渲染（faceType=1/2/3 → 图片，4 → 文本提示）就算可见
  return /<faceType\s*=\s*\d+\b/i.test(content) || /\[face:\d+\]/i.test(content)
}

const visibleMessages = computed(() => currentMessages.value.filter((msg: any) => isMessageVisible(msg)))
const systemMessages = computed(() => visibleMessages.value.filter((msg: any) => msg.type === 'system'))
const normalMessages = computed(() => visibleMessages.value.filter((msg: any) => msg.type !== 'system'))

// 合并转发
const isForwardText = (msg: any) => {
  const c = msg.content || ''
  return /\[[^\]]*的聊天记录\]/.test(c) && /=== 消息\s*\d+\s*===/.test(c)
}

const forwardTitle = (msg: any) => {
  const m = String(msg.content || '').match(/\[([^\]]*的聊天记录)\]/)
  return m ? m[1] : '聊天记录'
}

const parseForwardText = (msg: any): any[] => {
  const blocks = String(msg.content || '').split(/\n\s*\n/)
  const result: any[] = []
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean)
    const contentLine = lines.find((l: string) => l.startsWith('[消息内容]'))
    const senderLine = lines.find((l: string) => l.startsWith('[发送者]'))
    const contentText = contentLine ? contentLine.replace(/^\[消息内容\]\s*/, '') : ''
    const sender = senderLine ? senderLine.replace(/^\[发送者\]\s*/, '') : '未知用户'
    const children: any[] = []
    if (contentText) children.push({ type: 'text', attrs: { content: contentText } })
    for (const line of lines) {
      const att = line.match(/^\[附件\d+\]\s*(.*)$/)
      if (!att) continue
      const url = (att[1].match(/URL:\s*(\S+)/) || [])[1]
      if (!url) continue
      const attUrl = url.replace(/&amp;/g, '&')
      const attType = (att[1].match(/类型:\s*(\S+)/) || [])[1] || ''
      const attName = (att[1].match(/文件名:\s*(\S+)/) || [])[1] || 'file'
      if (attType.includes('图片') || attType.includes('image') || attType.includes('img')) {
        children.push({ type: 'image', attrs: { src: attUrl } })
      } else if (attType.includes('视频') || attType.includes('video')) {
        children.push({ type: 'video', attrs: { src: attUrl } })
      } else {
        children.push({ type: 'file', attrs: { src: attUrl, filename: attName } })
      }
    }
    if (contentText || sender || children.length) {
      result.push({
        type: 'message',
        attrs: { nickname: sender, avatar: undefined },
        children
      })
    }
  }
  return result
}

const forwardPreviewText = (m: any) => {
  if (m.children?.some((el: any) => el.type === 'image' || el.type === 'img' || el.type === 'mface')) return '[图片]'
  if (m.children?.some((el: any) => el.type === 'video')) return '[视频]'
  if (m.children?.some((el: any) => el.type === 'file')) return '[文件]'
  return m.children?.[0]?.attrs?.content || '[消息]'
}

const openTextForward = (msg: any) => {
  const parsed = parseForwardText(msg)
  if (parsed.length) showForward(parsed)
}

// 卡片消息
const isCardMessage = (msg: any) => {
  return String(msg.content || '').includes('[卡片消息]')
}

const parseCardMessage = (msg: any) => {
  const c = String(msg.content || '')
  const get = (re: RegExp) => {
    const m = c.match(re)
    return m ? m[1].trim() : ''
  }
  let jumpUrl = get(/^jump_url:\s*(\S+)$/m) || get(/^jumpUrl:\s*(\S+)$/m)
  jumpUrl = jumpUrl.replace(/&amp;/g, '&')
  if (!jumpUrl) {
    const bili = c.match(/https?:\/\/[^\s]*(?:bilibili\.com|b23\.tv)[^\s]*/)
    if (bili) jumpUrl = bili[0].replace(/&amp;/g, '&')
  }
  return {
    title: get(/^title:\s*(.+)$/m),
    summary: get(/^摘要:\s*(.+)$/m),
    desc: get(/^desc:\s*(.+)$/m),
    tag: get(/^tag:\s*(.+)$/m),
    preview: get(/^preview:\s*(\S+)$/m),
    sourceLogo: get(/^source_logo:\s*(\S+)$/m),
    source: get(/^source:\s*(.+)$/m),
    jumpUrl
  }
}

const openCardLink = (url: string) => {
  if (!url) return
  window.open(url, '_blank', 'noopener')
}

const isBiliCardMsg = (msg: any) => {
  const card = parseCardMessage(msg)
  const s = String(card.source || card.tag || '').toLowerCase()
  return s.includes('bili') || s.includes('哔哩哔哩')
}

const isNeteaseCardMsg = (msg: any) => {
  const card = parseCardMessage(msg)
  const s = String(card.source || card.tag || '').toLowerCase()
  return s.includes('网易云') || s.includes('netease')
}

const extractNeteaseId = (url: string) => {
  const m = String(url || '').match(/song\?id=(\d+)/)
  return m ? m[1] : ''
}

const getCardPreview = (msg: any) => {
  const card = parseCardMessage(msg)
  if (card.preview) return card.preview
  if (isNeteaseCardMsg(msg)) return neteaseResolved[msg.id]?.cover || ''
  if (isBiliCardMsg(msg)) return biliResolved[msg.id]?.coverUrl || ''
  return ''
}

const onCardPreviewClick = (msg: any) => {
  if (isNeteaseCardMsg(msg)) {
    void playNetease(msg)
  } else if (isBiliCardMsg(msg)) {
    void playBili(msg)
  } else if (parseCardMessage(msg).preview) {
    openImageViewer(parseCardMessage(msg).preview)
  }
}

// 引用相关
const formatQuoteContent = (quote: any) => {
  const content = quote?.content || ''
  return content.replace(/<[^>]+>/g, '')
}

const visibleQuoteElements = (quote: any) => {
  if (!quote?.elements || !quote.elements.length) return []
  return quote.elements.filter((el: any) => !isFaceElement(el))
}

const getQuoteDisplayName = (quote: any) => {
  if (!quote) return ''
  const qUser = quote.user || {}
  if (qUser.name && qUser.name !== 'unknown') return qUser.name
  if (qUser.username && qUser.username !== 'unknown') return qUser.username
  const qid = qUser.userId || qUser.id || quote.userId || ''
  if (qid && userNames.value[qid]) return userNames.value[qid]
  const content = String(quote.content || '')
  const m1 = content.match(/<at\s+id="([^"]*)"/)
  const m2 = content.match(/<@([^>]+)>/)
  const m3 = content.match(/\[mention:user_openid:([^\]]+)\]/)
  const openid = (m1 && m1[1]) || (m2 && m2[1]) || (m3 && m3[1])
  if (openid && userNames.value[openid]) return userNames.value[openid]
  return qid || openid || '未知用户'
}

// 时间格式化
const formatTime = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

// 文件大小格式化
const formatFileSize = (size: number) => {
  if (!size) return ''
  if (size < 1024) return size + ' B'
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB'
  return (size / 1024 / 1024).toFixed(1) + ' MB'
}

// 下载文件
const downloadFile = async (url: string, filename?: string) => {
  if (!url) return
  ElMessage.info('正在下载文件...')
  const res = await (send as any)('download-file', { url, filename })
  if (res?.success && res.downloadUrl) {
    const a = document.createElement('a')
    a.href = res.downloadUrl
    a.download = res.filename || 'file'
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  } else {
    ElMessage.error(res?.error || '下载失败')
  }
}

// 参数指令标签解析
const cmdTagRe = /<qqbot-cmd-input\b([^>]*?)\/>/gi
const decodeCmdValue = (v: string) => {
  try { return decodeURIComponent(v).replace(/&quot;/g, '"') } catch { return v }
}

const parseCmdTag = (raw: string): { text: string; show: string; reference: boolean } | null => {
  const m = /<qqbot-cmd-input\b([^>]*?)\/>/i.exec(raw)
  if (!m) return null
  const get = (k: string) => {
    const a = new RegExp(`${k}\\s*=\\s*["']([^"']*)["']`, 'i').exec(m[1])
    return a ? decodeCmdValue(a[1]) : ''
  }
  const text = get('text')
  if (!text) return null
  const reference = /reference\s*=\s*["']?true["']?/i.test(m[1])
  return { text, show: get('show') || text, reference }
}

const hasCmdChips = (msg: any) => {
  if (/<qqbot-cmd-input\b/i.test(String(msg.content || ''))) return true
  return (msg.elements || []).some((el: any) => el.type === 'text' && /<qqbot-cmd-input\b/i.test(String(el.attrs?.content || '')))
}

// 是否为“纯 markdown”消息（用于渲染 markdown 图片，如发送的 QQ 表情）
const isMdOnlyMessage = (msg: any) => {
  const els = msg?.elements || []
  const hasMd = els.some((el: any) => el.type === 'markdown' || el.type === 'md')
  if (!hasMd) return false
  return !els.some((el: any) => el.type !== 'text' && el.type !== 'markdown' && el.type !== 'md')
}

const getMdText = (msg: any) => {
  const el = (msg?.elements || []).find((e: any) => e.type === 'markdown' || e.type === 'md')
  return el ? String(el.attrs?.content || '') : String(msg?.content || '')
}

const buildMessageSegments = (msg: any): any[] => {
  const list: any[] = []
  const pushText = (t: string, md = false) => {
    if (!t) return
    const last = list[list.length - 1]
    if (last && last.kind === 'text' && last.md === md) last.text += t
    else list.push({ kind: 'text', text: t, md })
  }
  const splitText = (t: string, md: boolean) => {
    cmdTagRe.lastIndex = 0
    let last = 0
    let m: RegExpExecArray | null
    while ((m = cmdTagRe.exec(t))) {
      pushText(t.slice(last, m.index), md)
      const tag = parseCmdTag(m[0])
      if (tag) list.push({ kind: 'chip', tag })
      else pushText(m[0], md)
      last = cmdTagRe.lastIndex
    }
    pushText(t.slice(last), md)
  }
  const els = visibleElements(msg)
  if (els.length) {
    for (const el of els) {
      if (el.type === 'text') splitText(String(el.attrs?.content || ''), false)
      else if (el.type === 'markdown' || el.type === 'md') splitText(String(el.attrs?.content || ''), true)
      else list.push({ kind: 'element', element: el })
    }
  } else {
    splitText(String(msg.content || ''), false)
  }
  return list
}

const onCmdChipClick = (tag: any, msg: any) => {
  if (inputText.value) inputText.value += ' '
  inputText.value += tag.text
  if (tag.reference) replyingTo.value = msg
  nextTick(() => {
    inputRef.value?.focus()
  })
}

// Markdown
const renderMarkdown = (src: string) => {
  if (!src) return ''
  let html = src.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%"/>')
  html = html.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
  html = html.replace(/^###### (.*)$/gm, '<h6>$1</h6>')
  html = html.replace(/^##### (.*)$/gm, '<h5>$1</h5>')
  html = html.replace(/^#### (.*)$/gm, '<h4>$1</h4>')
  html = html.replace(/^### (.*)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.*)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.*)$/gm, '<h1>$1</h1>')
  html = html.replace(/^---+$/gm, '<hr/>')
  html = html.replace(/^&gt; (.*)$/gm, '<blockquote>$1</blockquote>')
  html = html.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
  html = html.replace(/__([^_]+)__/g, '<b>$1</b>')
  html = html.replace(/~~([^~]+)~~/g, '<s>$1</s>')
  html = html.replace(/^- (.*)$/gm, '<li>$1</li>')
  html = html.replace(/^(\d+)\. (.*)$/gm, '<li>$2</li>')
  html = html.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')
  html = html.replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>')
  html = html.replace(/\n/g, '<br/>')
  return html
}

const openMdDialog = () => {
  mdDialog.value = {
    visible: true,
    botId: selectedBot.value,
    channelId: selectedChannel.value,
    name: currentChannelName.value || selectedChannel.value
  }
}

const cmdTag = computed(() => {
  const text = cmdText.value.trim()
  if (!text) return ''
  const show = cmdShow.value.trim() || text
  return `<qqbot-cmd-input text="${encodeURIComponent(text)}" show="${encodeURIComponent(show)}" reference="${cmdReference.value ? 'true' : 'false'}" />`
})

const addCmdToMd = () => {
  const text = cmdText.value.trim()
  if (!text) {
    ElMessage.warning('请输入 text（点击后插入输入框的文本）')
    return
  }
  if (text.length > 100) {
    ElMessage.warning('text 最长 100 字符')
    return
  }
  if (cmdShow.value.trim().length > 100) {
    ElMessage.warning('show 最长 100 字符')
    return
  }
  if (mdContent.value) mdContent.value += '\n'
  mdContent.value += cmdTag.value
  cmdText.value = ''
  cmdShow.value = ''
  cmdReference.value = false
}

const mdButtonList = computed(() => mdButtons.value
  .filter((b: any) => b.label && b.label.trim())
  .map((b: any) => ({
    label: b.label.trim(),
    data: b.data && b.data.trim() ? b.data.trim() : b.label.trim()
  })))

const sendMdMessage = async () => {
  const d = mdDialog.value
  if (!d.botId || !d.channelId) return
  const content = mdContent.value.trim()
  if (!content) {
    ElMessage.warning('请输入 Markdown 内容')
    return
  }
  const buttons = mdButtonList.value
  const keyboard = buttons.length
    ? {
        content: {
          rows: [{
            buttons: buttons.map((b: any, i: number) => ({
              id: `md_btn_${i}_${Date.now()}`,
              render_data: { label: b.label, style: 1 },
              action: {
                type: 2,
                permission: { type: 2 },
                data: b.data,
                reply: false,
                enter: true
              }
            }))
          }]
        }
      }
    : undefined
  mdSending.value = true
  try {
    const res = await (send as any)('send-md', {
      selfId: d.botId,
      channelId: d.channelId,
      content,
      keyboard
    })
    if (res?.success) {
      ElMessage.success('Markdown 已发送')
      mdDialog.value.visible = false
    } else {
      ElMessage.error(res?.error || '发送失败')
    }
  } finally {
    mdSending.value = false
  }
}

// 禁言
const openMuteDialog = () => {
  const msg = (menu.value as any)?.data
  menu.value.show = false
  if (!msg) return
  muteDialog.value = {
    visible: true,
    botId: selectedBot.value,
    channelId: selectedChannel.value,
    memberOpenid: msg.userId || '',
    username: msg.username || msg.userId || ''
  }
}

const confirmMute = async () => {
  const d = muteDuration.value
  if (!d) {
    ElMessage.warning('请选择禁言时长')
    return
  }
  const ms = d.getHours() * 3600000 + d.getMinutes() * 60000 + d.getSeconds() * 1000
  if (ms <= 0) {
    ElMessage.warning('禁言时长必须大于 0')
    return
  }
  const expire = Date.now() + ms
  const res = await (send as any)('mute-user', {
    selfId: muteDialog.value.botId,
    channelId: muteDialog.value.channelId,
    memberOpenid: muteDialog.value.memberOpenid,
    muteExpireAt: expire
  })
  muteDialog.value.visible = false
  if (res?.success) {
    ElMessage.success(`已禁言至 ${new Date(expire).toLocaleString()}`)
  } else {
    ElMessage.error(res?.error || '禁言失败')
  }
}

const unmuteUser = async () => {
  const d = muteDialog.value
  const res = await (send as any)('mute-user', {
    selfId: d.botId,
    channelId: d.channelId,
    memberOpenid: d.memberOpenid,
    muteExpireAt: null
  })
  d.visible = false
  if (res?.success) {
    ElMessage.success('已解除禁言')
  } else {
    ElMessage.error(res?.error || '解除禁言失败')
  }
}

// 查看用户 OpenID
const escHtml = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const viewUserOpenid = () => {
  const msg = (menu.value as any)?.data
  menu.value.show = false
  if (!msg) return
  const openid = msg.userId || ''
  ElMessageBox.alert(
    `<div>用户名：${escHtml(msg.username)}</div><div style="word-break:break-all;margin-top:6px">OpenID：<b>${escHtml(openid)}</b></div>`,
    '用户 OpenID',
    {
      dangerouslyUseHTMLString: true,
      confirmButtonText: '复制',
      cancelButtonText: '关闭',
      showCancelButton: true
    }
  ).then(() => {
    copyToClipboard(openid).then(() => ElMessage.success('已复制 OpenID'))
  }).catch(() => {})
}

// ========== B 站相关 ==========

const doBiliSearch = async (keyword: string) => {
  biliSearchState.loading = true
  biliSearchState.results = []
  biliSearchState.keyword = keyword
  biliSearchState.error = ''
  try {
    const result = await (send as any)('bili-search', { keyword, limit: 8 })
    if (result.success) {
      biliSearchState.results = result.results || []
      if (!biliSearchState.results.length) biliSearchState.error = '未找到相关视频'
    } else {
      biliSearchState.error = result.error || '搜索失败'
    }
  } catch (e: any) {
    biliSearchState.error = e?.message || String(e)
  } finally {
    biliSearchState.loading = false
  }
}

const openBiliVideo = (bvid: string) => {
  biliSearchOpenId.value = ''
  openCardLink(`https://www.bilibili.com/video/${bvid}`)
}

const biliUrlRe = /https?:\/\/[\w.-]*(?:bilibili\.com|b23\.tv)\/[^\s<>，。；！？、）)]*/i

const extractBiliUrl = (msg: any) => {
  const card = parseCardMessage(msg)
  if (card.jumpUrl && /(?:bilibili\.com|b23\.tv)/i.test(card.jumpUrl)) return card.jumpUrl
  const m = String(msg.content || '').match(biliUrlRe)
  return m ? m[0].replace(/&amp;/g, '&') : ''
}

const hasBiliLink = (msg: any) => biliUrlRe.test(String(msg.content || ''))

const resolveBili = async (msg: any, urlOverride?: string): Promise<any> => {
  const url = urlOverride || extractBiliUrl(msg)
  if (!url) return null
  if (biliResolved[msg.id] && biliResolved[msg.id].sourceUrl === url) return biliResolved[msg.id]
  if (biliResolving.value === msg.id) return null
  biliResolving.value = msg.id
  try {
    const result = await (send as any)('bili-parse', { url })
    if (result.success) biliResolved[msg.id] = result
    return result
  } catch (e: any) {
    console.warn('B 站解析失败:', e)
  } finally {
    if (biliResolving.value === msg.id) biliResolving.value = ''
  }
  return null
}

const playBili = async (msg: any) => {
  let url = extractBiliUrl(msg)
  if (!url) {
    const card = parseCardMessage(msg)
    if (!card.title) {
      ElMessage.warning('无法解析该 B 站消息')
      return
    }
    try {
      ElMessage.info(`正在搜索「${card.title}」...`)
      const search = await (send as any)('bili-search', { keyword: card.title, limit: 8 })
      const results = search?.success ? (search.results || []) : []
      const norm = (s: string) => String(s).replace(/<[^>]*>/g, '').replace(/\s+/g, '').toLowerCase()
      const kw = norm(card.title)
      let picked = results.find((r: any) => kw && norm(r.title) === kw)
      if (!picked && kw) {
        picked = results.find((r: any) =>
          norm(r.title).includes(kw) || (kw.includes(norm(r.title)) && norm(r.title).length >= 4))
      }
      if (!picked) picked = results[0]
      if (!picked?.bvid) {
        ElMessage.warning('未搜索到相关视频')
        return
      }
      url = `https://www.bilibili.com/video/${picked.bvid}`
    } catch {
      ElMessage.warning('自动搜索失败')
      return
    }
  }
  ElMessage.info('正在解析视频...')
  let data = biliResolved[msg.id]
  if (!data || data.sourceUrl !== url) data = await resolveBili(msg, url)
  if (!data?.videoUrl) {
    ElMessage.warning(data?.error || '解析失败，可能为番剧/电影/电视剧或链接无效')
    return
  }
  biliPlayer.visible = true
  biliPlayer.title = data.title || ''
  biliPlayer.author = data.author || ''
  biliPlayer.duration = data.durationFormat || ''
  biliPlayer.cover = data.coverUrl || ''
  biliPlayer.src = data.videoUrl
  biliPlayer.id = msg.id
  biliPlayer.x = isMobile.value ? 8 : Math.max(8, window.innerWidth - 292)
  biliPlayer.y = Math.max(8, Math.round(window.innerHeight * 0.1))
  nextTick(() => {
    const video = biliVideoRef.value
    if (!video) return
    video.src = data.videoUrl
    video.play().catch(() => ElMessage.warning('播放失败，视频可能已失效'))
  })
}

const closeBiliPlayer = () => {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
  const video = biliVideoRef.value
  if (video) {
    video.pause()
    video.removeAttribute('src')
    video.load()
  }
  biliPlayer.visible = false
}

const onBiliFullscreen = async () => {
  const video = biliVideoRef.value
  if (!video) return
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen()
    } else if (video.requestFullscreen) {
      await video.requestFullscreen()
    } else {
      ElMessage.warning('当前环境不支持全屏')
    }
  } catch {
    ElMessage.warning('全屏切换失败')
  }
}

const onBiliFsChange = () => {
  biliFullscreen.value = !!document.fullscreenElement
}

const onBiliFloatDragStart = (e: PointerEvent) => {
  const target = e.target as HTMLElement
  if (target.closest('button, video, a')) return
  e.preventDefault()
  const startX = e.clientX
  const startY = e.clientY
  const origX = biliPlayer.x
  const origY = biliPlayer.y
  const onMove = (ev: PointerEvent) => {
    const w = isMobile.value ? window.innerWidth - 16 : Math.min(280, window.innerWidth - 24)
    const maxX = Math.max(0, window.innerWidth - w)
    const maxY = Math.max(0, window.innerHeight - 120)
    biliPlayer.x = Math.min(Math.max(0, origX + ev.clientX - startX), maxX)
    biliPlayer.y = Math.min(Math.max(0, origY + ev.clientY - startY), maxY)
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

const formatPlayCount = (play: any) => {
  const n = Number(play)
  if (!n) return ''
  if (n >= 100000000) return `${(n / 100000000).toFixed(1)}亿`
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`
  return String(n)
}

const formatDuration = (duration: any) => {
  const total = Number(duration)
  if (!total) return ''
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = h ? String(m).padStart(2, '0') : String(m)
  const ss = String(s).padStart(2, '0')
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

const openCardDetail = (msg: any) => {
  const card = parseCardMessage(msg)
  if (card.jumpUrl) {
    openCardLink(card.jumpUrl)
  } else if (isBiliCardMsg(msg) && card.title) {
    if (biliSearchOpenId.value === msg.id) {
      biliSearchOpenId.value = ''
    } else {
      biliSearchOpenId.value = msg.id
      void doBiliSearch(card.title)
    }
  } else if (card.preview) {
    window.open(card.preview, '_blank', 'noopener')
  }
}

// ========== 网易云相关 ==========

const resolveNetease = async (msg: any): Promise<any> => {
  const card = parseCardMessage(msg)
  if (!card.jumpUrl) return null
  const id = extractNeteaseId(card.jumpUrl)
  if (!id) return null
  if (neteaseResolved[msg.id]) return neteaseResolved[msg.id]
  if (neteaseResolving.value === msg.id) return null
  neteaseResolving.value = msg.id
  try {
    const result = await (send as any)('netease-resolve', { id })
    if (result.success && result.data) {
      neteaseResolved[msg.id] = result.data
      return result.data
    }
  } catch (e: any) {
    console.warn('网易云解析失败:', e)
  } finally {
    if (neteaseResolving.value === msg.id) neteaseResolving.value = ''
  }
  return null
}

const playNetease = async (msg: any) => {
  const card = parseCardMessage(msg)
  let data = neteaseResolved[msg.id]
  if (!data) data = await resolveNetease(msg)
  if (!data?.link) {
    if (card.jumpUrl) openCardLink(card.jumpUrl)
    else ElMessage.warning('未能解析到可播放的音乐')
    return
  }
  neteasePlayer.visible = true
  neteasePlayer.title = data.title || card.title
  neteasePlayer.artist = data.artist || card.desc
  neteasePlayer.cover = data.cover || ''
  neteasePlayer.src = data.link
  neteasePlayer.id = msg.id
  nextTick(() => {
    const audio = audioRef.value
    if (!audio) return
    if (audio.src !== neteasePlayer.src) {
      audio.src = neteasePlayer.src
    }
    audio.play().then(() => { audioPlaying.value = true }).catch(() => {
      ElMessage.warning('播放失败，可能已失效或无版权')
    })
  })
}

const toggleNeteasePlay = () => {
  const audio = audioRef.value
  if (!audio) return
  if (audio.paused) {
    audio.play().catch(() => {})
  } else {
    audio.pause()
  }
}

const closeNeteasePlayer = () => {
  const audio = audioRef.value
  if (audio) {
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
  }
  audioPlaying.value = false
  neteasePlayer.visible = false
}

// ========== 监听消息变化自动解析 ==========

watch(currentMessages, () => {
  for (const msg of visibleMessages.value) {
    if (isNeteaseCardMsg(msg) && !neteaseResolved[msg.id] && neteaseResolving.value !== msg.id) {
      void resolveNetease(msg)
    }
    if (isBiliCardMsg(msg) && !biliResolved[msg.id] && biliResolving.value !== msg.id) {
      void resolveBili(msg)
    }
  }
}, { deep: true })

// ========== 菜单操作 ==========

const onHandleMenuAction = async (action: string) => {
  if (action === 'delete') {
    try {
      await ElMessageBox.confirm('确定删除所有数据吗？此操作不可恢复。', '警告', {
        type: 'warning',
        confirmButtonClass: 'el-button--danger'
      })
      await handleMenuAction(action)
    } catch (e) {
      // 取消删除
    }
  } else {
    await handleMenuAction(action)
  }
}

// ========== 图片上传 ==========

const handleFileChange = async (file: any) => {
  const reader = new FileReader()
  reader.onload = async (e) => {
    const base64 = e.target?.result as string
    const res = await (send as any)('upload-image', {
      file: base64,
      filename: file.name,
      mimeType: file.raw.type
    })
    if (res.success) {
      uploadedImages.value.push({
        tempId: res.tempId,
        preview: URL.createObjectURL(file.raw),
        filename: file.name
      })
    }
  }
  reader.readAsDataURL(file.raw)
}

const removeImage = (id: string) => {
  uploadedImages.value = uploadedImages.value.filter(i => i.tempId !== id)
}

// ========== 消息渲染组件 ==========

const RenderElement = defineComponent({
  props: ['element', 'botId', 'channelId', 'inQuote'],
  setup(props) {
    const imgUrl = ref('')
    const videoUrl = ref('')
    const videoLoading = ref(false)
    const isMedia = ['img', 'image', 'mface', 'audio', 'video'].includes(props.element.type)

    const loadMedia = async () => {
      const url = props.element.attrs.src || props.element.attrs.url || props.element.attrs.file
      if (url) {
        if (props.element.type === 'video') {
          videoUrl.value = url
          return
        }
        const res = await getCachedImageUrl(`${props.botId}:${props.channelId}`, url)
        if (res) imgUrl.value = res
        else {
          const r = await cacheImage(`${props.botId}:${props.channelId}`, url)
          imgUrl.value = r || url
        }
      }
    }

    if (isMedia) loadMedia()
    watch(() => props.element.attrs.src || props.element.attrs.url || props.element.attrs.file, loadMedia)

    const handleVideoClick = async () => {
      if (!videoUrl.value || videoLoading.value) return
      if (isVideoLoaded(videoUrl.value)) {
        const loadedUrl = await loadVideo(videoUrl.value)
        if (loadedUrl) imgUrl.value = loadedUrl
        return
      }
      videoLoading.value = true
      const loadedUrl = await loadVideo(videoUrl.value)
      if (loadedUrl) {
        imgUrl.value = loadedUrl
      }
      videoLoading.value = false
    }

    const onImageLoad = () => {
      if (props.inQuote) return
      const wrap = document.querySelector('.el-main .el-scrollbar__wrap')
      if (wrap) {
        const isAtBottom = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 150
        if (isAtBottom) {
          nextTick(() => {
            wrap.scrollTop = wrap.scrollHeight
          })
        }
      }
    }

    return () => {
      const { element, botId, channelId } = props
      const type = element.type
      const attrs = element.attrs

      if (isFaceElement(element)) return null
      
      // 如果是表情类型，直接渲染为图片
      if ((type === 'face' || type === 'faceType') && attrs?.faceId) {
        const faceId = String(attrs.faceId)
        const imgUrl_ = getQQEmojiUrl(faceId)
        return h('img', {
          src: imgUrl_,
          class: 'qq-emoji',
          alt: `[face:${faceId}]`,
          'data-face-id': faceId,
          onError: (e: any) => {
            e.target.style.display = 'none'
          }
        })
      }

      if (type === 'text') {
        // 文本内容使用 parseMessageContent 渲染表情（支持 <faceType=3,faceId="479",...> 新格式）
        const content = attrs.content || ''
        if (/<faceType\s*=\s*\d+\b/i.test(content) || /\[face:\d+\]/i.test(content)) {
          return h('span', { innerHTML: parseMessageContent({ content }) })
        }
        return h('span', content)
      }
      
      if (type === 'markdown') {
        return h('div', { class: 'chat-md-preview my-1', innerHTML: renderMarkdown(attrs.content || '') })
      }
      
      if (type === 'img' || type === 'image' || type === 'mface') {
        if (props.inQuote) return h('span', { class: 'opacity-60 italic mx-1' }, '[图片]')
        const isMface = type === 'mface'
        return h('div', { class: 'block my-1.5' }, [
          h('img', {
            src: imgUrl.value,
            class: ['rounded-lg shadow-sm border border-black/5 block cursor-pointer hover:opacity-90 transition-opacity', isMface ? 'max-w-[100px] max-h-[100px]' : 'max-w-full max-h-[400px]'],
            style: `min-width: ${isMface ? '30px' : '50px'}; min-height: ${isMface ? '30px' : '50px'}; object-fit: contain; background: rgba(0,0,0,0.05)`,
            onClick: (e: Event) => {
              e.stopPropagation()
              openImageViewer(imgUrl.value)
            },
            onLoad: onImageLoad,
            onError: (e: any) => {
              e.target.src = ''
              e.target.alt = '图片加载失败'
            }
          })
        ])
      }
      
      if (type === 'audio') {
        return h('audio', { src: imgUrl.value, controls: true, class: 'max-w-full my-1.5 block' })
      }
      
      if (type === 'video') {
        if (imgUrl.value) {
          return h('video', {
            src: imgUrl.value,
            controls: true,
            class: 'max-w-full my-1.5 rounded-lg shadow-sm block'
          })
        }
        return h('div', {
          class: 'my-1.5 p-4 bg-black/5 dark:bg-white/5 rounded-lg border border-black/10 dark:border-white/10 cursor-pointer hover:bg-black/10 dark:hover:bg-white/10 transition-colors flex items-center justify-center gap-2',
          onClick: handleVideoClick
        }, [
          videoLoading.value
            ? h('el-icon', { class: 'is-loading' }, { default: () => h(Loading) })
            : h('el-icon', null, { default: () => h(Picture) }),
          h('span', { class: 'text-sm' }, videoLoading.value ? '加载中...' : '点击加载视频')
        ])
      }
      
      if (type === 'at') {
        const name = userNames.value[attrs?.id] || attrs?.name || attrs?.id
        return h('span', { class: 'text-blue-500 font-bold hover:underline cursor-default mx-0.5' }, `@${name}`)
      }
      
      if (type === 'file') {
        const url = attrs.src || attrs.url || attrs.file
        const name = attrs.filename || attrs.name || '文件'
        const sizeText = formatFileSize(Number(attrs.size) || 0)
        return h('div', {
          class: 'chat-file-card',
          title: '点击下载',
          onClick: (e: Event) => { e.stopPropagation(); if (url) downloadFile(url, name) }
        }, [
          h('span', { class: 'chat-file-card-icon' }, '📎'),
          h('div', { class: 'chat-file-card-info' }, [
            h('div', { class: 'chat-file-card-name' }, name),
            h('div', { class: 'chat-file-card-meta' }, sizeText || '点击下载')
          ])
        ])
      }

      if (type === 'p') {
        return h('div', { class: 'my-1 block min-h-[1em]' }, (element.children || []).map((child: any, i: number) => h(RenderElement, { key: i, element: child, botId, channelId })))
      }
      
      if (type === 'i18n') {
        return h('span', { class: 'opacity-80 italic' }, `[${attrs.path || 'i18n'}]`)
      }

      if (type === 'figure' || type === 'forward') {
        return h('div', {
          class: 'my-2 p-3 bg-black/5 dark:bg-white/5 rounded-xl border border-black/10 dark:border-white/10 max-w-[300px] cursor-pointer hover:bg-black/10 dark:hover:bg-white/10 transition-colors',
          onClick: (e: Event) => { e.stopPropagation(); showForward(element.children || []) }
        }, [
          h('div', { class: 'flex items-center gap-2 mb-2 font-bold text-sm opacity-80' }, [
            h('el-icon', null, { default: () => h(Collection) }),
            h('span', '合并转发记录')
          ]),
          h('div', { class: 'space-y-1.5' }, (element.children || []).filter((c: any) => c.type === 'message').slice(0, 4).map((child: any) => {
            return h('div', { class: 'text-xs truncate opacity-70' }, [
              h('span', { class: 'font-bold mr-1' }, `${child.attrs?.nickname || '用户'}:`),
              h('span', child.children?.[0]?.attrs?.content || '[富媒体内容]')
            ])
          })),
          (element.children?.length > 4) ? h('div', { class: 'mt-2 pt-2 border-t border-black/5 dark:border-white/5 text-[10px] opacity-50' }, `查看更多 ${element.children.length} 条内容...`) : null
        ])
      }

      if (type === 'quote') return null

      return h('span', { class: 'text-gray-400 italic text-xs' }, `[${type}]`)
    }
  }
})

// 全局注册组件（供模板使用）
declare module 'vue' {
  interface GlobalComponents {
    RenderElement: typeof RenderElement
  }
}

// ========== 生命周期 ==========

onMounted(() => {
  document.addEventListener('pointerdown', onBiliPopGlobalClick, true)
  document.addEventListener('fullscreenchange', onBiliFsChange)
})

const onBiliPopGlobalClick = (e: PointerEvent) => {
  if (!biliSearchOpenId.value) return
  const el = e.target as HTMLElement
  if (el.closest('.chat-bili-popper') || el.closest('.chat-card-msg-open')) return
  biliSearchOpenId.value = ''
}

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onBiliPopGlobalClick, true)
  document.removeEventListener('fullscreenchange', onBiliFsChange)
})

// 导出组件（script setup 下通过 defineOptions 声明组件名；
// RenderElement 已在 setup 作用域内定义，模板中可直接使用）
defineOptions({
  name: 'QQChat',
})
</script>
