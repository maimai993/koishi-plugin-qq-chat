package com.maimai.qqchat;

import android.content.Context;
import android.content.SharedPreferences;

/** 本机设置：服务器地址 / 访问密码 / 令牌 / 是否推送 */
public class Prefs {
    private static final String NAME = "qq-chat";

    public static SharedPreferences get(Context ctx) {
        return ctx.getSharedPreferences(NAME, Context.MODE_PRIVATE);
    }

    public static String baseUrl(Context ctx) {
        return get(ctx).getString("baseUrl", "");
    }

    public static void setBaseUrl(Context ctx, String value) {
        get(ctx).edit().putString("baseUrl", normalize(value)).apply();
    }

    public static String password(Context ctx) {
        return get(ctx).getString("password", "");
    }

    public static void setPassword(Context ctx, String value) {
        get(ctx).edit().putString("password", value == null ? "" : value).apply();
    }

    public static String token(Context ctx) {
        return get(ctx).getString("token", "");
    }

    public static void setToken(Context ctx, String value) {
        get(ctx).edit().putString("token", value == null ? "" : value).apply();
    }

    public static boolean notifyEnabled(Context ctx) {
        return get(ctx).getBoolean("notify", true);
    }

    public static void setNotifyEnabled(Context ctx, boolean value) {
        get(ctx).edit().putBoolean("notify", value).apply();
    }

    /** 把用户输入的地址补成 http://host:port 形式 */
    public static String normalize(String url) {
        String value = url == null ? "" : url.trim();
        if (value.isEmpty()) return "";
        if (!value.startsWith("http://") && !value.startsWith("https://")) value = "http://" + value;
        while (value.endsWith("/")) value = value.substring(0, value.length() - 1);
        return value;
    }
}
