<template>
  <div
    :class="['qq-chat-wrapper absolute inset-0 flex overflow-hidden bg-[var(--k-page-bg)] text-[var(--k-text-color)] font-sans', props.standalone ? 'is-standalone' : '', props.sandbox ? 'is-sandbox-window' : '']"
    :style="[wallpaperStyle, isMobile ? 'height: 100dvh; width: 100vw; position: fixed; top: 0; left: 0;' : 'height: 100%; width: 100%;']"
    @dragenter.prevent="onWindowDragEnter" @dragover.prevent="onWindowDragOver"
    @dragleave="onWindowDragLeave" @drop.prevent="onWindowDrop">

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
        :width="isMobile ? '100%' : sidebarWidth + 'px'"
        class="chat-sidebar flex flex-col border-r border-[var(--k-border-color)] bg-[var(--k-page-bg)] brightness-95 dark:brightness-90 h-full overflow-hidden">
        <!-- 频道列表（合并所有机器人） -->
        <div
          class="chat-sidebar-head flex h-14 items-center px-4 font-bold border-b border-[var(--k-border-color)] text-lg text-[var(--k-text-color)] flex-shrink-0">
          <el-button v-if="isMobile" icon="ArrowLeft" circle size="small" class="mr-3" @click="goBack" />
          <span class="chat-sidebar-title">频道</span>
          <span v-if="unreadTotal" class="chat-sidebar-count is-unread" :title="`未读消息 ${unreadTotal} 条`">{{ unreadTotal > 99 ? '99+' : unreadTotal }}</span>
        </div>
        <div class="chat-sidebar-search">
          <el-input v-model="channelKeyword" placeholder="搜索" clearable size="small" class="chat-search-input">
            <template #prefix>
              <el-icon>
                <Search />
              </el-icon>
            </template>
          </el-input>
        </div>
        <el-scrollbar class="flex-1 overflow-auto">
          <div v-if="filteredChannels.length === 0" class="p-10 text-center opacity-40 text-sm">暂无频道数据</div>
          <div v-for="channel in filteredChannels" :key="`${channel.selfId}:${channel.id}`"
            :class="['chat-channel-item flex items-center p-4 cursor-pointer transition-all hover:bg-[var(--k-button-hover-bg)] border-l-4 border-transparent', { 'is-active !border-[var(--k-color-primary)] bg-[var(--k-button-active-bg)] text-[var(--k-color-primary)]': selectedBot === channel.selfId && selectedChannel === channel.id, 'is-drop-target': dropTargetKey === `${channel.selfId}:${channel.id}` }]"
            :draggable="!isMobile"
            @click="selectChannel(channel.id, channel.selfId)" @contextmenu.prevent="onChannelMenu($event, channel)"
            @dragstart="onChannelDragStart($event, channel)" @dragend="onChannelDragEnd"
            @dragover="onChannelDragOver($event, channel)" @dragleave="onChannelDragLeave"
            @drop.stop.prevent="onChannelDrop($event, channel)">
            <span class="chat-channel-avatar" :style="channelAvatarStyle(channel)">{{ channelInitial(channel) }}</span>
            <div class="chat-channel-main flex-1 overflow-hidden min-w-0">
              <div class="chat-channel-row">
                <span class="chat-channel-name truncate">{{ channelDisplayName(channel) }}</span>
                <span class="chat-channel-time">{{ channelTime(channel) }}</span>
              </div>
              <div class="chat-channel-row chat-channel-sub">
                <span class="chat-channel-preview truncate">
                  <em v-if="atMeCounts[`${channel.selfId}:${channel.id}`]" class="chat-at-me-tag">[有人@我]</em>{{ channelPreview(channel) }}
                </span>
                <span v-if="!channel.isDirect && channel.botState?.inGroup === false" class="chat-proactive-badge chat-kicked-badge" title="机器人已不在该群（可能被移出）">已退群</span>
                <el-icon v-else-if="pinnedChannels.has(`${channel.selfId}:${channel.id}`)" class="chat-pin-icon">
                  <StarFilled />
                </el-icon>
                <span v-if="channelBadge(channel)" class="chat-count-badge"
                  :class="{ 'is-muted': channelBadgeMuted(channel) }"
                  :title="atMeCounts[`${channel.selfId}:${channel.id}`] ? '有人@了机器人' : (channelBadgeMuted(channel) ? '未读消息（免打扰）' : '未读消息')">
                  {{ channelBadge(channel) > 99 ? '99+' : channelBadge(channel) }}
                </span>
              </div>
            </div>
          </div>
        </el-scrollbar>
        <div v-if="!isMobile" class="chat-sidebar-resizer" title="拖动调整频道列表宽度"
          @mousedown.prevent="startSidebarResize"></div>
      </el-aside>

      <!-- 消息主区域 -->
      <el-main v-show="(!isMobile && selectedBot && selectedChannel) || (isMobile && mobileView === 'messages')"
        :class="['flex flex-col p-0 bg-[var(--k-page-bg)] relative brightness-105 dark:brightness-100 h-full overflow-hidden']">
        <template v-if="selectedBot && selectedChannel">
          <div
            class="chat-header flex h-14 items-center px-4 font-bold border-b border-[var(--k-border-color)] bg-[var(--k-card-bg)] shadow-sm z-10 text-[var(--k-text-color)]">
            <el-button v-if="isMobile" icon="ArrowLeft" circle size="small" class="mr-3" @click="goBack" />
            <span class="chat-header-title truncate min-w-0 flex-1">{{ currentChannelName }}</span>
            <div class="flex items-center gap-2 flex-shrink-0 ml-2">
              <template v-if="currentChannelInfo?.botState">
                <span v-if="currentChannelInfo.botState.inGroup === false" class="chat-proactive-badge chat-kicked-badge" title="机器人已不在该群（可能被移出）">已退群</span>
                <template v-else>
                  <span v-if="currentChannelInfo.botState.memberRole === 'owner'" class="chat-role-badge chat-role-owner">群主</span>
                  <span v-else-if="currentChannelInfo.botState.memberRole === 'admin'" class="chat-role-badge chat-role-admin">管理员</span>
                  <span v-if="currentChannelInfo.botState.allowProactiveMsg === true" class="chat-proactive-badge chat-proactive-on"
                    title="机器人允许接收主动推送">主动推送</span>
                  <span v-if="recvMsgLabel(currentChannelInfo.botState.recvMsgSetting)" class="text-xs opacity-50 hidden lg:inline flex-shrink-0" title="接收消息设置">{{ recvMsgLabel(currentChannelInfo.botState.recvMsgSetting) }}</span>
                </template>
              </template>
              <span v-if="selectedChannel"
                class="text-xs opacity-40 font-mono hidden md:inline truncate max-w-[150px] flex-shrink-0">({{ selectedChannel }})</span>
              <el-button circle size="small" :type="memberPanelVisible ? 'primary' : 'default'" title="群成员 / 黑名单"
                @click="toggleMemberPanel">
                <el-icon><UserFilled /></el-icon>
              </el-button>
              <el-button circle size="small" title="收藏（本地）" @click="favoritesVisible = true">
                <el-icon><Star /></el-icon>
              </el-button>
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

          <!-- 沙盒窗口提示条：消息只在本机执行，点回复下的按钮才真的发到 QQ -->
          <div v-if="sandboxMode" class="chat-sandbox-banner">
            <span class="chat-sandbox-banner-tag">沙盒</span>
            <span class="chat-sandbox-banner-text">
              消息只在本机走一遍 Koishi 中间件（不会发到 QQ），机器人回复会标「沙盒」；点那条回复下的「发送到当前频道」或「编辑发送」才真的发出去（图片 / 语音 / 视频按原始元素发送）。
            </span>
            <el-button v-if="sandboxToggleable" size="small" type="primary" @click="toggleSandboxMode">退出沙盒</el-button>
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
                <div v-for="msg in systemMessages" :key="`sys-${msg.id}`" class="chat-system-msg flex flex-col items-center my-2 group gap-1">
                  <span
                    class="chat-system-pill px-3 py-1 text-xs text-[var(--k-text-color-secondary)] bg-black/5 dark:bg-white/5 rounded-full opacity-80">{{ msg.content }}</span>
                  <el-button v-if="msg.systemType === 'join-request'" size="small" type="primary" plain
                    class="!h-7 !px-3 !text-xs" @click.stop="openManageGroup(msg.selfId, msg.channelId)">去处理</el-button>
                </div>
                <template v-for="(msg, idx) in normalMessages" :key="msg.id">
                <div v-if="isNewDay(idx)" class="chat-day-divider"><span>{{ dayLabel(msg.timestamp) }}</span></div>
                <div :data-id="msg.id"
                  :class="['chat-row flex mb-6 gap-3 group', (msg.isBot || msg.userId === selectedBot) ? 'flex-row-reverse is-self' : 'flex-row is-other', isGroupStart(idx) ? 'is-group-start' : 'is-grouped', multiMode ? 'is-multi' : '', multiMode && isMultiSelected(msg.id) ? 'is-multi-on' : '', msg.atBot ? 'is-at-bot' : '']"
                  @click="multiMode ? toggleMultiSelect(msg.id) : null">
                  <span v-if="multiMode" class="chat-multi-check" @click.stop="toggleMultiSelect(msg.id)">
                    <span class="chat-checkbox" :class="{ 'is-checked': isMultiSelected(msg.id) }"></span>
                  </span>
                  <el-avatar :size="38" :src="msgAvatar(msg)" class="chat-row-avatar flex-shrink-0 shadow-sm"
                    @contextmenu.prevent.stop="onUserMenu($event, msg)" @click.stop="onUserMenu($event, msg)">
                    {{ msg.username[0] }}
                  </el-avatar>
                  <div
                    :class="['max-w-[85%] md:max-w-[75%] flex flex-col', (msg.isBot || msg.userId === selectedBot) ? 'items-end' : 'items-start']">
                    <div class="chat-msg-meta flex items-center gap-2 mb-1.5 text-xs text-[var(--k-text-color-secondary)]">
                      <span v-if="msgRole(msg) === 'owner'" class="chat-role-badge chat-role-owner">群主</span>
                      <span v-else-if="msgRole(msg) === 'admin'" class="chat-role-badge chat-role-admin">管理员</span>
                      <span class="font-bold" :class="{ 'opacity-70': msgDisplayName(msg) === '系统消息' }">{{ msgDisplayName(msg) }}</span>
                      <!-- 沙盒产生、还没真的发到 QQ 的消息，标一下来源 -->
                      <span v-if="msg.sandbox" class="chat-sandbox-msg-tag" title="沙盒拦截到的回复：还没发到 QQ">沙盒</span>
                      <el-button v-if="msg.systemType === 'join-request'" size="small" type="primary" plain
                        class="!h-6 !px-2 !text-xs" @click.stop="openManageGroup(msg.selfId, msg.channelId)">去处理</el-button>
                      <span class="opacity-60">{{ formatTime(msg.timestamp) }}</span>
                    </div>
                    <div
                      :class="['flex items-end gap-2 group/msg', (msg.isBot || msg.userId === selectedBot) ? 'flex-row' : 'flex-row-reverse']">
                      <!-- +1 按钮（沙盒模式里不显示：复读是直接发到 QQ 的，会绕过沙盒） -->
                      <div
                        v-if="!sandboxMode"
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
                        :class="['chat-bubble p-3.5 rounded-2xl shadow-sm text-[15px] leading-relaxed break-all relative cursor-context-menu', (msg.isBot || msg.userId === selectedBot) ? 'is-out bg-[#95ec69] text-black rounded-tr-none' : 'is-in bg-[var(--k-card-bg)] text-[var(--k-text-color)] rounded-tl-none border border-[var(--k-border-color)]', isMediaOnlyMsg(msg) ? 'is-plain' : '']"
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
                            <div class="chat-forward-card" @click.stop="openTextForward(msg)">
                              <div class="chat-forward-card-title">{{ forwardTitle(msg) }}</div>
                              <div class="chat-forward-card-list">
                                <div v-for="(m, i) in parseForwardText(msg).slice(0, 3)" :key="i"
                                  class="chat-forward-card-row">
                                  <span class="chat-forward-card-sender">{{ m.attrs.nickname }}:</span>
                                  <span class="chat-forward-card-text">{{ forwardPreviewText(m) }}</span>
                                </div>
                              </div>
                              <div class="chat-forward-card-footer">查看{{ parseForwardText(msg).length }}条转发消息</div>
                            </div>
                          </template>
                          <!-- 网易云音乐卡片：左文右图 + 封面播放图标（对照参考图） -->
                          <template v-else-if="isNeteaseCardMsg(msg)">
                            <div class="chat-music-card"
                              :class="{ 'is-playing': neteasePlayer.id === msg.id && audioPlaying }"
                              :title="parseCardMessage(msg).jumpUrl ? '打开网易云音乐' : '播放这首歌'"
                              @click.stop="openMusicCard(msg)">
                              <div class="chat-music-card-main">
                                <div class="chat-music-card-info">
                                  <div class="chat-music-card-title">{{ parseCardMessage(msg).title || '网易云音乐' }}</div>
                                  <div v-if="parseCardMessage(msg).desc" class="chat-music-card-artist">
                                    {{ parseCardMessage(msg).desc }}
                                  </div>
                                </div>
                                <div class="chat-music-card-cover"
                                  :title="neteasePlayer.id === msg.id && audioPlaying ? '暂停' : '播放'"
                                  @click.stop="toggleCardPlay(msg)">
                                  <img v-if="getCardPreview(msg)" :src="getCardPreview(msg)" class="chat-music-card-img"
                                    alt="" @error="(e: any) => e.target.style.display = 'none'" />
                                  <span class="chat-music-card-play" aria-hidden="true">
                                    <svg viewBox="0 0 24 24" width="14" height="14">
                                      <path v-if="neteasePlayer.id === msg.id && audioPlaying"
                                        d="M8.5 5.5h2.6v13H8.5zM12.9 5.5h2.6v13h-2.6z" fill="currentColor" />
                                      <path v-else d="M8.6 5.6v12.8L19 12z" fill="currentColor" />
                                    </svg>
                                  </span>
                                </div>
                              </div>
                              <div class="chat-music-card-source">
                                <img :src="neteaseIcon" class="chat-music-card-logo" alt="网易云音乐" />
                                <span class="chat-music-card-source-text">网易云音乐</span>
                                <span v-if="parseCardMessage(msg).jumpUrl" class="chat-music-card-open" title="打开详情"
                                  @click.stop="openCardLink(parseCardMessage(msg).jumpUrl)">↗</span>
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
                                <!-- 按标题 + UP 主搜到唯一视频时，把 UP 主 / 播放量补上 -->
                                <div v-if="biliCardBest[msg.id]" class="chat-card-msg-resolved">
                                  <span class="chat-card-msg-up">UP：{{ biliCardBest[msg.id].author }}</span>
                                  <span v-if="biliCardBest[msg.id].play">播放 {{ formatPlayCount(biliCardBest[msg.id].play) }}</span>
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
                                :channel-id="selectedChannel" :sticker="isStickerMsg(msg)" />
                            </template>
                          </template>
                          <template v-else-if="visibleElements(msg).length">
                            <render-element v-for="(el, i) in visibleElements(msg)" :key="i" :element="el" :bot-id="selectedBot"
                              :channel-id="selectedChannel" :sticker="isStickerMsg(msg)" />
                          </template>
                          <template v-else-if="msg.content">
                            <span v-html="parseMessageContent(msg)"></span>
                          </template>
                          <!-- 正文含 B 站链接的非卡片消息 -->
                          <div v-if="!isCardMessage(msg) && hasBiliLink(msg)" class="mt-1.5">
                            <span class="chat-bili-play" @click.stop="playBili(msg)">▶ 播放 B 站视频</span>
                          </div>
                          <!-- 沙盒（独立窗口 / 主界面沙盒模式）：本机拦截到的回复可以按元素发到真实频道，也可以改完再发 -->
                          <div v-if="sandboxMode && msg.isBot && msg.sandbox && visibleElements(msg).length" class="chat-sandbox-msg-actions">
                            <button type="button" class="chat-sandbox-btn" :disabled="sandboxForwarding"
                              @click.stop="forwardSandboxMessage(msg)">发送到当前频道</button>
                            <button type="button" class="chat-sandbox-btn" :disabled="sandboxForwarding"
                              @click.stop="openElementEditor(msg.elements || visibleElements(msg), `这条来自沙盒指令回复，改完再发到 QQ`)">编辑发送</button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                </template>
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
            :class="['chat-input-area p-4 border-t border-[var(--k-border-color)] bg-[var(--k-card-bg)] shadow-[0_-2px_10px_rgba(0,0,0,0.05)]', isMobile ? 'fixed left-0 right-0 z-50 transition-all duration-200' : '']"
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
            <div class="chat-input-row">
              <div class="chat-toolbar">
              <!-- QQ 表情（沙盒模式里不显示：点表情是直接发到 QQ 的，会绕过沙盒） -->
              <el-popover v-if="!sandboxMode" v-model:visible="emojiPanelVisible" placement="top-start" :width="344" trigger="click"
                :disabled="inputDisabled" popper-class="qq-emoji-popover">
                <template #reference>
                  <el-button circle class="chat-tool-btn" title="QQ 表情" :disabled="inputDisabled">
                    <ToolIcon name="emoji" />
                  </el-button>
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
              <!-- 截图（框选屏幕后作为图片发送） -->
              <el-tooltip content="截图：框选屏幕区域，作为图片发送" placement="top">
                <el-button circle class="chat-tool-btn" title="截图" :disabled="inputDisabled" @click="startScreenshot">
                  <ToolIcon name="shot" />
                </el-button>
              </el-tooltip>
              <!-- 图片上传按钮 -->
              <el-upload action="#" :auto-upload="false" :show-file-list="false" :on-change="handleFileChange" multiple :disabled="inputDisabled">
                <el-button circle class="chat-tool-btn" title="发送图片">
                  <ToolIcon name="image" />
                </el-button>
              </el-upload>
              <!-- 文件上传按钮 -->
              <el-upload action="#" :auto-upload="false" :show-file-list="false" :on-change="(f: any) => handleFileSelect(f.raw, 'file')" :disabled="inputDisabled">
                <el-button circle class="chat-tool-btn" title="发送文件">
                  <ToolIcon name="file" />
                </el-button>
              </el-upload>
              <!-- 语音上传按钮 -->
              <el-upload action="#" :auto-upload="false" :show-file-list="false" :on-change="(f: any) => handleFileSelect(f.raw, 'audio')" accept="audio/*" :disabled="inputDisabled">
                <el-button circle class="chat-tool-btn" title="发送语音">
                  <ToolIcon name="mic" />
                </el-button>
              </el-upload>
              <!-- 视频上传按钮 -->
              <el-upload action="#" :auto-upload="false" :show-file-list="false" :on-change="(f: any) => handleFileSelect(f.raw, 'video')" accept="video/*" :disabled="inputDisabled">
                <el-button circle class="chat-tool-btn" title="发送视频">
                  <ToolIcon name="video" />
                </el-button>
              </el-upload>
              <!-- 发送 Markdown 按钮（沙盒模式里不显示：Markdown 面板是直接发到 QQ 的） -->
              <el-tooltip v-if="!sandboxMode" content="发送 Markdown 消息（原生 / 按钮交互）" placement="top">
                <el-button circle class="chat-tool-btn" title="发送 Markdown" :disabled="inputDisabled" @click="openMdDialog">
                  <ToolIcon name="markdown" />
                </el-button>
              </el-tooltip>
              <!-- 执行指令：本地跑 Koishi 指令，拦截输出后发送（不改动正常发送） -->
              <el-tooltip v-if="pluginConfig?.commandBridge !== false"
                content="执行指令：在 Koishi 本地运行输入框里的指令，拦截输出后发送到 QQ" placement="top">
                <el-button circle class="chat-tool-btn" title="执行指令（本地执行并发送输出）"
                  :disabled="inputDisabled || bridgeRunning || !inputText.trim()" @click="runBridgeCommand">
                  <ToolIcon name="command" />
                </el-button>
              </el-tooltip>
              <!-- 沙盒模式：主界面原样，消息只在本机执行、回复按元素转发（再点一次退出） -->
              <el-tooltip v-if="pluginConfig?.commandBridge !== false && sandboxToggleable"
                :content="sandboxMode ? '沙盒模式已开启：消息只在本机执行，点回复下的「发送到当前频道」才真的发到 QQ。点这里退出' : '沙盒模式：界面就是主界面，消息只在本机走一遍 Koishi 中间件，不会发到 QQ'" placement="top">
                <el-button circle class="chat-tool-btn" :type="sandboxMode ? 'primary' : 'default'"
                  :title="sandboxMode ? '退出沙盒模式' : '沙盒模式（不影响真实发送）'" @click="toggleSandboxMode">
                  <ToolIcon name="sandbox" />
                </el-button>
              </el-tooltip>
              <!-- 私聊流式发送模式切换（普通 / 假流式 / 真流式） -->
              <el-tooltip v-if="isDirectChat" :content="streamModeTip" placement="top">
                <el-button
                  :type="streamMode === 'off' ? 'default' : (streamMode === 'real' ? 'warning' : 'success')"
                  class="!h-10 !px-3 !text-xs shadow-sm hover:scale-105 transition-transform flex-shrink-0"
                  :disabled="inputDisabled" @click="toggleStreamMode">{{ streamModeLabel }}</el-button>
              </el-tooltip>
              <!-- 群聊：添加 @ 成员 -->
              <el-tooltip v-if="!isDirectChat" content="添加 @ 成员" placement="top">
                <el-button circle class="chat-tool-btn" title="添加 @ 成员" :disabled="inputDisabled" @click="openMentionPanelFromButton">
                  <ToolIcon name="at" />
                </el-button>
              </el-tooltip>
              </div>
              <div class="chat-input-main">
              <!-- 富文本输入框（支持 @ 提及） -->
              <div class="chat-composer-box relative flex-1 min-w-0">
                <div ref="inputRef" class="chat-composer" :contenteditable="inputDisabled ? 'false' : 'true'" spellcheck="false" role="textbox"
                  :class="{ 'is-empty': !inputText, 'is-disabled': inputDisabled }"
                  :data-placeholder="inputPlaceholder"
                  @input="onComposerInput" @compositionend="onComposerCompositionEnd"
                  @keydown="onComposerKeydown" @keyup="onComposerKeyup"
                  @paste.prevent="onComposerPaste" @click="onComposerClick" @blur="closeMentionPanel" />
                <!-- @ 成员候选面板（对照参考图 at.png：头像 + 昵称，行高 32px，默认 8 行） -->
                <div v-if="mentionPanel.visible" class="chat-mention-panel">
                  <template v-if="mentionCandidates.length">
                    <div ref="mentionListRef" class="chat-mention-list">
                      <div v-for="(c, i) in mentionFiltered" :key="c.id"
                        class="chat-mention-item" :class="{ 'is-active': i === mentionPanel.active }"
                        @mousedown.prevent="chooseMention(c)" @mouseenter="mentionPanel.active = i">
                        <span class="chat-mention-avatar" :style="channelAvatarStyle({ id: c.id, name: c.name })">
                          <span class="chat-mention-avatar-text">{{ c.name.slice(0, 1) }}</span>
                          <img v-if="c.avatar" :src="c.avatar" alt="" class="chat-mention-avatar-img"
                            @error="hideBrokenMentionAvatar" />
                        </span>
                        <span class="chat-mention-item-name">{{ c.name }}</span>
                      </div>
                      <div v-if="!mentionFiltered.length" class="chat-mention-empty">无匹配成员</div>
                    </div>
                  </template>
                  <div v-else class="chat-mention-empty">暂无可用联系人（需该群先有聊天记录）</div>
                </div>
              </div>
              <!-- 发送按钮 -->
              <!-- 发送按钮 + 发送方式下拉（对照参考图：主按钮 / 竖分隔线 / 箭头） -->
              <div class="chat-send-group" :class="{ 'is-disabled': inputDisabled }">
                <button type="button" class="chat-send-btn" :disabled="inputDisabled || isSending" :title="sendKeyHint"
                  @click="handleSend">
                  <span v-if="isSending" class="chat-send-loading"></span>
                  <span class="chat-send-label">发送</span>
                </button>
                <span class="chat-send-divider"></span>
                <button type="button" class="chat-send-caret-btn" :disabled="inputDisabled" title="发送方式"
                  @click.stop="sendKeyMenuVisible = !sendKeyMenuVisible">
                  <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
                    <path d="M2.4 4.4L6 8l3.6-3.6" fill="none" stroke="currentColor" stroke-width="1.6"
                      stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </button>
                <div v-if="sendKeyMenuVisible" class="chat-send-menu" @click.stop>
                  <div class="chat-send-menu-item" @click="setSendKeyMode('enter')">
                    <span class="chat-send-menu-check">{{ sendKeyMode === 'enter' ? '✓' : '' }}</span>
                    <span>按 Enter 键发送消息</span>
                  </div>
                  <div class="chat-send-menu-item" @click="setSendKeyMode('ctrlEnter')">
                    <span class="chat-send-menu-check">{{ sendKeyMode === 'ctrlEnter' ? '✓' : '' }}</span>
                    <span>按 Ctrl + Enter 键发送消息</span>
                  </div>
                </div>
              </div>
              </div>
            </div>
          </div>
        </template>
        <el-empty v-else description="请选择频道开始对话" class="h-full flex items-center justify-center opacity-60" />
      </el-main>

      <!-- 群成员 / 黑名单面板（右侧） -->
      <el-aside v-if="memberPanelVisible && !isMobile" class="chat-member-panel" width="248px">
        <div class="chat-member-head">
          <div class="chat-member-tabs">
            <span class="chat-member-tab" :class="{ 'is-active': memberPanelTab === 'members' }"
              @click="switchMemberTab('members')">群成员 <b v-if="memberCount">{{ memberCount }}</b></span>
            <span class="chat-member-tab" :class="{ 'is-active': memberPanelTab === 'blacklist' }"
              @click="switchMemberTab('blacklist')">黑名单</span>
          </div>
          <el-button circle size="small" title="关闭" @click="memberPanelVisible = false">
            <el-icon><Close /></el-icon>
          </el-button>
        </div>
        <div class="chat-member-search">
          <el-input v-if="memberPanelTab === 'members'" v-model="memberKeyword" placeholder="搜索成员" clearable size="small" class="chat-search-input">
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
          <div v-else class="chat-member-tip">成员在群内时无法加入黑名单</div>
        </div>
        <el-scrollbar class="chat-member-list-wrap">
          <div v-if="memberPanelTab === 'members'">
            <div v-if="memberLoading && !memberList.length" class="chat-member-loading">加载中…</div>
            <div v-else-if="!filteredMembers.length" class="chat-member-loading">暂无成员数据</div>
            <div v-for="m in filteredMembers" :key="m.member_openid" class="chat-member-item"
              @contextmenu.prevent.stop="onMemberMenu($event, m)" :title="'右键管理 ' + memberName(m)">
              <span class="chat-member-avatar" :style="channelAvatarStyle({ id: m.member_openid, name: memberName(m) })">{{ memberName(m).slice(0, 1) }}</span>
              <span class="chat-member-info">
                <span class="chat-member-name truncate">{{ memberName(m) }}</span>
                <span class="chat-member-meta">
                  <span v-if="m.member_role === 'owner'" class="chat-role-badge chat-role-owner">群主</span>
                  <span v-else-if="m.member_role === 'admin'" class="chat-role-badge chat-role-admin">管理员</span>
                  <span v-if="m.bot" class="chat-member-bot" title="机器人">🤖</span>
                  <span v-if="isMemberMuted(m.member_openid)" class="chat-member-muted">禁言中</span>
                </span>
              </span>
            </div>
            <div v-if="memberList.length && !memberLoading" class="chat-member-more" @click="loadGroupMembers(false)">
              <span>加载更多</span>
            </div>
          </div>
          <div v-else>
            <div v-if="blacklistLoading && !blacklist.length" class="chat-member-loading">加载中…</div>
            <div v-else-if="!blacklist.length" class="chat-member-loading">黑名单为空</div>
            <div v-for="u in blacklist" :key="u.member_openid" class="chat-member-item"
              @contextmenu.prevent.stop="onMemberMenu($event, u)" :title="'右键管理 ' + memberName(u)">
              <span class="chat-member-avatar" :style="channelAvatarStyle({ id: u.member_openid, name: memberName(u) })">{{ memberName(u).slice(0, 1) }}</span>
              <span class="chat-member-info">
                <span class="chat-member-name truncate">{{ memberName(u) }}</span>
                <span class="chat-member-meta">拉黑于 {{ (u.banned_at || '').slice(0, 10) }}</span>
              </span>
            </div>
          </div>
        </el-scrollbar>
      </el-aside>

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
          <div class="flex-1 text-center pr-8">原始消息报文</div>
        </div>
        <div class="p-4 flex flex-col gap-4 h-full overflow-hidden">
          <el-input v-model="rawMessage.content" type="textarea" :rows="15" readonly class="flex-1 raw-content-area is-full" />
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
    <el-dialog v-if="!isMobile" v-model="rawMessageVisible" title="原始消息报文" width="640px" center teleported align-center>
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
    <el-dialog v-model="mdDialog.visible" :title="`发送 Markdown - ${mdDialog.name}`" width="780px"
      :close-on-click-modal="false" class="chat-md-dialog">
      <div class="chat-md-body" :class="{ 'is-drag-over': mdDragOver }"
        @paste="onMdPaste" @dragover.prevent="mdDragOver = true" @dragleave="mdDragOver = false"
        @drop.prevent="onMdDrop">
        <div class="chat-md-hint">
          支持把图片拖进来或直接粘贴，自动上传并插入 Markdown 图片语法
          <span v-if="mdImageUploading" class="chat-md-uploading">上传中…</span>
        </div>
      <el-tabs v-model="mdTab">
        <el-tab-pane label="原生 Markdown" name="native">
          <div class="chat-md-split">
            <div class="chat-md-pane">
              <div class="chat-md-label">内容</div>
              <el-input v-model="mdContent" type="textarea" :rows="14" resize="vertical" class="chat-md-textarea"
                placeholder="# 标题&#10;输入 Markdown 内容…&#10;支持 **加粗**、*斜体*、[链接](https://)、图片 ![](url)、列表、引用等" />
            </div>
            <div class="chat-md-pane">
              <div class="chat-md-label">预览</div>
              <div class="chat-md-preview-box chat-md-preview" v-html="renderMarkdown(mdContent)"></div>
            </div>
          </div>
        </el-tab-pane>
        <el-tab-pane label="扩展 Markdown" name="ext">
          <div class="chat-md-field">
            <div class="chat-md-label">Markdown 内容（可在其中插入参数指令标签，与按钮交互同时发送）</div>
            <el-input v-model="mdContent" type="textarea" :rows="8" resize="vertical" class="chat-md-textarea"
              placeholder="# 标题&#10;内容...&#10;可插入 &lt;qqbot-cmd-input /&gt; 参数指令标签，客户端显示为可点击的「/指令」" />
          </div>
          <div class="chat-md-field">
            <div class="chat-md-label">参数指令（客户端显示为可点击标签，点击后文本插入输入框）</div>
            <div class="chat-md-cmd-row">
              <el-input v-model="cmdText" maxlength="100" placeholder="text：点击后插入输入框的文本（必填，≤100）"
                class="chat-md-cmd-input" />
              <el-input v-model="cmdShow" maxlength="100" placeholder="show：展示文本（选填，默认取 text）"
                class="chat-md-cmd-input" />
              <span class="chat-md-inline">
                <span class="chat-md-label is-inline">引用</span>
                <el-switch v-model="cmdReference" size="small" />
              </span>
              <el-button type="primary" @click="addCmdToMd">添加</el-button>
            </div>
            <div class="chat-md-code-row">
              <span class="chat-md-label is-inline">生成：</span>
              <code class="chat-md-code">{{ cmdTag || '（先填写 text）' }}</code>
            </div>
          </div>
          <div class="chat-md-field">
            <div class="chat-md-label">按钮（点击后回调 data，收到 INTERACTION_CREATE 事件）</div>
            <div v-for="(b, i) in mdButtons" :key="i" class="chat-md-btn-row">
              <el-input v-model="b.label" placeholder="按钮文字" class="chat-md-btn-label" />
              <el-input v-model="b.data" placeholder="回调 data（如 /command 或 JSON）" class="chat-md-btn-data" />
              <el-button circle size="small" @click="mdButtons.splice(i, 1)"><el-icon><Close /></el-icon></el-button>
            </div>
            <div>
              <el-button size="small" @click="mdButtons.push({ label: '', data: '' })">+ 添加按钮</el-button>
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>
      </div>
      <template #footer>
        <el-button @click="mdDialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="mdSending" @click="sendMdMessage">发送</el-button>
      </template>
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

    <!-- 转发到（QQ 风格） -->
    <el-dialog v-model="forwardToVisible" title="转发到" width="680px" append-to-body class="chat-forward-dialog">
      <div class="chat-forward">
        <div class="chat-forward-left">
          <el-input v-model="forwardKeyword" placeholder="搜索" clearable size="small" class="chat-forward-search" />
          <div class="chat-forward-list">
            <div v-for="c in forwardCandidates" :key="`${c.selfId}:${c.id}`" class="chat-forward-item"
              @click="toggleForwardTarget(`${c.selfId}:${c.id}`)">
              <span class="chat-checkbox" :class="{ 'is-checked': isForwardTarget(`${c.selfId}:${c.id}`) }"></span>
              <span class="chat-forward-avatar" :style="channelAvatarStyle(c)">{{ channelInitial(c) }}</span>
              <span class="chat-forward-name truncate">{{ c.name }}</span>
            </div>
            <div v-if="!forwardCandidates.length" class="chat-forward-empty">没有匹配的会话</div>
          </div>
        </div>
        <div class="chat-forward-right">
          <div class="chat-forward-label">发送给：</div>
          <div class="chat-forward-targets">
            <span v-for="key in forwardTargets" :key="key" class="chat-forward-chip">
              {{ channelNameByKey(key) }}
              <el-icon class="chat-forward-chip-close" @click="toggleForwardTarget(key)"><Close /></el-icon>
            </span>
            <span v-if="!forwardTargets.length" class="chat-forward-empty">未选择会话</span>
          </div>
          <div class="chat-forward-preview">{{ forwardTextPreview || '（这条消息没有文本内容）' }}</div>
          <el-input v-model="forwardNote" placeholder="留言" size="small" class="chat-forward-note" />
        </div>
      </div>
      <template #footer>
        <el-button @click="forwardToVisible = false">取消</el-button>
        <el-button type="primary" :loading="forwardSending" @click="confirmForward">确定</el-button>
      </template>
    </el-dialog>

    <!-- 沙盒：Koishi 对话框，可多轮执行，关闭清空上下文 -->
    <el-dialog v-model="sandboxVisible" title="Koishi 沙盒" width="680px" append-to-body
      class="chat-sandbox-dialog" :close-on-click-modal="false" @close="closeSandbox">
      <div class="chat-sandbox">
        <div class="chat-sandbox-head">
          在这个对话框里执行 Koishi 指令（可多轮），输出会被拦截；点「编辑发送」改完再发到 QQ。关闭即清空上下文。
        </div>
        <div class="chat-sandbox-list">
          <div v-if="!sandboxMessages.length" class="chat-sandbox-empty">
            还没有执行过指令，试试 <code>/help</code>
          </div>
          <div v-for="(m, i) in sandboxMessages" :key="i" class="chat-sandbox-row" :class="'is-' + m.role">
            <div class="chat-sandbox-bubble" :class="{ 'is-error': m.ok === false }">
              <template v-if="m.role === 'bot' && m.elements && m.elements.length">
                <render-element v-for="(el, k) in m.elements" :key="k" :element="el"
                  :bot-id="selectedBot" :channel-id="selectedChannel" />
              </template>
              <pre v-else class="chat-sandbox-text">{{ m.text }}</pre>
              <div v-if="m.role === 'bot' && m.ok && m.elements && m.elements.length" class="chat-sandbox-actions">
                <span class="chat-sandbox-cmd">已拦截</span>
                <button type="button" class="chat-sandbox-btn" @click="forwardSandboxResult(m)">发送到当前频道</button>
              </div>
            </div>
          </div>
        </div>
        <div v-if="sandboxImages.length" class="chat-sandbox-thumbs">
          <div v-for="(url, i) in sandboxImages" :key="url + i" class="chat-sandbox-thumb">
            <img :src="url" alt="" />
            <span class="chat-sandbox-thumb-del" title="移除" @click="removeSandboxImage(i)">×</span>
          </div>
        </div>
        <div class="chat-sandbox-input">
          <label class="chat-sandbox-attach" :class="{ 'is-loading': sandboxUploading }" title="添加图片（会先用 assets 服务上传）">
            <input type="file" accept="image/*" multiple hidden @change="(e: any) => { addSandboxImages(Array.from(e.target.files || [])); e.target.value = '' }" />
            <ToolIcon name="image" />
          </label>
          <el-input v-model="sandboxInput" placeholder="输入消息或 Koishi 指令，例如 /help" clearable
            @keydown.enter.exact.prevent="runSandbox"
            @paste="onSandboxPaste" @dragover.prevent @drop.prevent="onSandboxDrop" />
          <el-button type="primary" :loading="sandboxRunning" @click="runSandbox">执行</el-button>
        </div>
      </div>
      <template #footer>
        <el-button @click="clearSandbox">清空上下文</el-button>
        <el-button type="primary" @click="closeSandbox">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 指令输出：拦截到的结果可以改完再发 -->
    <el-dialog v-model="commandResultVisible" title="指令输出（可编辑后发送）" width="620px" append-to-body
      class="chat-cmd-result-dialog">
      <div class="chat-cmd-result">
        <div class="chat-cmd-result-head">
          指令 <code>/{{ commandResultCommand }}</code> 的输出已被拦截，修改后点「发送」才会发到 QQ。
        </div>
        <el-input v-model="commandResultText" type="textarea" :rows="12" class="chat-cmd-result-input"
          placeholder="指令没有输出内容" />
        <div class="chat-cmd-result-meta">{{ commandResultText.length }} 字</div>
        <!-- 指令输出里的图片 / 语音 / 视频：按原始元素发送，不压成纯文本 -->
        <div v-if="commandResultElements.length" class="chat-cmd-result-elements">
          <div class="chat-cmd-result-elements-head">
            这 {{ commandResultElements.length }} 个元素会原样发送（图片 / 语音 / 视频不会被压成文本），点 × 可以去掉：
          </div>
          <div class="chat-cmd-result-elements-list">
            <div v-for="(el, i) in commandResultElements" :key="i" class="chat-cmd-result-element">
              <render-element :element="el" :bot-id="targetSelfId" :channel-id="targetChannelId" />
              <span class="chat-cmd-result-element-del" title="移除该元素" @click="removeCommandResultElement(i)">×</span>
            </div>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button :loading="bridgeRunning" @click="runBridgeCommand">重新执行</el-button>
        <el-button @click="commandResultVisible = false">取消</el-button>
        <el-button type="primary" :loading="commandResultSending" @click="sendCommandResult">发送</el-button>
      </template>
    </el-dialog>

    <!-- 沙盒回复「编辑发送」：改文字、删元素，再按原始元素发到真实频道 -->
    <el-dialog v-model="elementEditorVisible" title="编辑发送（按原始元素发送）" width="620px" append-to-body
      class="chat-elem-editor-dialog">
      <div class="chat-elem-editor">
        <div class="chat-elem-editor-head">
          {{ elementEditorHint || '改完点「发送」才会发到 QQ，图片 / 语音 / 视频按原样发出。' }}
        </div>
        <el-input v-model="elementEditorText" type="textarea" :rows="4" class="chat-elem-editor-input"
          placeholder="文字内容（可以留空，只发媒体元素）" />
        <div v-if="elementEditorElements.length" class="chat-elem-editor-list">
          <div v-for="(el, i) in elementEditorElements" :key="i" class="chat-elem-editor-item">
            <render-element :element="el" :bot-id="targetSelfId" :channel-id="targetChannelId" />
            <span class="chat-elem-editor-del" title="移除该元素" @click="removeElementEditorItem(i)">×</span>
          </div>
        </div>
        <div v-else class="chat-elem-editor-empty">没有保留的媒体元素，只发上面的文字</div>
      </div>
      <template #footer>
        <el-button @click="elementEditorVisible = false">取消</el-button>
        <el-button type="primary" :loading="elementEditorSending" @click="sendEditedElements">发送</el-button>
      </template>
    </el-dialog>

    <!-- 收藏（本地） -->
    <el-dialog v-model="favoritesVisible" title="收藏" width="580px" append-to-body class="chat-fav-dialog">
      <div v-if="!favorites.length" class="chat-fav-empty">还没有收藏任何消息</div>
      <div v-else class="chat-fav-list">
        <div v-for="f in favorites" :key="f.key" :data-key="f.key" class="chat-fav-item">
          <div class="chat-fav-head">
            <span class="chat-fav-kind" :class="`is-${f.kind || 'text'}`">{{ favKindLabel(f.kind) }}</span>
            <span class="chat-fav-name">{{ f.username }}</span>
            <span class="chat-fav-time">{{ formatTime(f.timestamp) }} · {{ f.channelName }}</span>
          </div>
          <div class="chat-fav-body">
            <template v-if="f.elements && f.elements.length">
              <render-element v-for="(el, i) in f.elements" :key="i" :element="el"
                :bot-id="f.selfId" :channel-id="f.channelId" />
            </template>
            <template v-else-if="favText(f)">{{ favText(f) }}</template>
            <span v-else class="chat-fav-none">（这条收藏没有可预览的内容）</span>
          </div>
          <div class="chat-fav-actions">
            <el-button size="small" text @click="copyFavorite(f)">复制</el-button>
            <el-button size="small" text type="danger" @click="removeFavorite(f.key)">删除</el-button>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button v-if="favorites.length" @click="clearFavorites">清空</el-button>
        <el-button type="primary" @click="favoritesVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 多选操作条 -->
    <div v-if="multiMode" class="chat-multi-bar">
      <span class="chat-multi-count">已选 {{ multiSelected.length }} 条</span>
      <div class="chat-multi-actions">
        <el-button size="small" @click="copyMulti">复制</el-button>
        <el-button size="small" @click="forwardMulti">转发</el-button>
        <el-button size="small" type="danger" plain @click="deleteMultiLocal">删除</el-button>
        <el-button size="small" @click="exitMultiMode">取消</el-button>
      </div>
    </div>

    <!-- 拖拽文件 / 图片遮罩（对照参考图：上=以文件形式发送，下=以图片形式发送） -->
    <div v-if="dragDrop.active && dragDrop.mode" class="chat-drop-mask">
      <div class="chat-drop-zone" :class="{ 'is-active': dragDrop.mode === 'file' }">
        <svg class="chat-drop-icon" viewBox="0 0 24 24" width="44" height="44" aria-hidden="true">
          <path d="M3.6 6.4A2.3 2.3 0 0 1 5.9 4.1h3.3l1.8 2.1h7.1a2.3 2.3 0 0 1 2.3 2.3v9.2a2.3 2.3 0 0 1-2.3 2.3H5.9a2.3 2.3 0 0 1-2.3-2.3z"
            fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
        </svg>
        <div class="chat-drop-title">以文件形式发送</div>
        <div class="chat-drop-sub">保留格式与文件名，便于识别和管理</div>
      </div>
      <div class="chat-drop-zone is-image" :class="{ 'is-active': dragDrop.mode === 'image', 'is-disabled': !dragDrop.hasImage }">
        <svg class="chat-drop-icon" viewBox="0 0 24 24" width="44" height="44" aria-hidden="true">
          <rect x="3.2" y="4.6" width="17.6" height="14.8" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.5" />
          <circle cx="9" cy="9.7" r="1.6" fill="none" stroke="currentColor" stroke-width="1.5" />
          <path d="M4.4 17.8l4.3-4.3a2 2 0 0 1 2.8 0l6 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
        <div class="chat-drop-title">以图片形式发送</div>
        <div class="chat-drop-sub">{{ dragDrop.hasImage ? '支持图文混排，辅助表达更清晰' : '当前拖入的不是图片' }}</div>
      </div>
      <div class="chat-drop-count">松开鼠标即可添加</div>
    </div>

    <!-- 频道拖到浏览器窗口外：提示在新窗口打开 -->
    <div v-if="channelDragging" class="chat-drag-out-hint">
      <el-icon>
        <FullScreen />
      </el-icon>
      <span>拖到浏览器窗口外松开，在新窗口打开「{{ channelDragName }}」</span>
    </div>

    <!-- 群聊天设置（对照 QQ 的群聊天设置面板） -->
    <el-dialog v-model="channelSettingsVisible" title="群聊天设置" width="400px" append-to-body class="chat-settings-dialog">
      <div class="chat-settings">
        <div class="chat-settings-field">
          <span class="chat-settings-label">群聊备注</span>
          <el-input v-model="channelSettings.remark" placeholder="填写备注" size="small" clearable maxlength="24" show-word-limit />
        </div>
        <div class="chat-settings-row">
          <span class="chat-settings-label">设为置顶</span>
          <el-switch v-model="channelSettings.pinned" />
        </div>
        <div class="chat-settings-row">
          <span class="chat-settings-label">消息免打扰</span>
          <el-switch v-model="channelSettings.muted" />
        </div>
        <div class="chat-settings-hint">开启消息免打扰后：不弹通知卡片，未读角标变灰；只有被 @ 或被引用时才会提醒。</div>
        <div class="chat-settings-danger" @click="clearChannelHistory">
          <el-icon><Delete /></el-icon>删除聊天记录
        </div>
      </div>
      <template #footer>
        <el-button @click="channelSettingsVisible = false">取消</el-button>
        <el-button type="primary" @click="saveChannelSettings">确定</el-button>
      </template>
    </el-dialog>

    <!-- 截图遮罩：拖动框选 → 确定后作为待发送图片 -->
    <div v-if="shot.visible" class="chat-shot-mask" @mousedown.prevent="onShotDown" @mousemove="onShotMove"
      @mouseup="onShotUp" @mouseleave="onShotUp">
      <img ref="shotImgRef" :src="shot.dataUrl" class="chat-shot-img" draggable="false" @load="syncShotRect" />
      <div class="chat-shot-box" :style="{
        left: (shot.rect.left + shot.box.x * shot.rect.scale) + 'px',
        top: (shot.rect.top + shot.box.y * shot.rect.scale) + 'px',
        width: (shot.box.w * shot.rect.scale) + 'px',
        height: (shot.box.h * shot.rect.scale) + 'px'
      }">
        <span class="chat-shot-size">{{ Math.round(shot.box.w) }} × {{ Math.round(shot.box.h) }}</span>
      </div>
      <div class="chat-shot-toolbar" @mousedown.stop>
        <span class="chat-shot-hint">拖动鼠标框选要发送的区域</span>
        <el-button size="small" @click="closeScreenshot">取消</el-button>
        <el-button size="small" @click="startScreenshot">重新截取</el-button>
        <el-button size="small" type="primary" :loading="shot.uploading" @click="confirmScreenshot">确定</el-button>
      </div>
    </div>

    <!-- 右键菜单（QQ 风格） -->
    <div v-if="menu.show" class="chat-menu"
      :style="{ left: menu.x + 'px', top: menu.y + 'px' }" @contextmenu.prevent>

      <!-- 机器人 / 频道菜单 -->
      <template v-if="menu.type === 'bot' || menu.type === 'channel'">
        <div class="chat-menu-item" @click="onHandleMenuAction('pin')">
          <el-icon><Star /></el-icon>{{ menu.isPinned ? '取消置顶' : '置顶' }}
        </div>
        <div v-if="menu.type === 'channel'" class="chat-menu-item" @click="onHandleMenuAction('copy-id')">
          <el-icon><DocumentCopy /></el-icon>复制群号
        </div>
        <div v-if="menu.type === 'channel' && channelHasUnread(menu.channel)"
          class="chat-menu-item" @click="onHandleMenuAction('mark-read')">
          <el-icon><CircleCheck /></el-icon>标记已读
        </div>
        <div v-else-if="menu.type === 'channel'" class="chat-menu-item" @click="onHandleMenuAction('mark-unread')">
          <el-icon><Bell /></el-icon>标记未读
        </div>
        <div v-if="menu.type === 'channel'" class="chat-menu-item" @click="openChannelSettings(menu.channel)">
          <el-icon><Setting /></el-icon>群聊天设置
        </div>
        <div v-if="menu.type === 'channel'" class="chat-menu-item" @click="onHandleMenuAction('open-standalone')">
          <el-icon><FullScreen /></el-icon>打开独立聊天窗口
        </div>
        <div v-if="menu.type === 'channel'" class="chat-menu-item" @click="onHandleMenuAction('open-sandbox')">
          <el-icon><Promotion /></el-icon>在沙盒窗口中打开（只在本机跑指令）
        </div>
        <div v-if="menu.type === 'channel'" class="chat-menu-item" @click="onHandleMenuAction('open-sandbox-console')">
          <el-icon><Monitor /></el-icon>用沙盒模式打开主界面（新窗口）
        </div>
        <div v-if="menu.type === 'channel'" class="chat-menu-item" @click="onHandleMenuAction('clear-history')">
          <el-icon><RefreshLeft /></el-icon>清空本地聊天记录
        </div>
        <div class="chat-menu-sep"></div>
        <div v-if="menu.type === 'channel'" class="chat-menu-item is-danger" @click="onHandleMenuAction('remove-channel')">
          <el-icon><Close /></el-icon>从消息列表中移除
        </div>
        <div class="chat-menu-item is-danger" @click="onHandleMenuAction('delete')">
          <el-icon><Delete /></el-icon>删除数据
        </div>
      </template>

      <!-- 消息菜单 -->
      <template v-else-if="menu.type === 'message'">
        <div class="chat-menu-item" @click="handleMessageAction('copy')">
          <el-icon><DocumentCopy /></el-icon>复制
        </div>
        <div v-if="sandboxMode && menu.data && menu.data.isBot && menu.data.sandbox && visibleElements(menu.data).length"
          class="chat-menu-item" @click="forwardSandboxMessage(menu.data); menu.show = false">
          <el-icon><Promotion /></el-icon>发送到当前频道（按元素）
        </div>
        <div v-if="sandboxMode && menu.data && menu.data.isBot && menu.data.sandbox && visibleElements(menu.data).length"
          class="chat-menu-item" @click="openElementEditor(menu.data.elements || visibleElements(menu.data), '这条来自沙盒指令回复，改完再发到 QQ'); menu.show = false">
          <el-icon><EditPen /></el-icon>编辑后发送
        </div>
        <div class="chat-menu-item" @click="handleMessageAction('copy-raw')">
          <el-icon><Collection /></el-icon>查看原始报文
        </div>
        <div v-if="!sandboxMode" class="chat-menu-item" @click="handleMessageAction('forward')">
          <el-icon><Share /></el-icon>转发
        </div>
        <div class="chat-menu-item" @click="handleMessageAction('favorite')">
          <el-icon><Star /></el-icon>收藏
        </div>
        <div v-if="!sandboxMode" class="chat-menu-item" @click="handleMessageAction('multi')">
          <el-icon><Select /></el-icon>多选
        </div>
        <div class="chat-menu-item" @click="handleMessageAction('reply')">
          <el-icon><ChatLineRound /></el-icon>引用
        </div>
        <div v-if="!sandboxMode" class="chat-menu-item" @click="handleMessageAction('plus1')">
          <el-icon><CirclePlus /></el-icon>+1 复读
        </div>
        <div v-if="canMentionMsg" class="chat-menu-item" @click="handleMessageAction('mention')">
          <ToolIcon name="at" />TA
        </div>
        <div class="chat-menu-item" @click="handleMessageAction('profile')">
          <el-icon><User /></el-icon>查看资料
        </div>
        <div v-if="menu.hasMedia" class="chat-menu-item" @click="handleMessageAction('download')">
          <el-icon><Download /></el-icon>下载媒体
        </div>
        <div v-if="canMuteMsg" class="chat-menu-item is-danger" @click="openMuteDialog">
          <el-icon><Mute /></el-icon>禁言
        </div>
        <div v-if="canRecallMsg" class="chat-menu-item is-danger" @click="handleMessageAction('recall')">
          <el-icon><RefreshLeft /></el-icon>撤回
        </div>
        <div class="chat-menu-item" @click="viewUserOpenid">
          <el-icon><Key /></el-icon>查看用户 OpenID
        </div>
        <div class="chat-menu-sep"></div>
        <div class="chat-menu-item is-danger" @click="handleMessageAction('delete-local')">
          <el-icon><Delete /></el-icon>删除
        </div>
      </template>

      <!-- 群成员菜单（对照 QQ 的成员右键菜单） -->
      <template v-else-if="menu.type === 'member'">
        <div class="chat-menu-item" @click="memberApiAction('member-private', menu.data)">
          <el-icon><ChatDotRound /></el-icon>发送消息
        </div>
        <div class="chat-menu-item" @click="memberApiAction('member-mention', menu.data)">
          <ToolIcon name="at" />TA
        </div>
        <div class="chat-menu-item" @click="memberApiAction('member-profile', menu.data)">
          <el-icon><User /></el-icon>查看资料
        </div>
        <div class="chat-menu-item" @click="memberApiAction('member-copy-id', menu.data)">
          <el-icon><DocumentCopy /></el-icon>复制 OpenID
        </div>
        <div class="chat-menu-sep"></div>
        <div class="chat-menu-item is-danger" @click="memberApiAction('member-remove', menu.data)">
          <el-icon><Delete /></el-icon>移出本群
        </div>
        <div v-if="isMemberMuted(menu.id)" class="chat-menu-item" @click="memberApiAction('member-unmute', menu.data)">
          <el-icon><CircleCheck /></el-icon>接收此人发言
        </div>
        <div v-else class="chat-menu-item" @click="memberApiAction('member-mute', menu.data)">
          <el-icon><Mute /></el-icon>屏蔽此人发言
        </div>
        <div class="chat-menu-item" @click="openMemberMuteDialog(menu.data)">
          <el-icon><Timer /></el-icon>设置群内禁言
        </div>
        <div class="chat-menu-sep"></div>
        <div v-if="memberPanelTab === 'blacklist'" class="chat-menu-item"
          @click="memberApiAction('member-blacklist-del', menu.data)">
          <el-icon><CircleCheck /></el-icon>移出黑名单
        </div>
        <div v-else class="chat-menu-item" @click="memberApiAction('member-blacklist-add', menu.data)">
          <el-icon><Mute /></el-icon>加入黑名单
        </div>
      </template>

      <!-- 用户头像菜单 -->
      <template v-else-if="menu.type === 'user'">
        <div class="chat-menu-item" @click="handleMessageAction('private')">
          <el-icon><ChatDotRound /></el-icon>发送消息
        </div>
        <div class="chat-menu-item" @click="handleMessageAction('mention')">
          <ToolIcon name="at" />TA
        </div>
        <div class="chat-menu-item" @click="handleMessageAction('profile')">
          <el-icon><User /></el-icon>查看资料
        </div>
        <div class="chat-menu-item" @click="handleMessageAction('copy-name')">
          <el-icon><DocumentCopy /></el-icon>复制昵称
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, h, defineComponent, onMounted, onBeforeUnmount, reactive, watch, computed, nextTick } from 'vue'
import { StarFilled, Star, Picture, CircleCloseFilled, ArrowLeft, Delete, Collection, Download, Loading, DocumentCopy, CirclePlus, ChatLineRound, Close, Top, VideoPlay, VideoPause, Refresh, Mute, Key, FullScreen, Promotion, Monitor, Search, Bell, CircleCheck, Share, Select, User, RefreshLeft, ChatDotRound, UserFilled, Timer, Setting, EditPen } from '@element-plus/icons-vue'
import { ElMessageBox, ElMessage } from 'element-plus'
import { send } from '@koishijs/client'
import { FILE_ICON_SVG, sanitizeMessageHtml, useChatLogic } from './chat-logic'
import { useChatTheme } from './composables/useTheme'
// 网易云 App 图标（用户提供，透明底 PNG，构建时会内联成 data URL）
import neteaseIcon from '../icons/netease.png'

