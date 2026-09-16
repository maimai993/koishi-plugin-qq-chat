package com.maimai.qqchat;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.CompoundButton;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

/**
 * 手机端主界面：
 *  - 没配置服务器地址时先显示「连接设置」（服务器地址 / 访问密码 / 是否推送）
 *  - 配置好后用 WebView 加载服务端的手机端页面（/qq-chat/m），登录令牌以 cookie 形式注入
 *  - 同时启动前台服务保持 SSE 长连接，新消息走系统通知
 */
public class MainActivity extends Activity {
    private FrameLayout root;
    private WebView webView;
    private TextView statusView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        root = new FrameLayout(this);
        setContentView(root);
        requestNotificationPermission();
        String baseUrl = Prefs.baseUrl(this);
        if (baseUrl.isEmpty()) {
            showSettings(null);
        } else {
            openChat(null, null);
        }
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33) {
            if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{ Manifest.permission.POST_NOTIFICATIONS }, 1001);
            }
        }
    }

    private int dp(float value) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics()));
    }

    /** 连接设置界面 */
    private void showSettings(String tip) {
        if (webView != null) {
            root.removeView(webView);
            webView.destroy();
            webView = null;
        }
        ScrollView scroll = new ScrollView(this);
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(20), dp(28), dp(20), dp(28));
        scroll.addView(box);

        TextView title = new TextView(this);
        title.setText("QQ 机器人 · 连接设置");
        title.setTextSize(20);
        title.setPadding(0, 0, 0, dp(6));
        box.addView(title);

        TextView desc = new TextView(this);
        desc.setText("填写 Koishi 的地址（插件配置里设置了「手机端访问密码」就填上密码）。同一个局域网可以直接填内网地址，例如 http://192.168.1.10:5140");
        desc.setTextSize(12.5f);
        desc.setTextColor(Color.parseColor("#888888"));
        desc.setPadding(0, 0, 0, dp(14));
        box.addView(desc);

        final EditText urlInput = new EditText(this);
        urlInput.setHint("服务器地址，例如 http://192.168.1.10:5140");
        urlInput.setText(Prefs.baseUrl(this));
        urlInput.setInputType(InputType.TYPE_TEXT_VARIATION_URI);
        urlInput.setSingleLine(true);
        box.addView(urlInput);

        final EditText passInput = new EditText(this);
        passInput.setHint("访问密码（mobilePassword）");
        passInput.setText(Prefs.password(this));
        passInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        passInput.setSingleLine(true);
        box.addView(passInput);

        final Switch notifySwitch = new Switch(this);
        notifySwitch.setText("新消息通知（免打扰频道仅在 @ 或引用时提醒）");
        notifySwitch.setTextSize(13f);
        notifySwitch.setChecked(Prefs.notifyEnabled(this));
        notifySwitch.setOnCheckedChangeListener(new CompoundButton.OnCheckedChangeListener() {
            @Override
            public void onCheckedChanged(CompoundButton buttonView, boolean isChecked) {
                Prefs.setNotifyEnabled(MainActivity.this, isChecked);
                if (isChecked) NotifyService.start(MainActivity.this);
                else NotifyService.stop(MainActivity.this);
            }
        });
        box.addView(notifySwitch);

        statusView = new TextView(this);
        statusView.setTextSize(13f);
        statusView.setPadding(0, dp(12), 0, dp(6));
        statusView.setTextColor(Color.parseColor("#4b8bf5"));
        statusView.setText(tip == null ? "" : tip);
        box.addView(statusView);

        LinearLayout buttons = new LinearLayout(this);
        buttons.setOrientation(LinearLayout.HORIZONTAL);
        buttons.setPadding(0, dp(10), 0, 0);

        Button connect = new Button(this);
        connect.setText("保存并连接");
        connect.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                String url = Prefs.normalize(urlInput.getText().toString());
                if (url.isEmpty()) {
                    statusView.setText("请先填写服务器地址");
                    return;
                }
                Prefs.setBaseUrl(MainActivity.this, url);
                Prefs.setPassword(MainActivity.this, passInput.getText().toString());
                signInThenOpen();
            }
        });
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        buttons.addView(connect, params);

        Button test = new Button(this);
        test.setText("测试连接");
        test.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                String url = Prefs.normalize(urlInput.getText().toString());
                if (url.isEmpty()) {
                    statusView.setText("请先填写服务器地址");
                    return;
                }
                statusView.setText("正在测试 " + url + " ...");
                new Thread(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            final org.json.JSONObject info = Api.request(url, Api.INFO, "GET", null, null);
                            final String text = "连接成功：插件 " + info.optString("version", "?")
                                    + (info.optBoolean("passwordRequired") ? "（需要访问密码）" : "（无需密码）");
                            runOnUiThread(new Runnable() {
                                @Override
                                public void run() { statusView.setText(text); }
                            });
                        } catch (final Exception error) {
                            runOnUiThread(new Runnable() {
                                @Override
                                public void run() { statusView.setText("连接失败：" + error.getMessage()); }
                            });
                        }
                    }
                }).start();
            }
        });
        LinearLayout.LayoutParams params2 = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        params2.leftMargin = dp(10);
        buttons.addView(test, params2);
        box.addView(buttons);

        root.removeAllViews();
        root.addView(scroll, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    /** 登录（拿令牌）→ 注入 cookie → 打开 WebView，并启动通知服务 */
    private void signInThenOpen() {
        final String baseUrl = Prefs.baseUrl(this);
        final String password = Prefs.password(this);
        if (statusView != null) statusView.setText("正在登录 " + baseUrl + " ...");
        new Thread(new Runnable() {
            @Override
            public void run() {
                String token = Prefs.token(MainActivity.this);
                String error = null;
                try {
                    if (!password.isEmpty()) {
                        token = Api.login(baseUrl, password);
                        Prefs.setToken(MainActivity.this, token);
                    } else {
                        // 没设密码的实例：先看是否需要密码
                        org.json.JSONObject info = Api.request(baseUrl, Api.INFO, "GET", null, null);
                        if (info.optBoolean("passwordRequired") && !info.optBoolean("authed")) {
                            throw new IllegalStateException("该服务器需要访问密码");
                        }
                    }
                } catch (Exception e) {
                    error = e.getMessage();
                }
                final String finalToken = token;
                final String finalError = error;
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        if (finalError != null) {
                            if (statusView != null) statusView.setText("登录失败：" + finalError);
                            Toast.makeText(MainActivity.this, "登录失败：" + finalError, Toast.LENGTH_LONG).show();
                            return;
                        }
                        if (Prefs.notifyEnabled(MainActivity.this)) {
                            NotifyService.start(MainActivity.this);
                        } else {
                            NotifyService.stop(MainActivity.this);
                        }
                        openChat(null, null);
                    }
                });
            }
        }).start();
    }

    /** 打开聊天页面（WebView 加载服务端的手机端 App） */
    private void openChat(String bot, String channel) {
        String baseUrl = Prefs.baseUrl(this);
        if (baseUrl.isEmpty()) {
            showSettings(null);
            return;
        }
        String token = Prefs.token(this);
        if (token != null && !token.isEmpty()) {
            CookieManager.getInstance().setAcceptCookie(true);
            CookieManager.getInstance().setCookie(baseUrl, "qq-chat-mobile=" + token + "; path=/");
            CookieManager.getInstance().flush();
        }
        if (webView == null) {
            webView = new WebView(this);
            WebSettings settings = webView.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);
            settings.setLoadWithOverviewMode(true);
            settings.setUseWideViewPort(true);
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            webView.setWebViewClient(new WebViewClient());
            root.removeAllViews();
            root.addView(webView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        }
        String url = baseUrl + "/qq-chat/m";
        if (bot != null && channel != null) {
            url += "?bot=" + android.net.Uri.encode(bot) + "&channel=" + android.net.Uri.encode(channel);
        }
        webView.loadUrl(url);
    }

    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        menu.add(0, 1, 0, "设置");
        menu.add(0, 2, 1, "刷新");
        return true;
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        if (item.getItemId() == 1) {
            showSettings(null);
            return true;
        }
        if (item.getItemId() == 2) {
            if (webView != null) webView.reload();
            return true;
        }
        return super.onOptionsItemSelected(item);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent == null) return;
        String bot = intent.getStringExtra("bot");
        String channel = intent.getStringExtra("channel");
        if (bot != null && channel != null) openChat(bot, channel);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        if (webView != null) {
            showSettings(null);
            return;
        }
        super.onBackPressed();
    }
}
