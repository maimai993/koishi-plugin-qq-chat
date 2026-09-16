package com.maimai.qqchat;

import android.os.Build;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** 手机端 API 的最小客户端（/qq-chat/api/*） */
public class Api {
    public static final String LOGIN = "/qq-chat/api/login";
    public static final String INFO = "/qq-chat/api/info";
    public static final String ME = "/qq-chat/api/me";
    public static final String EVENTS = "/qq-chat/api/events";
    public static final String NOTIFY_RULES = "/qq-chat/api/notify-rules";

    public static JSONObject request(String baseUrl, String path, String method, String token, JSONObject body) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(baseUrl + path).openConnection();
        conn.setRequestMethod(method);
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(30000);
        conn.setRequestProperty("Accept", "application/json");
        conn.setRequestProperty("User-Agent", "qq-chat-android/1.0");
        if (token != null && !token.isEmpty()) conn.setRequestProperty("Authorization", "Bearer " + token);
        if (body != null) {
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            OutputStream os = conn.getOutputStream();
            try {
                os.write(body.toString().getBytes(StandardCharsets.UTF_8));
            } finally {
                try { os.close(); } catch (Exception ignored) { }
            }
        }
        int code = conn.getResponseCode();
        InputStream in = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
        String text = readAll(in);
        JSONObject result;
        try {
            result = text == null || text.isEmpty() ? new JSONObject() : new JSONObject(text);
        } catch (Exception error) {
            result = new JSONObject();
            result.put("error", "返回内容无法解析");
        }
        result.put("_status", code);
        try { conn.disconnect(); } catch (Exception ignored) { }
        return result;
    }

    /** 用访问密码换令牌（成功返回 token，失败抛异常带上服务端提示） */
    public static String login(String baseUrl, String password) throws Exception {
        JSONObject body = new JSONObject();
        body.put("password", password == null ? "" : password);
        body.put("name", Build.MODEL == null ? "Android" : Build.MODEL);
        JSONObject res = request(baseUrl, LOGIN, "POST", null, body);
        String token = res.optString("token", "");
        if (token.isEmpty()) {
            String error = res.optString("error", "");
            if (error.isEmpty()) error = "登录失败（HTTP " + res.optInt("_status", 0) + "）";
            throw new IllegalStateException(error);
        }
        return token;
    }

    public static String readAll(InputStream in) {
        if (in == null) return "";
        StringBuilder sb = new StringBuilder();
        try {
            BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
            String line;
            while ((line = reader.readLine()) != null) sb.append(line).append('\n');
            reader.close();
        } catch (Exception ignored) { }
        return sb.toString();
    }
}