// 沙盒输入框：粘贴 / 拖入图片 → 交给 assets 上传
const onSandboxPaste = (e: ClipboardEvent) => {
  const files = Array.from(e.clipboardData?.files || []).filter((f) => String(f.type || '').startsWith('image/'))
  if (!files.length) return
  e.preventDefault()
  void addSandboxImages(files)
}

const onSandboxDrop = (e: DragEvent) => {
  e.stopPropagation()
  const files = Array.from(e.dataTransfer?.files || []).filter((f) => String(f.type || '').startsWith('image/'))
  if (!files.length) return
  void addSandboxImages(files)
}

// ========== 工具栏图标（QQ 风格线性图标，内联 SVG，跟随文字颜色） ==========
const TOOL_PATHS: Record<string, string> = {
  // 表情：笑脸
  emoji: '<circle cx="12" cy="12" r="9"/><circle cx="9.1" cy="10" r="1.05" fill="currentColor" stroke="none"/><circle cx="14.9" cy="10" r="1.05" fill="currentColor" stroke="none"/><path d="M8.3 14.1a4.6 4.6 0 0 0 7.4 0"/>',
  // 截图：裁剪框
  shot: '<path d="M7 3v14h14"/><path d="M3 7h14v14"/>',
  // 图片
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="9.5" r="1.5"/><path d="M4.6 17.6l4.1-4.1a2 2 0 0 1 2.8 0l6 6"/>',
  // 文件
  file: '<path d="M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8z"/><path d="M14 3v5h5"/>',
  // 麦克风
  mic: '<rect x="9" y="2.8" width="6" height="11" rx="3"/><path d="M5.2 11.2a6.8 6.8 0 0 0 13.6 0"/><path d="M12 18v3"/>',
  // 视频
  video: '<rect x="3" y="6" width="12.6" height="12" rx="2.5"/><path d="M15.6 10.6l5.4-3v8.8l-5.4-3z"/>',
  // Markdown
  markdown: '<rect x="2.8" y="5.6" width="18.4" height="12.8" rx="2.2"/><path d="M6.6 15V9.2l3 3.6 3-3.6V15"/><path d="M16.6 9.4v4.6"/><path d="M14.6 12.2l2 2 2-2"/>',
  // @ 提及
  at: '<circle cx="12" cy="12" r="3.8"/><path d="M15.8 12v1.6a2.6 2.6 0 0 0 5.2 0V12a9 9 0 1 0-3.7 7.2"/>',
  // 执行指令：终端 >_
  command: '<rect x="2.8" y="4.2" width="18.4" height="15.6" rx="2.6"/><path d="M6.6 9.6l2.8 2.6-2.8 2.6"/><path d="M11.6 15h5.4"/>',
  // 沙盒：对话气泡 + 终端光标
  sandbox: '<path d="M4 5.2h16a1.8 1.8 0 0 1 1.8 1.8v8a1.8 1.8 0 0 1-1.8 1.8h-7.6L8 20.4v-3.6H4A1.8 1.8 0 0 1 2.2 15V7A1.8 1.8 0 0 1 4 5.2z"/><path d="M7.4 9.6l2 2-2 2"/><path d="M11.8 13.8h4.4"/>',
}

