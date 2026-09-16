package com.maimai.qqchat;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/**
 * 消息通知服务：前台服务 + SSE 长连接。
 *
 * 连接 <服务器>/qq-chat/api/events，收到新消息就弹系统通知。
 * 通知规则：**免打扰的频道不通知，除非有人 @ 机器人或被引用了机器人的消息**
 *（免打扰列表由控制台的「消息免打扰」同步到服务端，手机端也能自己改）。
 */
public class NotifyService extends Service {
    public static final String CHANNEL_MESSAGES = "qq-chat-messages";
    public static final String CHANNEL_SERVICE = "qq-chat-service";
    private static final int SERVICE_NOTIFICATION_ID = 1;
    private static final int MESSAGE_NOTIFICATION_BASE = 1000;

    private volatile boolean running = false;
    private Thread worker;
    private final Map<String, String> channelNames = new HashMap<String, String>();
    private final Set<String> muted = new HashSet<String>();
    private long lastRulesFetch = 0L;
    private int notifiedCount = 0;

    public static void start(Context ctx) {
        Intent intent = new Intent(ctx, NotifyService.class);
        if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(intent);
        else ctx.startService(intent);
    }

    public static void stop(Context ctx) {
        ctx.stopService(new Intent(ctx, NotifyService.class));
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createChannels();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startForeground(SERVICE_NOTIFICATION_ID, buildServiceNotification());
        if (!running) {
            running = true;
            worker = new Thread(new Runnable() {
                @Override
                public void run() { loop(); }
            }, "qq-chat-sse");
            worker.setDaemon(true);
            worker.start();
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        if (worker != null) worker.interrupt();
        super.onDestroy();
    }

    private void createChannels() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        NotificationChannel messages = new NotificationChannel(CHANNEL_MESSAGES, "新消息", NotificationManager.IMPORTANCE_HIGH);
        messages.setDescription("QQ 机器人的新消息提醒");
        messages.enableVibration(true);
        manager.createNotificationChannel(messages);
        NotificationChannel service = new NotificationChannel(CHANNEL_SERVICE, "后台同步", NotificationManager.IMPORTANCE_MIN);
        service.setDescription("保持与服务器的长连接以接收新消息");
        service.setShowBadge(false);
        manager.createNotificationChannel(service);
    }

