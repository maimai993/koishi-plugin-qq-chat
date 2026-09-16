package com.maimai.qqchat;

/**
 * 通知规则（纯逻辑，不依赖 Android，方便直接跑单测）。
 *
 * 规则：
 *  - 普通频道：所有新消息都通知
 *  - 免打扰频道：只有「有人 @ 机器人」或「引用了机器人的消息」才通知
 */
public class NotifyLogic {

    /** 这条消息要不要弹通知 */
    public static boolean shouldNotify(boolean muted, boolean atBot, boolean replyToBot) {
        if (!muted) return true;
        return atBot || replyToBot;
    }

    /** 引用的消息是不是机器人自己发的 */
    public static boolean isReplyToBot(String quoteUserId, String selfId) {
        if (quoteUserId == null || quoteUserId.isEmpty()) return false;
        if (selfId == null || selfId.isEmpty()) return false;
        return quoteUserId.equals(selfId);
    }

    /** 通知标题：频道名（+ @/引用 标记 + 发送者） */
    public static String notificationTitle(String channelName, String sender, boolean atBot, boolean replyToBot) {
        String title = channelName == null || channelName.isEmpty() ? "新消息" : channelName;
        if (atBot) title = "[有人@我] " + title;
        else if (replyToBot) title = "[被引用] " + title;
        if (sender != null && !sender.isEmpty() && !sender.equals(channelName)) title = title + " · " + sender;
        return title;
    }

    /** 把消息内容转成通知里能看的纯文本 */
    public static String stripHtml(String text) {
        String value = text == null ? "" : text;
        value = value.replaceAll("<img[^>]*>", "[图片]");
        value = value.replaceAll("<face[^>]*>", "[表情]");
        value = value.replaceAll("<[^>]+>", "");
        value = value.replace("&quot;", "\"").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">");
        value = value.replaceAll("\\s+", " ").trim();
        if (value.length() > 160) value = value.substring(0, 160) + "…";
        return value.isEmpty() ? "[非文本消息]" : value;
    }
}