const ToolIcon = (props: { name: string }) => h('svg', {
  class: 'chat-tool-icon',
  viewBox: '0 0 24 24',
  width: 18,
  height: 18,
  'aria-hidden': 'true',
  innerHTML: TOOL_PATHS[props.name] || '',
})

// 独立窗口模式（/qq-chat/window）：只显示单个频道的聊天界面
// 沙盒窗口模式（/qq-chat/sandbox）：同一套界面，但消息只在本机执行，回复按元素转发到 QQ
const props = defineProps<{ standalone?: boolean; sandbox?: boolean }>()

// 控制台页面也能直接进沙盒模式：/qq-chat?sandbox=1&bot=<selfId>&channel=<channelId>
// （这样连控制台外壳都是主界面原样，只有聊天区变成沙盒语义）
const sandboxEnabled = ref((() => {
  try {
    const value = new URLSearchParams(location.search).get('sandbox')
    return value === '1' || value === 'true'
  } catch {
    return false
  }
})())

// ========== 从 useChatLogic 导入 ==========
const {
  bots, selectedBot, selectedChannel, currentChannels, currentMessages, currentChannelName, botName,
  inputText, uploadedImages, isSending, pinnedBots, pinnedChannels, scrollRef,
  isMobile, mobileView, goBack, forwardData, imageViewer, imageZoom, rawMessage, isLoadingHistory,
  forwardDialogVisible, imageViewerVisible, rawMessageVisible, replyingTo, userProfile, userProfileVisible,
  selectedBotPlatform, keyboardHeight,
  userNames, unreadCounts, atMeCounts, unreadTotal,
  uploadedFiles, handleFileSelect, removeUploadedFile,
  selectBot, selectChannel, handleSend, runBridgeCommand, bridgeRunning,
  commandResultVisible, commandResultText, commandResultCommand, commandResultSending, sendCommandResult,
  commandResultElements, removeCommandResultElement,
  sandboxVisible, sandboxInput, sandboxRunning, sandboxMessages, openSandbox, clearSandbox, closeSandbox, runSandbox, forwardSandboxResult,
  sandboxImages, sandboxUploading, addSandboxImages, removeSandboxImage,
  // 沙盒窗口
  sandboxMode, targetSelfId, targetChannelId, enterSandbox, sendSandboxMessage, sandboxSending,
  forwardSandboxMessage, sandboxForwarding, clearSandboxWindow, resetSandboxSession,
  elementEditorVisible, elementEditorText, elementEditorElements, elementEditorSending, elementEditorHint,
  openElementEditor, removeElementEditorItem, sendEditedElements,
  togglePinBot, togglePinChannel, deleteBotData, deleteChannelData,
  getCachedImageUrl, cacheImage, loadVideo, isVideoLoading, isVideoLoaded, showForward, openImageViewer, handleImageWheel, downloadImage, handleScroll,
  repeatMessage, handlePaste, uploadImageDataUrl, copyToClipboard, onBotMenu, onChannelMenu, onMessageMenu, onUserMenu, handleMenuAction, handleMessageAction, showUserProfile,
  menu, inputRef, focusChatInput, scrollToMessage, notifications, dismissNotification, gotoNotification, refreshBotState,
  // 收藏 / 多选 / 转发 / 隐藏频道
  favorites, favoritesVisible, removeFavorite, clearFavorites, copyFavorite, prefetchFavoriteImage,
  multiMode, multiSelected, toggleMultiMode, isMultiSelected, toggleMultiSelect, exitMultiMode, deleteMultiLocal, copyMulti,
  forwardMulti, forwardToVisible, forwardTargets, forwardNote, forwardKeyword, forwardCandidates, forwardSending,
  isForwardTarget, toggleForwardTarget, forwardTextPreview, confirmForward,
  getMessages, pluginConfig, isRawIdName,
  // 群聊备注 / 免打扰 / 群聊天设置
  channelRemarks, isChannelMuted, setChannelMuted, setChannelRemark, channelDisplayName,
  replyMeCounts, channelSettingsVisible, channelSettings, openChannelSettings, saveChannelSettings, clearChannelHistory,
  // 群成员 / 黑名单面板
  memberPanelVisible, memberPanelTab, memberList, memberLoading, memberKeyword, memberManageMode, memberSelected,
  blacklist, blacklistLoading, filteredMembers, memberCount, memberName,
  loadGroupMembers, loadBlacklist, toggleMemberPanel, switchMemberTab,
  isMemberSelected, toggleMemberSelect, exitMemberManage, batchRemoveMembers, setBlacklist, memberApiAction, onMemberMenu,
  // 注意：index.vue 里已有一组给「管理群」弹窗用的 mutedMembers/loadMutedMembers，这里只取判定函数
  isMemberMuted,
  inputDisabled, inputDisabledHint,
  // 私聊流式发送
  streamMode, isDirectChat, toggleStreamMode,
  // QQ表情相关
  parseMessageContent, getQQEmojiUrl, extractQQEmoji, nativeEmojiIds, superEmojiIds, sendNativeEmoji
} = useChatLogic({ sandbox: () => !!props.sandbox || sandboxEnabled.value })