    private Notification buildServiceNotification() {
        Intent intent = new Intent(this, MainActivity.class);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pending = PendingIntent.getActivity(this, 0, intent, flags);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CHANNEL_SERVICE)
                : new Notification.Builder(this);
        return builder
                .setContentTitle("QQ 机器人")
                .setContentText("正在同步消息，有新消息会通知你")
                .setSmallIcon(R.drawable.ic_notify)
                .setContentIntent(pending)
                .setOngoing(true)
                .build();
    }

    private void loop() {
        while (running) {
            String baseUrl = Prefs.baseUrl(this);
            String token = Prefs.token(this);
            boolean enabled = Prefs.notifyEnabled(this);
            if (baseUrl.isEmpty() || token.isEmpty() || !enabled) {
                sleep(5000);
                continue;
            }
            try {
                refreshMeta(baseUrl, token);
                stream(baseUrl, token);
            } catch (Throwable error) {
                sleep(4000);
            }
        }
    }

    private void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException ignored) { }
    }

    /** 拉频道名 + 免打扰列表（5 分钟一次） */
    private void refreshMeta(String baseUrl, String token) {
        if (System.currentTimeMillis() - lastRulesFetch < 5 * 60 * 1000L && !channelNames.isEmpty()) return;
        try {
            JSONObject me = Api.request(baseUrl, Api.ME, "GET", token, null);
            if (me.optInt("_status", 200) != 200) return;
            JSONArray channels = me.optJSONArray("channels");
            if (channels != null) {
                synchronized (channelNames) {
                    channelNames.clear();
                    for (int i = 0; i < channels.length(); i++) {
                        JSONObject ch = channels.optJSONObject(i);
                        if (ch == null) continue;
                        String selfId = ch.optString("selfId", "");
                        String channelId = ch.optString("channelId", ch.optString("id", ""));
                        if (selfId.isEmpty() || channelId.isEmpty()) continue;
                        channelNames.put(selfId + ":" + channelId, ch.optString("name", channelId));
                    }
                }
            }
            JSONArray mutedList = me.optJSONArray("muted");
            synchronized (muted) {
                muted.clear();
                if (mutedList != null) {
                    for (int i = 0; i < mutedList.length(); i++) muted.add(mutedList.optString(i, ""));
                }
            }
            lastRulesFetch = System.currentTimeMillis();
        } catch (Throwable ignored) { }
    }

    /** SSE 长连接：解析 event/data，遇到 chat-message-event 就判断要不要通知 */
    private void stream(String baseUrl, String token) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(baseUrl + Api.EVENTS + "?token=" + android.net.Uri.encode(token)).openConnection();
        conn.setRequestMethod("GET");
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(0);
        conn.setRequestProperty("Accept", "text/event-stream");
        conn.setRequestProperty("User-Agent", "qq-chat-android/1.0");
        int code = conn.getResponseCode();
        if (code != 200) {
            conn.disconnect();
            sleep(5000);
            return;
        }
        BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8));
        String eventName = "";
        StringBuilder data = new StringBuilder();
        String line;
        while (running && (line = reader.readLine()) != null) {
            if (line.isEmpty()) {
                if (data.length() > 0) {
                    handleEvent(eventName, data.toString());
                }
                eventName = "";
                data.setLength(0);
                continue;
            }
            if (line.startsWith("event:")) eventName = line.substring(6).trim();
            else if (line.startsWith("data:")) data.append(line.substring(5).trim());
        }
        try { reader.close(); } catch (Exception ignored) { }
        try { conn.disconnect(); } catch (Exception ignored) { }
    }

    private void handleEvent(String eventName, String payload) {
        if (!"message".equals(eventName)) return;
        try {
            JSONObject wrapper = new JSONObject(payload);
            String type = wrapper.optString("type", "");
            if (!"chat-message-event".equals(type)) return;
            JSONObject ev = wrapper.optJSONObject("body");
            if (ev == null) return;
            String kind = ev.optString("type", "");
            // 只要真人消息（系统提示、机器人自己的消息不弹）
            if (!kind.isEmpty() && !"message".equals(kind)) return;
            String selfId = ev.optString("selfId", "");
            String channelId = ev.optString("channelId", "");
            if (selfId.isEmpty() || channelId.isEmpty()) return;
            boolean atBot = ev.optBoolean("atBot", false);
            boolean replyToBot = isReplyToBot(ev, selfId);
            String key = selfId + ":" + channelId;
            boolean isMuted;
            synchronized (muted) {
                isMuted = muted.contains(key);
            }
            // 免打扰频道：只有 @机器人 或 引用机器人 才提醒（规则见 NotifyLogic）
            if (!NotifyLogic.shouldNotify(isMuted, atBot, replyToBot)) return;
            String channelName;
            synchronized (channelNames) {
                channelName = channelNames.containsKey(key) ? channelNames.get(key) : channelId;
            }
            String sender = ev.optString("username", "");
            String content = NotifyLogic.stripHtml(ev.optString("content", ""));
            String title = NotifyLogic.notificationTitle(channelName, sender, atBot, replyToBot);
            notifyMessage(key, title, content, selfId, channelId);
        } catch (Throwable ignored) { }
    }

    private boolean isReplyToBot(JSONObject ev, String selfId) {
        JSONObject quote = ev.optJSONObject("quote");
        if (quote == null) return false;
        JSONObject user = quote.optJSONObject("user");
        if (user == null) return false;
        String uid = user.optString("userId", user.optString("id", ""));
        return NotifyLogic.isReplyToBot(uid, selfId);
    }

    private void notifyMessage(String key, String title, String text, String selfId, String channelId) {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        Intent intent = new Intent(this, MainActivity.class);
        intent.putExtra("bot", selfId);
        intent.putExtra("channel", channelId);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        int id = MESSAGE_NOTIFICATION_BASE + Math.abs(key.hashCode() % 2000);
        PendingIntent pending = PendingIntent.getActivity(this, id, intent, flags);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CHANNEL_MESSAGES)
                : new Notification.Builder(this);
        builder.setContentTitle(title)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setSmallIcon(R.drawable.ic_notify)
                .setAutoCancel(true)
                .setContentIntent(pending)
                .setDefaults(Notification.DEFAULT_ALL);
        if (Build.VERSION.SDK_INT >= 21) builder.setGroup("qq-chat");
        manager.notify(id, builder.build());
        notifiedCount++;
    }
}