// 沙盒模式开关（控制台页面里点工具栏「沙盒」按钮）：主界面原样，只是「发送」走本机沙盒
const sandboxToggleable = computed(() => !props.sandbox)
const toggleSandboxMode = async () => {
  sandboxEnabled.value = !sandboxEnabled.value
  try {
    const q = new URLSearchParams(location.search)
    if (sandboxEnabled.value) {
      q.set('sandbox', '1')
      if (selectedBot.value) q.set('bot', selectedBot.value)
      if (selectedChannel.value) q.set('channel', selectedChannel.value)
    } else {
      q.delete('sandbox')
    }
    const query = q.toString()
    // 保留控制台路由自己的 history state，避免打断前进/后退
    window.history.replaceState(window.history.state, '', query ? `${location.pathname}?${query}` : location.pathname)
  } catch { /* 忽略 URL 处理失败 */ }
  if (sandboxEnabled.value) {
    // 从干净的沙盒上下文开始
    await resetSandboxSession()
    ElMessage.success('已进入沙盒模式：消息只在本机执行，点回复下的「发送到当前频道」才真的发到 QQ')
  } else {
    ElMessage.info('已退出沙盒模式，发送恢复正常')
  }
}

// ========== 主题（插件设置：跟随 Koishi / 跟随系统 / 黑色 / 白色） ==========
useChatTheme(() => (pluginConfig.value as any)?.theme || 'koishi', !!props.standalone)

// 表情面板开关（点击发送后自动收起）
const emojiPanelVisible = ref(false)
// 表情面板分类：native=经典小表情，super=大表情
const emojiTab = ref<'native' | 'super'>('native')

// 点击 QQ 表情：直接当图片（apng 动图）发送
const pickNativeEmoji = (faceId: string, faceType?: string) => {
  emojiPanelVisible.value = false
  void sendNativeEmoji(faceId, faceType)
}

// ========== 语音气泡（单个胶囊，点击播放；远程语音先转码） ==========
const voiceAudioEl = ref<HTMLAudioElement | null>(null)
let voiceCurrentEl: HTMLElement | null = null

const getVoiceAudio = () => {
  if (!voiceAudioEl.value) {
    const audio = document.createElement('audio')
    audio.preload = 'metadata'
    audio.addEventListener('play', () => {
      voiceCurrentEl?.classList.add('is-playing')
      voiceCurrentEl?.classList.remove('is-busy')
    })
    audio.addEventListener('pause', () => voiceCurrentEl?.classList.remove('is-playing'))
    audio.addEventListener('ended', () => {
      voiceCurrentEl?.classList.remove('is-playing')
      voiceCurrentEl = null
    })
    voiceAudioEl.value = audio
  }
  return voiceAudioEl.value
}

const setVoiceText = (el: HTMLElement | null, text: string) => {
  const label = el?.querySelector('.qq-chat-voice-text')
  if (label) label.textContent = text
}

const playVoiceBubble = async (el: HTMLElement | null) => {
  if (!el) return
  const src = el.getAttribute('data-src') || ''
  if (!src) return
  const audio = getVoiceAudio()
  // 同一个气泡：播放 / 暂停
  if (voiceCurrentEl === el && audio.src) {
    if (audio.paused) audio.play().catch(() => {})
    else audio.pause()
    return
  }
  voiceCurrentEl = el
  el.classList.remove('is-error')
  let url = src
  if (el.getAttribute('data-remote') === '1') {
    el.classList.add('is-busy')
    setVoiceText(el, '转码中…')
    const res = await (send as any)('transcode-audio', { url: src })
    if (!res?.success || !res.url) {
      el.classList.remove('is-busy')
      el.classList.add('is-error')
      setVoiceText(el, res?.error || '转码失败')
      setTimeout(() => { if (el.isConnected) setVoiceText(el, '语音') }, 2500)
      voiceCurrentEl = null
      return
    }
    url = res.url
    setVoiceText(el, '语音')
  }
  audio.src = url
  try {
    await audio.play()
  } catch {
    el.classList.remove('is-busy')
    el.classList.add('is-error')
    setVoiceText(el, '播放失败')
    setTimeout(() => { if (el.isConnected) setVoiceText(el, '语音') }, 2500)
    voiceCurrentEl = null
  }
}

;(window as any).__qqChatVoice = playVoiceBubble

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

// 流式发送按钮文案（仅私聊显示）
const streamModeLabel = computed(() => {
  return streamMode.value === 'real' ? '真流式' : streamMode.value === 'fake' ? '假流式' : '普通'
})

const streamModeTip = computed(() => {
  if (streamMode.value === 'real') return '真流式：输入文字即按分片实时发出（删除文字不处理），回车 / 发送结束本条（需私聊 + 官方 stream_messages 能力）'
  if (streamMode.value === 'fake') return '假流式：发送前可随意修改错字，点击发送后把整段文字按随机间隔分片流式发出'
  return '普通发送（默认）：点击发送后一次性发出。私聊可再次点击切换为假流式 / 真流式'
})

// 输入框 placeholder
const inputPlaceholder = computed(() => {
  if (currentChannelInfo.value?.botState?.globalMuted) return '全体禁言中，无法发送消息'
  if (inputDisabledHint.value) return inputDisabledHint.value
  if (currentChannelInfo.value?.botState?.allowProactiveMsg === false) {
    return '该群未开启机器人主动推送权限，发送的消息可能无法送达'
  }
  if (isDirectChat.value) {
    if (streamMode.value === 'real') return '真流式：输入即分片发出，回车/发送结束本条…'
    if (streamMode.value === 'fake') return '假流式：可自由修改错字，发送后随机分片流式发出…'
  }
  return '输入消息...'
})

// ========== 富文本输入框：@ 成员提及 ==========

// @ 候选面板状态：visible=是否弹出；kw=输入 @ 后的过滤关键字；active=当前高亮项
const mentionPanel = reactive({ visible: false, kw: '', active: 0 })
let composerEditing = false // 由组件自身同步 inputText 时置位，避免 watch 重建 DOM

const escXmlAttr = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const xmlUnescape = (s: string) => String(s ?? '').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

// 输入框内 @ 成员的占位标签（发送时由服务端 / 展示时由 parseMessageContent 处理）
const mentionToken = (id: string, name: string) => `<qqbot-at-user id="${escXmlAttr(id)}"${name ? ` name="${escXmlAttr(name)}"` : ''}/>`

const splitMentionParts = (text: string) => {
  const parts: any[] = []
  let last = 0
  const re = /<qqbot-at-user\b([^>]*?)\/>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push({ type: 'text', value: text.slice(last, m.index) })
    const attrs = m[1] || ''
    const idM = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs)
    const nmM = /\bname\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs)
    parts.push({ type: 'at', id: idM ? xmlUnescape(idM[1] || idM[2] || '') : '', name: nmM ? xmlUnescape(nmM[1] || nmM[2] || '') : '' })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) })
  return parts
}

// 可 @ 的成员候选：当前群聊天记录里发过言的人 + 被别人 @ 过的人（按最近出现排序），私聊不提供
const mentionCandidates = computed(() => {
  if (isDirectChat.value) return []
  const seen = new Map<string, { id: string, name: string, ts: number, avatar?: string }>()
  const selfId = selectedBot.value
  const add = (rawId: any, rawName: any, ts: number, avatar?: string) => {
    const id = String(rawId || '').trim()
    if (!id || id === 'system' || id === selfId) return
    const name = String(rawName || '').trim()
    const label = name && name !== 'unknown' && name !== '系统消息' ? name : ''
    const prev = seen.get(id)
    if (!prev) {
      seen.set(id, { id, name: label || id, ts, avatar })
      return
    }
    if (!prev.avatar && avatar) prev.avatar = avatar
    if (label && prev.name === prev.id) prev.name = label
    if (ts > prev.ts) prev.ts = ts
  }
  // 最近的消息排在前面
  for (const msg of [...currentMessages.value].reverse()) {
    if (!msg) continue
    const ts = msg.timestamp || 0
    if (msg.type === 'user' && !msg.isBot) add(msg.userId, msg.username, ts, msg.avatar)
    // 消息体里的 @ 元素（即使本人没发言也能作为候选）
    if (Array.isArray(msg.elements)) {
      for (const el of msg.elements) {
        if (!el || el.type !== 'at') continue
        const attrs: any = el.attrs || {}
        add(attrs.id || attrs.userId || attrs.qq || attrs.openid, attrs.name || attrs.nickname || attrs.text, ts)
      }
    }
    // 原始文本里的 <at id="..." name="..." />
    const content = typeof msg.content === 'string' ? msg.content : ''
    if (/<at\b/i.test(content)) {
      const re = /<at\b([^>]*?)\/?>/gi
      let m: RegExpExecArray | null
      while ((m = re.exec(content))) {
        const attrs = m[1] || ''
        const idM = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs)
        if (!idM) continue
        const nmM = /\bname\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs)
        add(idM[1] || idM[2], nmM ? (nmM[1] || nmM[2]) : '', ts)
      }
    }
  }
  return [...seen.values()].sort((a, b) => b.ts - a.ts).slice(0, 100)
})

const mentionFiltered = computed(() => {
  const kw = mentionPanel.kw.trim().toLowerCase()
  return mentionCandidates.value.filter(c => !kw || c.name.toLowerCase().includes(kw) || c.id.toLowerCase().includes(kw)).slice(0, 100)
})

// 候选列表容器：只显示 5 行，其余靠滚动
const mentionListRef = ref<HTMLElement | null>(null)

// 键盘上下切换高亮时，把高亮项滚进可视区域
const scrollActiveMentionIntoView = () => {
  const list = mentionListRef.value
  if (!list) return
  const el = list.children[mentionPanel.active] as HTMLElement | undefined
  if (!el || !el.offsetHeight) return
  const top = el.offsetTop
  const bottom = top + el.offsetHeight
  if (top < list.scrollTop) list.scrollTop = top
  else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight
}

watch(() => mentionPanel.active, () => nextTick(scrollActiveMentionIntoView))
watch(() => mentionPanel.visible, (v) => {
  if (!v) return
  nextTick(() => { if (mentionListRef.value) mentionListRef.value.scrollTop = 0 })
})

// 候选成员头像加载失败时隐藏 img，露出底下的首字头像
const hideBrokenMentionAvatar = (e: Event) => {
  const el = e.target as HTMLImageElement | null
  if (el) el.style.display = 'none'
}

const closeMentionPanel = () => {
  mentionPanel.visible = false
  mentionPanel.kw = ''
  mentionPanel.active = 0
}

// —— 富文本输入框 DOM 工具 ——

const isMentionChip = (node: any): boolean => !!(node && node.nodeType === 1 &&
  typeof node.classList !== 'undefined' && node.classList.contains('chat-composer-at'))

const createMentionChip = (id: string, name: string) => {
  const chip = document.createElement('span')
  chip.className = 'chat-at chat-composer-at'
  chip.setAttribute('contenteditable', 'false')
  chip.setAttribute('data-at-id', id)
  chip.setAttribute('data-at-name', name)
  chip.textContent = '@' + name
  return chip
}

// 把输入框 DOM 序列化为带 <qqbot-at-user/> 占位标签的字符串（与 inputText 保持一致）
const serializeComposerNode = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE) return (node as any).data || ''
  if (isMentionChip(node)) {
    const d = (node as HTMLElement).dataset
    return mentionToken(d.atId || '', d.atName || '')
  }
  let out = ''
  for (const child of (node as any).childNodes || []) out += serializeComposerNode(child)
  return out
}

// 重建输入框内容（由 inputText 外部变化触发）
const rebuildComposer = () => {
  const root = inputRef.value as HTMLElement | undefined
  if (!root) return
  root.innerHTML = ''
  const parts = splitMentionParts(inputText.value || '')
  for (const p of parts) {
    if (p.type === 'text') root.appendChild(document.createTextNode(p.value))
    else if (p.type === 'at' && p.id) root.appendChild(createMentionChip(p.id, p.name || p.id))
  }
}

// 把输入框当前内容同步回 inputText（组件自身输入，不触发 rebuild）
const syncComposerValue = () => {
  const root = inputRef.value as HTMLElement | undefined
  if (!root) return
  const v = serializeComposerNode(root)
  if (v !== inputText.value) {
    composerEditing = true
    inputText.value = v
    composerEditing = false
  }
}

const placeCaretAfter = (node: Node) => {
  const sel = window.getSelection()
  if (!sel) return
  try {
    const r = document.createRange()
    r.setStartAfter(node)
    r.collapse(true)
    sel.removeAllRanges()
    sel.addRange(r)
  } catch { /* 忽略 */ }
}

// 光标前（不含 @ 成员胶囊文本）的纯文本，用于判断是否处于“输入 @xxx”状态
const plainTextBeforeCaret = () => {
  const root = inputRef.value as HTMLElement | undefined
  if (!root) return ''
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount || !sel.isCollapsed) return ''
  const caretNode: any = sel.anchorNode
  const caretOffset = sel.anchorOffset
  const parts: string[] = []
  let stop = false
  const walk = (el: Node) => {
    if (stop) return
    for (const child of Array.from(el.childNodes)) {
      if (stop) return
      if (child === caretNode) {
        parts.push(String((child as any).data || '').slice(0, caretOffset))
        stop = true
        return
      }
      if (child.nodeType === Node.TEXT_NODE) parts.push((child as any).data || '')
      else if (isMentionChip(child)) { /* 胶囊不计入 @ 检测文本 */ }
      else walk(child)
    }
  }
  walk(root)
  return parts.join('')
}

// 输入事件后刷新 @ 候选面板
const refreshMentionPanel = () => {
  if (isDirectChat.value || inputDisabled.value) {
    closeMentionPanel()
    return
  }
  const before = plainTextBeforeCaret()
  const m = /@([^@\s<>]*)$/.exec(before)
  if (!m) {
    closeMentionPanel()
    return
  }
  mentionPanel.kw = m[1] || ''
  mentionPanel.active = 0
  mentionPanel.visible = true
}

// 在光标处插入一个节点（文本或胶囊），并移动光标到其后
const insertNodeAtCaret = (target: Node) => {
  const root = inputRef.value as HTMLElement | undefined
  const sel = window.getSelection()
  if (!root || !sel || !sel.rangeCount) {
    root?.appendChild(target)
    if (root) placeCaretAfter(target)
    return
  }
  try {
    const range = sel.getRangeAt(0)
    range.collapse(true)
    range.insertNode(target)
    placeCaretAfter(target)
  } catch {
    root.appendChild(target)
    placeCaretAfter(target)
  }
}

// 选人（点候选 / 回车）：若当前输入的是 "@关键字"，会先删掉这段再插入蓝色 @ 胶囊
const chooseMention = (c: any) => {
  const root = inputRef.value as HTMLElement | undefined
  if (!root || !c || !c.id) return
  closeMentionPanel()
  const name = c.name || userNames.value[c.id] || c.id
  const chip = createMentionChip(c.id, name)
  const sel = window.getSelection()
  let node: any = null
  let offset = 0
  if (sel && sel.rangeCount && sel.isCollapsed) {
    node = sel.anchorNode
    offset = sel.anchorOffset
  }
  if (node && node.nodeType === Node.TEXT_NODE) {
    const data = (node as any).data || ''
    const idx = data.lastIndexOf('@', Math.max(0, offset - 1))
    if (idx >= 0) {
      const kw = data.slice(idx + 1, offset)
      if (!/[\s<>]/.test(kw)) {
        try {
          const rm = document.createRange()
          rm.setStart(node, idx)
          rm.setEnd(node, offset)
          rm.deleteContents()
          offset = idx
        } catch { /* 忽略 */ }
      }
    }
    try {
      const range = document.createRange()
      range.setStart(node, Math.max(0, Math.min(offset, (node as any).data.length)))
      range.collapse(true)
      range.insertNode(chip)
      placeCaretAfter(chip)
    } catch {
      root.appendChild(chip)
      placeCaretAfter(chip)
    }
  } else {
    insertNodeAtCaret(chip)
  }
  syncComposerValue()
}

// @ 按钮：弹出所有候选
const openMentionPanelFromButton = () => {
  if (isDirectChat.value) return
  focusChatInput()
  mentionPanel.kw = ''
  mentionPanel.active = 0
  mentionPanel.visible = true
}

// 追加 @ 胶囊到输入框（点击消息气泡里的 @ 使用）
// 说明：@ 到机器人自己（群成员里的“我”）同样允许回填，否则消息里 99% 的 @ 都点不动。
const appendMentionChip = (id: string, name?: string) => {
  const root = inputRef.value as HTMLElement | undefined
  if (!id) return
  const label = name || userNames.value[id] || id
  if (root) {
    const chip = createMentionChip(id, label)
    // 已有内容且结尾不是空白时补一个空格，避免和上文粘在一起
    if (root.textContent && !/[\s]$/.test(root.textContent)) root.appendChild(document.createTextNode(' '))
    root.appendChild(chip)
    placeCaretAfter(chip)
    root.focus()
    syncComposerValue()
  } else {
    if (inputText.value && !/[\s]$/.test(inputText.value)) inputText.value += ' '
    inputText.value += mentionToken(id, label)
  }
}

// 全局点击 @ 胶囊：@ 回填输入框
const onDocumentMentionClick = (e: MouseEvent) => {
  const t = e.target as HTMLElement
  const chip = t.closest?.('[data-at-id]') as HTMLElement | null
  if (!chip) return
  // 输入框内的胶囊不重复添加，仅移动光标
  if (chip.closest?.('.chat-composer')) return
  e.preventDefault()
  e.stopPropagation()
  appendMentionChip(chip.dataset.atId || '', chip.dataset.atName || '')
}

// ========== 富文本输入框事件 ==========

const onComposerInput = (e: Event) => {
  if ((e as any).isComposing) return
  syncComposerValue()
  refreshMentionPanel()
}

// 中文输入法提交文字后同步（compositionend 不带 isComposing）
const onComposerCompositionEnd = () => {
  syncComposerValue()
  refreshMentionPanel()
}

const onComposerKeydown = (e: KeyboardEvent) => {
  if (e.isComposing || e.keyCode === 229) return
  if (e.key === 'Enter') {
    if (mentionPanel.visible && mentionFiltered.value.length) {
      e.preventDefault()
      const active = Math.min(Math.max(0, mentionPanel.active), mentionFiltered.value.length - 1)
      chooseMention(mentionFiltered.value[active])
      return
    }
    // 按设置的发送方式决定：Enter 发送 还是 Ctrl + Enter 发送
    const withCtrl = e.ctrlKey || e.metaKey
    const shouldSend = sendKeyMode.value === 'ctrlEnter' ? withCtrl : (!e.shiftKey && !withCtrl)
    if (shouldSend) {
      e.preventDefault()
      closeMentionPanel()
      void handleSend()
      return
    }
    e.preventDefault()
    insertNodeAtCaret(document.createTextNode('\n'))
    syncComposerValue()
    return
  }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (mentionPanel.visible && mentionFiltered.value.length) {
      e.preventDefault()
      const len = mentionFiltered.value.length
      mentionPanel.active = (mentionPanel.active + (e.key === 'ArrowDown' ? 1 : -1) + len) % len
    }
    return
  }
  if (e.key === 'Backspace' || e.key === 'Delete') {
    const forward = e.key === 'Delete'
    const sel = window.getSelection()
    if (sel && sel.rangeCount && sel.isCollapsed) {
      const range = sel.getRangeAt(0)
      const node: any = range.startContainer
      const offset = range.startOffset
      let removed = false
      if (node.nodeType === Node.TEXT_NODE) {
        if (!forward && offset === 0 && isMentionChip(node.previousSibling)) {
          node.previousSibling.remove()
          removed = true
        } else if (forward && offset === (node.data || '').length && isMentionChip(node.nextSibling)) {
          node.nextSibling.remove()
          removed = true
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const children = Array.from(node.childNodes)
        if (!forward && offset > 0 && isMentionChip(children[offset - 1])) {
          (children[offset - 1] as ChildNode).remove()
          removed = true
        } else if (forward && offset < children.length && isMentionChip(children[offset])) {
          (children[offset] as ChildNode).remove()
          removed = true
        }
      }
      if (removed) {
        e.preventDefault()
        syncComposerValue()
      }
    }
  }
}

const onComposerKeyup = () => refreshMentionPanel()

const onComposerClick = () => {
  // 把光标点回某个 “@” 后面时也弹出候选
  setTimeout(refreshMentionPanel, 0)
}

const onComposerPaste = (e: ClipboardEvent) => {
  const hasImage = Array.from(e.clipboardData?.items || []).some(i =>
    i.type.indexOf('image') !== -1 || (i.kind === 'file' && isImageFile(i.getAsFile()))
  )
  if (hasImage) void handlePaste(e)
  const text = e.clipboardData?.getData('text/plain') || ''
  if (text) {
    insertNodeAtCaret(document.createTextNode(text))
    syncComposerValue()
  }
}

watch(inputText, () => {
  if (composerEditing) return
  rebuildComposer()
}, { flush: 'sync' })

watch([selectedBot, selectedChannel], () => closeMentionPanel())

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

// 是否可在右键菜单中 @ 该成员（仅群聊里别人的普通消息）
const canMentionMsg = computed(() => {
  const msg = (menu.value as any)?.data
  if (!msg || msg.isBot || msg.userId === selectedBot.value) return false
  if (!msg.userId || msg.userId === 'system') return false
  if (currentChannelInfo.value?.isDirect) return false
  return true
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
// B 站卡片（没有链接、只能按标题搜）唯一命中时的候选，用于在卡片上补 UP 主 / 播放量
const biliCardBest = reactive<Record<string, any>>({})
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
  // 沙盒 / 指令桥接的「控制台」用户（userId=qq-chat:console:xxx）只是本机派发的假用户，
  // 不显示在聊天列表里，否则界面上会凭空多出一个用户。
  // 例外：沙盒窗口 / 沙盒模式里刚发出的那条（msg.sandbox=true）必须显示，
  // 否则用户点发送后自己的消息会凭空消失（只剩机器人回复）。
  if (String(msg?.userId || '').startsWith('qq-chat:console:') && !msg?.sandbox) return false
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

// ===== 消息分组 / 日期分隔（纯展示层，不改动数据） =====
const GROUP_GAP_MS = 5 * 60 * 1000
const sameAuthor = (a: any, b: any) => !!a && !!b && a.userId === b.userId && !!a.isBot === !!b.isBot
// 同一人 5 分钟内的连续消息合并为一组：只在第一条显示头像 / 昵称 / 时间
const isGroupStart = (idx: number) => {
  const list = normalMessages.value as any[]
  const msg = list[idx]
  if (!msg) return true
  const prev = list[idx - 1]
  if (!prev) return true
  if (!sameAuthor(prev, msg)) return true
  if (msg.systemType || prev.systemType) return true
  return Math.abs((msg.timestamp || 0) - (prev.timestamp || 0)) > GROUP_GAP_MS
}
const isNewDay = (idx: number) => {
  const list = normalMessages.value as any[]
  const msg = list[idx]
  if (!msg) return false
  const prev = list[idx - 1]
  if (!prev) return true
  const a = new Date(prev.timestamp || 0)
  const b = new Date(msg.timestamp || 0)
  return a.getFullYear() !== b.getFullYear() || a.getMonth() !== b.getMonth() || a.getDate() !== b.getDate()
}
const dayLabel = (ts: number) => {
  const d = new Date(ts || Date.now())
  const now = new Date()
  const same = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const yest = new Date(now)
  yest.setDate(now.getDate() - 1)
  if (same(d, now)) return `今天 ${hm}`
  if (same(d, yest)) return `昨天 ${hm}`
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${hm}`
}

// 频道头像：名字首字 + 由 id 派生的稳定色相。头像一律没有底色，
// 这里只把色相通过 CSS 变量传给文字颜色，缺头像时也不会出现裂图
const channelInitial = (channel: any) => String(channel?.name || '?').trim().slice(0, 1) || '?'
const channelAvatarStyle = (channel: any) => {
  const key = String(channel?.id || channel?.name || '')
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 360
  const hue = channel?.isDirect ? 205 : h
  return { '--chat-avatar-hue': String(hue) }
}
// 打开收藏面板时提前把图片收藏的像素拉回来，点「复制」就能立刻写剪贴板
watch(favoritesVisible, (visible) => {
  if (!visible) return
  favorites.value.filter((f: any) => f.kind === 'image').slice(0, 8).forEach((f: any) => prefetchFavoriteImage(f))
})

// 收藏项文本（兼容旧版收藏：旧数据把纯文本存在 content 里）
const favText = (f: any) => String(f?.plain || f?.content || '').replace(/<[^>]+>/g, '').trim()

// 收藏项类型标签（图片 / 语音 / 视频 / 文件 / 卡片 / 文本）
const favKindLabel = (kind?: string) => {
  if (kind === 'image') return '图片'
  if (kind === 'audio') return '语音'
  if (kind === 'video') return '视频'
  if (kind === 'file') return '文件'
  if (kind === 'card') return '卡片'
  return '文本'
}

const botOnline = (selfId: string) => {
  const bot: any = (bots.value as any[]).find((b: any) => b.selfId === selfId)
  return bot ? bot.status !== 'offline' : true
}

// 纯媒体消息（只有图片/表情/文件/卡片，没有文字）：不显示气泡框
const MEDIA_ELEMENT_TYPES = ['img', 'image', 'mface', 'file', 'audio', 'video', 'face', 'faceType']
const isMediaOnlyMsg = (msg: any) => {
  if (!msg) return false
  // 卡片消息 / 合并转发自带卡片样式，不需要再套一层气泡（信息框）
  if (isCardMessage(msg)) return true
  if (isForwardText(msg)) return true
  const elements = (visibleElements(msg) || []) as any[]
  if (elements.length) {
    // forward / figure 元素本身就是卡片，不需要气泡
    if (elements.every(el => ['forward', 'figure'].includes(String(el?.type)))) return true
    return elements.every(el => MEDIA_ELEMENT_TYPES.includes(String(el?.type)))
  }
  const content = String(msg.content || '')
  if (!content) return false
  if (!/<img\b|<faceType|<file\b|<audio\b|<video\b|\[face:\d+\]/i.test(content)) return false
  const stripped = content
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/<faceType\s*=\s*\d+\b[^>]*>/gi, '')
    .replace(/<file\b[^>]*>/gi, '')
    .replace(/<audio\b[^>]*>/gi, '')
    .replace(/<video\b[^>]*>/gi, '')
    .replace(/\[face:\d+\]/gi, '')
    .replace(/&nbsp;/gi, ' ')
    .trim()
  return stripped === ''
}

// faceType=6：QQ 的表情包 / 大表情，消息里是一张图，尺寸要按表情而不是普通图片来限制
const isStickerMsg = (msg: any) => /faceType\s*=\s*6\b/i.test(String(msg?.content || ''))

// 消息显示名：机器人自己的历史消息里常存的是 openid，这里统一兜底成机器人昵称
const msgDisplayName = (msg: any) => {
  const raw = String(msg?.username || '').trim()
  const isOwn = !!(msg?.isBot || msg?.type === 'bot' || (msg?.userId && msg.userId === msg.selfId))
  if (raw && raw !== 'unknown' && !isRawIdName(raw)) return raw
  if (isOwn) return botName(msg?.selfId || selectedBot.value)
  const mapped = userNames.value[msg?.userId]
  if (mapped && !isRawIdName(mapped)) return mapped
  return raw || '未知用户'
}

// 消息头像：自己的消息优先用机器人资料里的头像（历史记录里常存成占位图）
const msgAvatar = (msg: any) => {
  const bot: any = (bots.value as any[]).find((b: any) => b.selfId === (msg?.selfId || selectedBot.value))
  if (msg?.isBot || msg?.type === 'bot') return bot?.avatar || msg?.avatar || ''
  return msg?.avatar || ''
}

// 会话右侧的红色数字角标（未读 / 有人@我 共用）
const channelBadge = (channel: any) => {
  const key = `${channel.selfId}:${channel.id}`
  return Number(atMeCounts[key] || replyMeCounts[key] || unreadCounts[key] || 0)
}

// 免打扰的群：角标变灰（除非有人@我 / 引用了机器人）
const channelBadgeMuted = (channel: any) => {
  const key = `${channel.selfId}:${channel.id}`
  if (!isChannelMuted(key)) return false
  return !(atMeCounts[key] || replyMeCounts[key])
}

// 频道是否有未读（决定右键菜单显示「标记已读」还是「标记未读」）
const channelHasUnread = (channel: any) => {
  if (!channel) return false
  const key = `${channel.selfId}:${channel.id}`
  return !!(unreadCounts[key] || atMeCounts[key] || replyMeCounts[key])
}

// ===== 频道列表宽度可调（拖动右侧边缘，本地记住） =====
const SIDEBAR_WIDTH_KEY = 'qq-chat:sidebar-width'
const sidebarWidth = ref(300)
try {
  const saved = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY))
  if (saved >= 200 && saved <= 560) sidebarWidth.value = saved
} catch { /* 忽略 */ }
const startSidebarResize = (e: MouseEvent) => {
  const startX = e.clientX
  const startWidth = sidebarWidth.value
  const onMove = (ev: MouseEvent) => {
    const next = Math.min(560, Math.max(200, startWidth + ev.clientX - startX))
    sidebarWidth.value = next
  }
  const onUp = () => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth.value))
    } catch { /* 忽略 */ }
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

// ===== 会话列表（QQ 风格：名称 + 时间 / 最后一条消息预览） =====
const channelKeyword = ref('')
const filteredChannels = computed(() => {
  const kw = channelKeyword.value.trim().toLowerCase()
  const list = currentChannels.value as any[]
  if (!kw) return list
  return list.filter((c: any) => String(c.name || '').toLowerCase().includes(kw) || String(c.id || '').includes(kw))
})

const lastChannelMessage = (channel: any) => {
  const msgs = getMessages(channel.selfId, channel.id) as any[]
  return msgs && msgs.length ? msgs[msgs.length - 1] : null
}

const plainMessageText = (msg: any) => String(msg?.content || '')
  .replace(/<[^>]+>/g, '')
  .replace(/&quot;/g, '"')
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ')
  .trim()

const channelPreview = (channel: any) => {
  const m = lastChannelMessage(channel)
  if (!m) return botName(channel.selfId)
  const text = plainMessageText(m)
  const who = (m.isBot || m.userId === channel.selfId) ? '' : `${m.username}: `
  return `${who}${text || '[图片/表情]'}`
}

const channelTime = (channel: any) => {
  const m = lastChannelMessage(channel)
  if (!m || !m.timestamp) return ''
  const d = new Date(m.timestamp)
  const now = new Date()
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (sameDay(d, now)) return hm
  const yest = new Date(now)
  yest.setDate(now.getDate() - 1)
  if (sameDay(d, yest)) return '昨天'
  if (now.getTime() - d.getTime() < 6 * 86400000) return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]
  return `${d.getMonth() + 1}/${d.getDate()}`
}

const channelNameByKey = (key: string) => {
  const idx = key.indexOf(':')
  const botId = key.slice(0, idx)
  const chId = key.slice(idx + 1)
  const hit = (currentChannels.value as any[]).find((c: any) => c.selfId === botId && c.id === chId)
  return hit ? hit.name : chId
}

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
    // UP 主 / 作者：不同来源字段名不一样，都试一遍
    author: get(/^(?:author|up主|up|作者|uploader|owner|nickname):\s*(.+)$/m)
      || get(/^(?:author|up主|作者|uploader):\s*(.+)$/im),
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
  if (isBiliCardMsg(msg)) return biliResolved[msg.id]?.coverUrl || biliCardBest[msg.id]?.pic || ''
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

// 「unknown」这类占位值不能当成昵称用，否则引用块会显示成 unknown
const BAD_NAMES = new Set(['unknown', 'undefined', 'null', '系统消息', '未知', '未知用户'])
const isBadName = (v: any) => !v || BAD_NAMES.has(String(v).trim().toLowerCase())

const getQuoteDisplayName = (quote: any) => {
  if (!quote) return ''
  const qUser = quote.user || {}
  // 1) 引用对象自带的昵称
  if (!isBadName(qUser.name)) return qUser.name
  if (!isBadName(qUser.username)) return qUser.username
  const qid = isBadName(qUser.userId) ? (isBadName(qUser.id) ? '' : qUser.id) : qUser.userId
  // 2) 本地缓存的昵称
  if (qid && !isBadName(userNames.value[qid])) return userNames.value[qid]
  // 3) 引用内容里的 <at id name /> 优先取 name
  const content = String(quote.content || '')
  const atRe = /<at\b([^>]*?)\/?>/i.exec(content)
  if (atRe) {
    const attrs = atRe[1] || ''
    const nm = /\bname\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs)
    const idm = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs)
    const atName = nm ? (nm[1] || nm[2] || '') : ''
    if (!isBadName(atName)) return atName
    const atId = idm ? (idm[1] || idm[2] || '') : ''
    if (atId && !isBadName(userNames.value[atId])) return userNames.value[atId]
  }
  const m2 = content.match(/<@([^>]+)>/)
  const m3 = content.match(/\[mention:user_openid:([^\]]+)\]/)
  const openid = (m2 && m2[1]) || (m3 && m3[1]) || ''
  if (openid && !isBadName(userNames.value[openid])) return userNames.value[openid]
  // 4) 用被引用消息的 id 在当前消息列表里找回发送者（服务端只给了 openid 时最靠谱）
  const quoteId = quote.messageId || quote.id || ''
  if (quoteId) {
    const hit = (currentMessages.value as any[]).find(m => m && (m.id === quoteId || m.realId === quoteId))
    if (hit && !isBadName(hit.username)) return hit.username
    if (hit && !isBadName(hit.userId) && !isBadName(userNames.value[hit.userId])) return userNames.value[hit.userId]
  }
  if (qid) return qid.length > 12 ? qid.slice(0, 12) + '…' : qid
  return '未知用户'
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
// 生成 HTML 属性值前转义，避免 ![x](url" onerror="...) 之类从属性里逃逸
const mdEscapeAttr = (s: string) => String(s)
  .replace(/&/g, '&amp;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')

// 只允许 http(s) / 站内相对路径（图片额外允许 data:image/）
const mdSafeUrl = (url: string, image = false) => {
  const value = String(url || '').trim()
  // 含引号 / 空白 / 尖括号的地址一律丢掉，避免从属性里逃逸
  if (/["'<>\s]/.test(value)) return ''
  if (/^https?:\/\//i.test(value) || value.startsWith('/')) return value
  if (image && /^data:image\//i.test(value)) return value
  return ''
}

const renderMarkdown = (src: string) => {
  if (!src) return ''
  let html = src.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m: string, alt: string, url: string) => {
    const safe = mdSafeUrl(url, true)
    return safe ? `<img src="${mdEscapeAttr(safe)}" alt="${mdEscapeAttr(alt)}" style="max-width:100%"/>` : mdEscapeAttr(alt)
  })
  html = html.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, (_m: string, text: string, url: string) => {
    const safe = mdSafeUrl(url)
    return safe ? `<a href="${mdEscapeAttr(safe)}" target="_blank" rel="noopener">${text}</a>` : text
  })
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
  // 兜底：markdown 渲染结果同样要过一遍清理（去掉任何内联事件 / 危险协议）
  return sanitizeMessageHtml(html)
}

// ===== Markdown 面板：拖入 / 粘贴图片 → assets 上传 → 插入 ![](url) =====
const mdDragOver = ref(false)
const mdImageUploading = ref(false)

const mdTextareaEl = () => document.querySelector('.chat-md-dialog textarea') as HTMLTextAreaElement | null

// 在光标处插入文本（没有焦点就追加到末尾）
const insertMdText = (text: string) => {
  const el = mdTextareaEl()
  if (!el) {
    mdContent.value += text
    return
  }
  const start = el.selectionStart ?? mdContent.value.length
  const end = el.selectionEnd ?? start
  mdContent.value = mdContent.value.slice(0, start) + text + mdContent.value.slice(end)
  nextTick(() => {
    el.focus()
    const pos = start + text.length
    try { el.setSelectionRange(pos, pos) } catch { /* 忽略 */ }
  })
}

const insertMdImageFromFile = async (file: File) => {
  if (!file || mdImageUploading.value) return
  mdImageUploading.value = true
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(new Error('读取图片失败'))
      reader.readAsDataURL(file)
    })
    let res: any = null
    try {
      res = await (send as any)('upload-md-image', { file: dataUrl, filename: file.name || ('md_' + Date.now() + '.png') })
    } catch (error: any) {
      const msg = String(error?.message || error || '')
      if (!res && /unknown message|timeout/i.test(msg)) {
        ElMessage.error('服务端还没加载该功能：请在控制台保存一次 qq-chat 插件配置（或重启 Koishi）后再试')
      } else {
        ElMessage.error(msg || '图片上传失败')
      }
      return
    }
    if (!res) {
      ElMessage.error('服务端还没加载该功能：请在控制台保存一次 qq-chat 插件配置（或重启 Koishi）后再试')
      return
    }
    if (!res.success) {
      ElMessage.error(res.error || '图片上传失败')
      return
    }
    const alt = String(file.name || 'image').replace(/\.[^.]+$/, '')
    insertMdText('![' + alt + '](' + res.url + ')\n')
    if (res.fallback) {
      ElMessage.warning('未启用 assets 服务，已使用本地地址（QQ 可能无法加载图片）')
    } else {
      ElMessage.success('已插入 Markdown 图片')
    }
  } catch (error: any) {
    ElMessage.error(error?.message || '图片上传失败')
  } finally {
    mdImageUploading.value = false
  }
}

const insertMdImageFromUrl = async (url: string) => {
  try {
    const res = await fetch(url, { credentials: 'include' })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const blob = await res.blob()
    const type = blob.type || 'image/png'
    if (!type.startsWith('image/')) throw new Error('不是图片')
    const ext = IMAGE_EXT_OF[type] || 'png'
    await insertMdImageFromFile(new File([blob], 'dragged_' + Date.now() + '.' + ext, { type }))
  } catch {
    ElMessage.error('读取拖入的图片失败')
  }
}

const onMdPaste = (e: ClipboardEvent) => {
  const items = Array.from(e.clipboardData?.items || [])
  const file = items
    .filter(item => item.kind === 'file')
    .map(item => item.getAsFile())
    .find(f => !!f && isImageFile(f))
  if (!file) return
  e.preventDefault()
  void insertMdImageFromFile(file)
}

const onMdDrop = (e: DragEvent) => {
  // 别让拖进 Markdown 面板的图片再触发窗口级拖拽（否则会同时加进输入框/文件列表）
  e.stopPropagation()
  mdDragOver.value = false
  const dt = e.dataTransfer
  if (!dt) return
  const entries = readDropEntries(dt)
  if (hasFolder(entries)) {
    ElMessage.warning(DROP_FOLDER_HINT)
    return
  }
  const files = Array.from(dt.files || []).filter(f => isImageFile(f))
  if (files.length) {
    void (async () => {
      for (const file of files) await insertMdImageFromFile(file)
    })()
    return
  }
  // 拖动页面里的图片：只有地址
  const imageUrl = readDroppedImageUrl(dt)
  if (imageUrl) void insertMdImageFromUrl(imageUrl)
}

const openMdDialog = () => {
  // Markdown 面板是直接发到 QQ 的：沙盒模式下入口已隐藏，这里再兜一层
  if (sandboxMode.value) {
    ElMessage.warning('沙盒模式下不能直接发 Markdown 到频道，请用回复下的「发送到当前频道 / 编辑后发送」')
    return
  }
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

// 成员面板右键 → 设置群内禁言
const openMemberMuteDialog = (member: any) => {
  menu.value.show = false
  const id = member?.member_openid
  if (!id) return
  muteDialog.value = {
    visible: true,
    botId: selectedBot.value,
    channelId: selectedChannel.value,
    memberOpenid: id,
    username: memberName(member)
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

const doBiliSearch = async (keyword: string, author?: string) => {
  biliSearchState.loading = true
  biliSearchState.results = []
  biliSearchState.keyword = [keyword, author].filter(Boolean).join(' ')
  biliSearchState.error = ''
  try {
    // 标题 + UP 主一起搜，服务端会按「UP 主命中 + 标题相似度」排序
    const result = await (send as any)('bili-search', { keyword, title: keyword, author: author || '', limit: 8 })
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

// 无链接的 B 站小程序卡片：交给服务端「OCR 封面 → 取 UP 主 → 按 UP 主搜视频 → 标题匹配」，
// 拿到唯一视频后才敢播放 / 补信息，避免在 8 个同名视频里猜错
const matchBiliCard = async (msg: any) => {
  const card = parseCardMessage(msg)
  const res = await (send as any)('bili-match-card', {
    title: card.title || '',
    author: card.author || '',
    imageUrl: card.preview || ''
  })
  if (!res?.success) return { video: null, results: [] as any[], upName: '', error: res?.error || '识别失败' }
  return { video: res.video || null, results: res.results || [], upName: res.upName || '', error: '' }
}

// 卡片没有链接时后台先识别一次，唯一命中时把 UP 主 / 播放量补到卡片上
const resolveBiliCard = async (msg: any) => {
  const card = parseCardMessage(msg)
  if (!card.title || biliCardBest[msg.id] || biliResolving.value === msg.id) return
  biliResolving.value = msg.id
  try {
    const found = await matchBiliCard(msg)
    if (found.video) biliCardBest[msg.id] = found.video
  } catch { /* 忽略 */ } finally {
    if (biliResolving.value === msg.id) biliResolving.value = ''
  }
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
      // 已经后台识别出唯一视频的，直接用它
      let picked = biliCardBest[msg.id]
      if (!picked?.bvid) {
        ElMessage.info('正在识别卡片信息...')
        const found = await matchBiliCard(msg)
        if (found.video) {
          picked = found.video
          biliCardBest[msg.id] = picked
        } else if (found.results.length) {
          // 该 UP 主下没有同名视频：把候选列出来让用户挑
          biliSearchOpenId.value = msg.id
          biliSearchState.results = found.results
          biliSearchState.keyword = card.title
          biliSearchState.loading = false
          biliSearchState.error = ''
          ElMessage.warning(`找到 ${found.results.length} 个候选视频，请在列表里选择`)
          return
        } else {
          ElMessage.warning(found.error || '没能识别出这条卡片对应的视频')
          return
        }
      }
      url = `https://www.bilibili.com/video/${picked.bvid}`
    } catch {
      ElMessage.warning('自动识别失败')
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
      void doBiliSearch(card.title, card.author)
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

// 点击卡片：跳转到网易云（没有链接时退化成播放）
const openMusicCard = (msg: any) => {
  const url = parseCardMessage(msg).jumpUrl
  if (url) openCardLink(url)
  else void playNetease(msg)
}

// 点击封面：控制这首歌的播放 / 暂停
const toggleCardPlay = (msg: any) => {
  const audio = audioRef.value
  if (neteasePlayer.id === msg.id && neteasePlayer.visible && audio) {
    if (audio.paused) audio.play().catch(() => {})
    else audio.pause()
    return
  }
  void playNetease(msg)
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
      // 有链接就解析视频；没链接（QQ 小程序卡片）就按标题 + UP 主搜，唯一命中时补到卡片上
      if (extractBiliUrl(msg)) void resolveBili(msg)
      else if (!biliCardBest[msg.id]) void resolveBiliCard(msg)
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
  props: ['element', 'botId', 'channelId', 'inQuote', 'sticker'],
  setup(props) {
    const imgUrl = ref('')
    const videoUrl = ref('')
    const videoLoading = ref(false)
    // 有些平台把 gif 等图片塞在 file 元素里（src 是图片地址），这种也按图片渲染
    const elementUrl = () => String(props.element.attrs?.src || props.element.attrs?.url || props.element.attrs?.file || '')
    const IMAGE_URL_RE = /\.(png|jpe?g|gif|webp|bmp|avif|apng|svg)(?:$|\?)/i
    const isFileImage = props.element.type === 'file' && IMAGE_URL_RE.test(elementUrl())
    const isMedia = ['img', 'image', 'mface', 'audio', 'video'].includes(props.element.type) || isFileImage
    const isImageType = ['img', 'image', 'mface'].includes(props.element.type) || isFileImage
    const imgLoaded = ref(false)

    // 图片懒加载：滚动到附近（提前 320px）才真正去取图，避免一次性把所有历史消息的图都拉下来
    const mediaRoot = ref<Element | null>(null)
    let mediaObserver: IntersectionObserver | null = null

    const loadMedia = async () => {
      const url = props.element.attrs.src || props.element.attrs.url || props.element.attrs.file
      if (url) {
        if (props.element.type === 'video') {
          videoUrl.value = url
          return
        }
        if (imgLoaded.value) return
        imgLoaded.value = true
        const res = await getCachedImageUrl(`${props.botId}:${props.channelId}`, url)
        if (res) imgUrl.value = res
        else {
          const r = await cacheImage(`${props.botId}:${props.channelId}`, url)
          imgUrl.value = r || url
        }
      }
    }

    onMounted(() => {
      if (!isMedia) return
      // 视频/音频只记 URL，真正的取图走下面的懒加载
      if (!isImageType || typeof IntersectionObserver === 'undefined') {
        void loadMedia()
        return
      }
      mediaObserver = new IntersectionObserver((entries) => {
        if (entries.some(entry => entry.isIntersecting)) {
          mediaObserver?.disconnect()
          mediaObserver = null
          void loadMedia()
        }
      }, { rootMargin: '320px 0px' })
      nextTick(() => {
        if (mediaRoot.value && mediaObserver) mediaObserver.observe(mediaRoot.value)
        else void loadMedia()
      })
    })
    onBeforeUnmount(() => {
      mediaObserver?.disconnect()
      mediaObserver = null
    })
    watch(() => props.element.attrs.src || props.element.attrs.url || props.element.attrs.file, () => {
      if (props.element.type === 'video') void loadMedia()
    })

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
      
      if (type === 'img' || type === 'image' || type === 'mface' || isFileImage) {
        if (props.inQuote) return h('span', { class: 'opacity-60 italic mx-1' }, '[图片]')
        const isMface = type === 'mface'
        // faceType=6 的表情包：按表情大小渲染，不要铺满整个气泡
        const isSticker = !!props.sticker && !isMface
        return h('div', { class: 'block my-1.5', ref: mediaRoot }, [
          h('img', {
            src: imgUrl.value,
            class: ['rounded-lg shadow-sm border border-black/5 block cursor-pointer hover:opacity-90 transition-opacity', isSticker ? 'chat-sticker-img' : (isMface ? 'max-w-[100px] max-h-[100px]' : 'max-w-full max-h-[400px]')],
            style: `min-width: ${isMface || isSticker ? '30px' : '50px'}; min-height: ${isMface || isSticker ? '30px' : '50px'}; object-fit: contain; background: rgba(0,0,0,0.05)`,
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
        const src = imgUrl.value || elementUrl()
        const remote = /^https?:\/\//i.test(src) && !/127\.0\.0\.1|localhost/i.test(src)
        return h('span', {
          class: ['qq-chat-voice', remote ? 'is-remote' : ''],
          'data-src': src,
          'data-remote': remote ? '1' : '0',
          title: '点击播放语音',
        }, [
          h('span', { class: 'qq-chat-voice-icon' }),
          h('span', { class: 'qq-chat-voice-wave' }, [1, 2, 3, 4, 5].map((_, i) => h('i', { key: i }))),
          h('span', { class: 'qq-chat-voice-text' }, '语音'),
        ])
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
        const atId = attrs?.id || attrs?.name || ''
        const atName = attrs?.name || userNames.value[atId] || atId
        return h('span', {
          class: 'chat-at',
          style: 'color:#409eff;font-weight:600;cursor:pointer;',
          'data-at-id': atId,
          'data-at-name': atName,
          title: `点击 @${atName}`
        }, `@${atName}`)
      }
      
      if (type === 'file') {
        const url = attrs.src || attrs.url || attrs.file
        const name = attrs.filename || attrs.name || '文件'
        const sizeText = formatFileSize(Number(attrs.size) || 0)
        // 对照参考图「文件卡片.png」：左侧文件名 + 大小（上下撑开），右侧灰底下载图标
        return h('div', {
          class: 'chat-file-card',
          title: '点击下载',
          onClick: (e: Event) => { e.stopPropagation(); if (url) downloadFile(url, name) }
        }, [
          h('span', { class: 'chat-file-card-info' }, [
            h('span', { class: 'chat-file-card-name', title: name }, name),
            h('span', { class: 'chat-file-card-meta' }, sizeText || '点击下载')
          ]),
          h('span', { class: 'chat-file-card-icon', innerHTML: FILE_ICON_SVG })
        ])
      }

      if (type === 'p') {
        return h('div', { class: 'my-1 block min-h-[1em]' }, (element.children || []).map((child: any, i: number) => h(RenderElement, { key: i, element: child, botId, channelId })))
      }
      
      if (type === 'i18n') {
        return h('span', { class: 'opacity-80 italic' }, `[${attrs.path || 'i18n'}]`)
      }

      if (type === 'figure' || type === 'forward') {
        // 对照参考图「合并转发卡片.png」：标题 + 3 行预览 + 分割线 + 底部提示，本身即卡片
        const children = (element.children || []) as any[]
        const previews = children.filter((c: any) => c.type === 'message').slice(0, 3)
        return h('div', {
          class: 'chat-forward-card',
          onClick: (e: Event) => { e.stopPropagation(); showForward(children) }
        }, [
          h('div', { class: 'chat-forward-card-title' }, element.attrs?.title || '合并转发记录'),
          h('div', { class: 'chat-forward-card-list' }, previews.map((child: any, i: number) => h('div', { class: 'chat-forward-card-row', key: i }, [
            h('span', { class: 'chat-forward-card-sender' }, `${child.attrs?.nickname || child.attrs?.name || '用户'}:`),
            h('span', { class: 'chat-forward-card-text' }, forwardPreviewText(child))
          ]))),
          h('div', { class: 'chat-forward-card-footer' }, `查看${children.length}条转发消息`)
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
  document.addEventListener('click', onDocumentMentionClick, true)
  document.addEventListener('click', closeSendKeyMenu, true)
  document.addEventListener('click', onDocumentImageClick, true)
  document.addEventListener('click', onDocumentVoiceClick, true)
  document.addEventListener('error', onDocumentMediaError, true)
  // 深链：?bot=<selfId>&channel=<channelId>（「打开独立聊天窗口」用的就是它）
  // 沙盒窗口由 chat-logic 在数据加载完成后自行进入（同样的深链参数），这里不重复处理
  try {
    const q = new URLSearchParams(location.search)
    const qBot = q.get('bot')
    const qChannel = q.get('channel')
    if (qBot && qChannel && !props.sandbox && !sandboxEnabled.value) {
      nextTick(() => { void selectChannel(qChannel, qBot) })
    }
  } catch { /* 忽略非法 URL */ }
})

// 独立窗口 / 沙盒窗口：标题跟随当前频道名
watch([() => props.standalone, () => props.sandbox, currentChannelName], () => {
  if (!props.standalone && !props.sandbox) return
  const suffix = props.sandbox ? 'QQ 沙盒窗口' : 'QQ 聊天窗口'
  document.title = currentChannelName.value ? `${currentChannelName.value} - ${suffix}` : suffix
})

// 右键菜单靠近视口边缘时自动回退到视口内（QQ 也是这个行为）
watch(() => [menu.value.show, menu.value.x, menu.value.y], () => {
  if (!menu.value.show) return
  nextTick(() => {
    const el = document.querySelector('.chat-menu') as HTMLElement | null
    if (!el) return
    const rect = el.getBoundingClientRect()
    const pad = 8
    let x = menu.value.x
    let y = menu.value.y
    if (rect.right > window.innerWidth - pad) x = Math.max(pad, window.innerWidth - rect.width - pad)
    if (rect.bottom > window.innerHeight - pad) y = Math.max(pad, window.innerHeight - rect.height - pad)
    if (x !== menu.value.x || y !== menu.value.y) {
      menu.value = { ...menu.value, x, y }
    }
  })
})

// ===== 发送方式（Enter / Ctrl+Enter）=====
const SEND_KEY_STORAGE = 'qq-chat:send-key'
const sendKeyMode = ref<'enter' | 'ctrlEnter'>('enter')
try {
  const saved = localStorage.getItem(SEND_KEY_STORAGE)
  if (saved === 'enter' || saved === 'ctrlEnter') sendKeyMode.value = saved
} catch { /* 忽略 */ }
const sendKeyMenuVisible = ref(false)
const sendKeyHint = computed(() => sendKeyMode.value === 'ctrlEnter'
  ? 'Ctrl + Enter 发送，Enter 换行'
  : 'Enter 发送，Ctrl / Shift + Enter 换行')
const setSendKeyMode = (mode: 'enter' | 'ctrlEnter') => {
  sendKeyMode.value = mode
  sendKeyMenuVisible.value = false
  try {
    localStorage.setItem(SEND_KEY_STORAGE, mode)
  } catch { /* 忽略 */ }
}
const closeSendKeyMenu = (e: MouseEvent) => {
  if (!sendKeyMenuVisible.value) return
  const el = e.target as HTMLElement
  if (el.closest?.('.chat-send-group')) return
  sendKeyMenuVisible.value = false
}

// ===== 拖拽文件 / 图片 =====  
const DROP_FOLDER_HINT = '文件夹不支持，请先压缩后再拖入'
const dragDrop = reactive({ active: false, mode: '' as '' | 'file' | 'image', hasImage: false })
const dropTargetKey = ref('')
let dragDepth = 0

// ===== 频道拖到浏览器窗口外 → 打开独立窗口 =====
const channelDragging = ref(false)
const channelDragName = ref('')
let channelDragTarget: any = null

// 独立窗口地址（与控制台右键菜单「打开独立聊天窗口」一致）
const standaloneWindowUrl = (channel: any) => {
  const bot = channel?.selfId || selectedBot.value
  const id = channel?.id || channel?.channelId
  return `${location.origin}/qq-chat/window?bot=${encodeURIComponent(bot || '')}&channel=${encodeURIComponent(String(id || ''))}`
}

const onChannelDragStart = (e: DragEvent, channel: any) => {
  // 拖文件进来时不会触发这里的 dragstart（target 不是频道项），保险起见再判一次
  if (isFileDrag(e)) return
  channelDragTarget = channel
  channelDragName.value = channelDisplayName(channel)
  channelDragging.value = true
  // 只放自定义类型 + text/plain：带上 text/uri-list 会被当成「拖图片」而弹出上传遮罩
  try {
    e.dataTransfer?.setData('application/x-qq-chat-channel', JSON.stringify({ selfId: channel.selfId, id: channel.id }))
    e.dataTransfer?.setData('text/plain', channelDisplayName(channel))
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy'
  } catch { /* 忽略 */ }
}

const onChannelDragEnd = (e: DragEvent) => {
  channelDragging.value = false
  const channel = channelDragTarget
  channelDragTarget = null
  if (!channel) return
  const x = e.clientX
  const y = e.clientY
  const outside = x <= 0 || y <= 0 || x >= window.innerWidth || y >= window.innerHeight
  // 只有松手位置在浏览器窗口之外才开新窗口（窗口内随便拖不触发）
  if (!outside) return
  const url = standaloneWindowUrl(channel)
  const name = `qq-chat-${channel.selfId || ''}-${channel.id || ''}`
  const left = Math.max(0, Math.round((window.screen.availWidth - 1040) / 2))
  const top = Math.max(0, Math.round((window.screen.availHeight - 760) / 2))
  const win = window.open(url, name, `popup=yes,width=1040,height=760,left=${left},top=${top}`)
  if (!win) ElMessage.warning('浏览器拦截了弹窗，请允许本站点弹出窗口')
}

// ===== v-html 生成元素的委托事件（这些元素不能带内联事件，否则会被消息注入利用） =====

// 图片加载失败兜底：data-fb=备用表情图，data-orig=原始远程地址
const onDocumentMediaError = (e: Event) => {
  const img = e.target as HTMLImageElement | null
  if (!img || img.tagName !== 'IMG') return
  const fb = img.dataset?.fb
  if (fb) {
    delete img.dataset.fb
    img.dataset.fbTried = '1'
    img.src = fb
    return
  }
  const orig = img.dataset?.orig
  if (orig && img.src !== orig) {
    delete img.dataset.orig
    img.src = orig
    return
  }
  if (img.dataset?.fbTried) img.style.display = 'none'
}

// 点击语音气泡播放 / 暂停
const onDocumentVoiceClick = (e: MouseEvent) => {
  const target = e.target as HTMLElement | null
  const bubble = target?.closest?.('.qq-chat-voice') as HTMLElement | null
  if (!bubble) return
  e.stopPropagation()
  void playVoiceBubble(bubble)
}

// ===== 消息里的图片点击放大（内容里的 <img> 由 v-html 渲染，没有自己的点击事件） =====
const onDocumentImageClick = (e: MouseEvent) => {
  if (multiMode.value) return
  const target = e.target as HTMLElement | null
  if (!target || target.tagName !== 'IMG') return
  const img = target as HTMLImageElement
  if (img.classList.contains('qq-emoji') || (img as any).dataset?.faceId) return
  if (img.closest('.chat-composer') || img.closest('.chat-md-preview-box') || img.closest('.chat-card-msg-open')) return
  if (!img.closest('.chat-bubble') && !img.closest('.chat-fav-body')) return
  const url = img.currentSrc || img.src
  if (!url) return
  openImageViewer(url)
}

const isFileDrag = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')

// 拖动页面里的 <img> 时浏览器给的是 text/html / text/uri-list（可能没有 Files）
const isPageImageDrag = (e: DragEvent) => {
  const types = Array.from(e.dataTransfer?.types || [])
  return types.includes('text/html') || types.includes('text/uri-list')
}

const isDragCandidate = (e: DragEvent) => isFileDrag(e) || isPageImageDrag(e)

// 页面内拖动 <img> 时，浏览器给的是 text/html / text/uri-list（可能没有 Files），这里把图片地址捞出来
const readDroppedImageUrl = (dt: DataTransfer) => {
  try {
    const html = dt.getData('text/html') || ''
    const match = /<img[^>]+src\s*=\s*["']([^"']+)["']/i.exec(html)
    if (match && match[1]) return match[1]
    const uri = String(dt.getData('text/uri-list') || '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .find(Boolean) || ''
    if (uri && /\.(png|jpe?g|gif|webp|bmp|avif|apng|svg)(\?|$)/i.test(uri)) return uri
    if (uri && /\/qq-chat\/(media|fetch-image)/i.test(uri)) return uri
  } catch { /* 忽略 */ }
  return ''
}

const IMAGE_EXT_OF: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/bmp': 'bmp', 'image/avif': 'avif', 'image/svg+xml': 'svg',
}

// 把拖进来的图片地址抓成文件再走正常上传流程
const uploadDraggedImageUrl = async (url: string, mode: 'file' | 'image') => {
  try {
    const res = await fetch(url, { credentials: 'include' })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const blob = await res.blob()
    const type = blob.type || 'image/png'
    if (!type.startsWith('image/')) throw new Error('不是图片')
    const ext = IMAGE_EXT_OF[type] || 'png'
    const file = new File([blob], `dragged_${Date.now()}.${ext}`, { type })
    if (mode === 'image') await handleFileChange({ name: file.name, raw: file })
    else await handleFileSelect(file, 'file')
  } catch (error) {
    ElMessage.error('读取拖入的图片失败')
  }
}

// 图片判断：优先 MIME，MIME 为空时按扩展名兜底（gif / webp / bmp 等经常拿不到 type）
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|avif|apng|svg)$/i
const isImageFile = (file: File | null | undefined) => {
  if (!file) return false
  const mime = String(file.type || '').toLowerCase()
  if (mime.startsWith('image/')) return true
  if (mime && !mime.startsWith('image/')) return false
  return IMAGE_EXT_RE.test(String(file.name || ''))
}

// 同步取一次条目：DataTransferItem 在事件结束后就失效了，必须先用
const readDropEntries = (dt: DataTransfer) => {
  try {
    return Array.from(dt.items || []).map(it => (it.kind === 'file' && (it as any).webkitGetAsEntry) ? (it as any).webkitGetAsEntry() : null)
  } catch {
    return []
  }
}

const hasFolder = (entries: any[]) => entries.some(entry => !!entry?.isDirectory)

const onWindowDragEnter = (e: DragEvent) => {
  if (!isDragCandidate(e)) return
  dragDepth++
  dragDrop.active = true
  const types = Array.from(e.dataTransfer?.items || [])
    .map(it => String(it.type || '').toLowerCase())
    .filter(Boolean)
  // 拿不到 type（部分系统对 gif 等不提供）时保守认为可能是图片，避免被强制当成文件
  dragDrop.hasImage = types.length ? types.some(t => t.startsWith('image/')) : true
}

// 上 62% = 以文件形式发送，下 38% = 以图片形式发送（对照参考图）
// 弹窗（发送 MD / 沙盒）内部的拖放由它们自己处理，窗口级拖拽不参与
const isInsideOwnDialog = (e: DragEvent) => {
  const target = e.target as HTMLElement | null
  return !!target?.closest?.('.chat-md-dialog, .chat-sandbox-dialog, .chat-cmd-result-dialog, .chat-elem-editor-dialog')
}

const onWindowDragOver = (e: DragEvent) => {
  if (isInsideOwnDialog(e)) return
  if (!isDragCandidate(e)) return
  // 页面内拖图时可能没触发 dragenter，这里兜底打开遮罩
  dragDrop.active = true
  if (!dragDrop.hasImage) {
    const types = Array.from(e.dataTransfer?.items || []).map(it => String(it.type || '').toLowerCase()).filter(Boolean)
    if (!types.length || types.some(t => t.startsWith('image/')) || isPageImageDrag(e)) dragDrop.hasImage = true
  }
  const main = document.querySelector('.el-main') as HTMLElement | null
  const rect = main?.getBoundingClientRect()
  if (!rect || e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
    dragDrop.mode = ''
    return
  }
  dragDrop.mode = (e.clientY - rect.top) / rect.height > 0.62 ? 'image' : 'file'
}

const onWindowDragLeave = (e: DragEvent) => {
  if (!isDragCandidate(e)) return
  dragDepth = Math.max(0, dragDepth - 1)
  if (!dragDepth) {
    dragDrop.active = false
    dragDrop.mode = ''
  }
}

// 图片按图片流程上传，其它按文件/音频/视频上传
const uploadDroppedFiles = async (files: File[], mode: 'file' | 'image') => {
  for (const file of files) {
    const mime = String(file.type || '')
    if (mode === 'image' && isImageFile(file)) {
      await handleFileChange({ name: file.name, raw: file })
      continue
    }
    const type = mime.startsWith('audio/') ? 'audio' : mime.startsWith('video/') ? 'video' : 'file'
    await handleFileSelect(file, type)
  }
}

const onWindowDrop = async (e: DragEvent) => {
  if (isInsideOwnDialog(e)) return
  // 拖动页面里的图片时可能只有 text/html，没有 Files
  if (!isDragCandidate(e) && !readDroppedImageUrl(e.dataTransfer as DataTransfer)) return
  dragDepth = 0
  dragDrop.active = false
  const dt = e.dataTransfer
  if (!dt) return
  const entries = readDropEntries(dt)
  const files = Array.from(dt.files || [])
  const imageUrl = readDroppedImageUrl(dt)
  // 拖动消息里的图片时可能没有分区信息：默认按图片处理（这才是拖图的意图）
  const mode = (dragDrop.mode || (imageUrl && !files.some(f => isImageFile(f)) ? 'image' : 'file')) as 'file' | 'image'
  dragDrop.mode = ''
  if (hasFolder(entries)) {
    ElMessage.warning(DROP_FOLDER_HINT)
    return
  }
  if (!files.length && !imageUrl) return
  if (inputDisabled.value) {
    ElMessage.warning(inputDisabledHint.value || '当前频道无法发送消息')
    return
  }
  // 拖的是消息里的图片：文件本身认不出图片时，直接按图片地址抓取
  if (imageUrl && (!files.length || !files.some(f => isImageFile(f)))) {
    await uploadDraggedImageUrl(imageUrl, mode)
    return
  }
  await uploadDroppedFiles(files, mode)
}

// 拖到会话列表的某个频道：切到该频道并把文件加进待发送列表
const onChannelDragOver = (e: DragEvent, channel: any) => {
  if (!isDragCandidate(e)) return
  e.preventDefault()
  dropTargetKey.value = `${channel.selfId}:${channel.id}`
  dragDrop.mode = ''
}

const onChannelDragLeave = () => {
  dropTargetKey.value = ''
}

const onChannelDrop = async (e: DragEvent, channel: any) => {
  dropTargetKey.value = ''
  dragDepth = 0
  dragDrop.active = false
  dragDrop.mode = ''
  const dt = e.dataTransfer
  if (!dt) return
  const entries = readDropEntries(dt)
  const files = Array.from(dt.files || [])
  if (hasFolder(entries)) {
    ElMessage.warning(DROP_FOLDER_HINT)
    return
  }
  const imageUrl = readDroppedImageUrl(dt)
  if (!files.length && !imageUrl) return
  if (selectedBot.value !== channel.selfId || selectedChannel.value !== channel.id) {
    await selectChannel(channel.id, channel.selfId)
  }
  if (inputDisabled.value) {
    ElMessage.warning(inputDisabledHint.value || '该频道无法发送消息')
    return
  }
  if (imageUrl && (!files.length || !files.some(f => isImageFile(f)))) {
    await uploadDraggedImageUrl(imageUrl, 'image')
  } else {
    await uploadDroppedFiles(files, files.some(f => isImageFile(f)) ? 'image' : 'file')
  }
  ElMessage.success(`已添加到「${channelDisplayName(channel)}」的待发送列表`)
}

// ===== 截图：getDisplayMedia 抓屏 → 框选 → 作为待发送图片 =====
const shot = reactive({
  visible: false,
  dataUrl: '',
  imgW: 0,
  imgH: 0,
  box: { x: 0, y: 0, w: 0, h: 0 },
  dragging: false,
  sx: 0,
  sy: 0,
  rect: { left: 0, top: 0, scale: 1 },
  uploading: false,
})
const shotImgRef = ref<HTMLImageElement | null>(null)

// 图片是等比缩放的，把指针坐标换算回图片像素坐标
const syncShotRect = () => {
  const img = shotImgRef.value
  if (!img) return
  const r = img.getBoundingClientRect()
  shot.rect = { left: r.left, top: r.top, scale: shot.imgW ? r.width / shot.imgW : 1 }
}

const startScreenshot = async () => {
  const md: any = navigator.mediaDevices
  if (!md?.getDisplayMedia) {
    ElMessage.error('当前环境不支持截图：请用 https 或 localhost 打开控制台')
    return
  }
  let stream: MediaStream | null = null
  try {
    stream = await md.getDisplayMedia({ video: true, audio: false })
    const video = document.createElement('video')
    video.srcObject = stream
    video.muted = true
    await video.play().catch(() => { /* 忽略自动播放限制 */ })
    // 等一帧再取画面，避免抓到黑屏
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 120)))
    const w = video.videoWidth || 1280
    const h = video.videoHeight || 720
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d')?.drawImage(video, 0, 0, w, h)
    shot.dataUrl = canvas.toDataURL('image/png')
    shot.imgW = w
    shot.imgH = h
    shot.box = { x: Math.round(w * 0.15), y: Math.round(h * 0.15), w: Math.round(w * 0.7), h: Math.round(h * 0.7) }
    shot.visible = true
    await nextTick()
    syncShotRect()
  } catch (error: any) {
    if (error?.name !== 'NotAllowedError') ElMessage.error('截图失败：' + (error?.message || error))
  } finally {
    stream?.getTracks().forEach(t => t.stop())
  }
}

const onShotDown = (e: MouseEvent) => {
  syncShotRect()
  const { left, top, scale } = shot.rect
  shot.dragging = true
  shot.sx = Math.max(0, Math.min(shot.imgW, (e.clientX - left) / scale))
  shot.sy = Math.max(0, Math.min(shot.imgH, (e.clientY - top) / scale))
  shot.box = { x: shot.sx, y: shot.sy, w: 0, h: 0 }
}

const onShotMove = (e: MouseEvent) => {
  if (!shot.dragging) return
  const { left, top, scale } = shot.rect
  const cx = Math.max(0, Math.min(shot.imgW, (e.clientX - left) / scale))
  const cy = Math.max(0, Math.min(shot.imgH, (e.clientY - top) / scale))
  shot.box = {
    x: Math.min(shot.sx, cx),
    y: Math.min(shot.sy, cy),
    w: Math.abs(cx - shot.sx),
    h: Math.abs(cy - shot.sy),
  }
}

const onShotUp = () => { shot.dragging = false }

const closeScreenshot = () => {
  shot.visible = false
  shot.dragging = false
}

const confirmScreenshot = async () => {
  const { x, y, w, h } = shot.box
  if (w < 4 || h < 4) {
    ElMessage.warning('请先在画面上拖动框选要发送的区域')
    return
  }
  const img = shotImgRef.value
  if (!img) return
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w)
  canvas.height = Math.round(h)
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.drawImage(img, Math.round(x), Math.round(y), Math.round(w), Math.round(h), 0, 0, Math.round(w), Math.round(h))
  const dataUrl = canvas.toDataURL('image/png')
  closeScreenshot()
  shot.uploading = true
  const ok = await uploadImageDataUrl(dataUrl, `screenshot_${Date.now()}.png`)
  shot.uploading = false
  if (ok) ElMessage.success('截图已加入待发送图片')
}

// ===== 聊天背景图（插件配置里的本地图片 / 远程链接） =====
const wallpaperStyle = computed(() => {
  const cfg: any = pluginConfig.value || {}
  const url = cfg.chatBackgroundUrl
  if (!url) return {}
  const blur = Math.max(0, Number(cfg.chatBackgroundBlur || 0))
  const dim = Math.min(90, Math.max(0, Number(cfg.chatBackgroundDim ?? 12)))
  return {
    '--chat-wallpaper-image': `url("${String(url).replace(/"/g, '')}")`,
    '--chat-wallpaper-blur': `${blur}px`,
    '--chat-wallpaper-dim': `${(dim / 100).toFixed(2)}`
  }
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
  document.removeEventListener('click', onDocumentMentionClick, true)
  document.removeEventListener('click', closeSendKeyMenu, true)
  document.removeEventListener('click', onDocumentImageClick, true)
  document.removeEventListener('click', onDocumentVoiceClick, true)
  document.removeEventListener('error', onDocumentMediaError, true)
})

// 导出组件（script setup 下通过 defineOptions 声明组件名；
// RenderElement 已在 setup 作用域内定义，模板中可直接使用）
defineOptions({
  name: 'QQChat',
})
</script>
