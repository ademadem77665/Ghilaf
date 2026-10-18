package com.ghilaf.webapp;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.ColorStateList;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;

/**
 * غلاف: يعرض الموقع داخل WebView ويسأل الخادم عن حالة الاشتراك عند كل فتح.
 * - الاشتراك فعّال: يفتح الموقع.
 * - الاشتراك منتهٍ أو التطبيق موقوف: شاشة "حدث خطأ، يرجى التواصل مع المطوّر".
 * - لا يوجد إنترنت: يعمل ضمن فترة سماح بعد آخر تحقق ناجح، ثم يعرض شاشة الاتصال.
 */
public class MainActivity extends Activity {
    private static final int FILE_REQ = 1001;
    private static final long DAY = 24L * 60 * 60 * 1000;
    private static final List<String> EXTERNAL_SCHEMES =
            Arrays.asList("tel", "mailto", "sms", "geo", "whatsapp", "tg", "market");

    private final Handler ui = new Handler(Looper.getMainLooper());

    private FrameLayout root;
    private WebView web;
    private ProgressBar bar;
    private View splash;
    private View offlineView;
    private View expiredView;

    private String startUrl = "";
    private String licenseUrl = "";
    private String contact = "";
    private int primary = Color.parseColor("#0B7A63");
    private int onPrimary = Color.WHITE;
    private long graceDays = 7;

    private SharedPreferences prefs;
    private ValueCallback<Uri[]> fileCb;
    private boolean pageFailed = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("ghilaf", MODE_PRIVATE);
        loadConfig();
        buildUi();
        setContentView(root);
        applyBarAppearance();
        registerBack();
        checkLicense();
    }

    // ---------- الإعدادات ----------

    private void loadConfig() {
        try {
            JSONObject j = new JSONObject(readAsset("config.json"));
            startUrl = j.optString("startUrl", "");
            licenseUrl = j.optString("licenseUrl", "");
            contact = j.optString("contact", "");
            graceDays = j.optLong("graceDays", 7);
            try {
                primary = Color.parseColor(j.optString("primaryColor", "#0B7A63"));
            } catch (IllegalArgumentException ignored) {
                // نبقي اللون الافتراضي
            }
        } catch (Exception ignored) {
            // نبقي القيم الافتراضية
        }
        double l = (0.299 * Color.red(primary) + 0.587 * Color.green(primary) + 0.114 * Color.blue(primary)) / 255.0;
        onPrimary = l > 0.62 ? Color.parseColor("#111111") : Color.WHITE;
    }

    private String readAsset(String name) throws IOException {
        try (InputStream in = getAssets().open(name); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    // ---------- الواجهة ----------

    private int dp(int v) {
        return (int) (v * getResources().getDisplayMetrics().density + 0.5f);
    }

    private TextView text(String t, int sp, int color, boolean bold) {
        TextView v = new TextView(this);
        v.setText(t);
        v.setTextSize(sp);
        v.setTextColor(color);
        v.setGravity(Gravity.CENTER);
        if (bold) v.setTypeface(Typeface.DEFAULT_BOLD);
        return v;
    }

    private void buildUi() {
        root = new FrameLayout(this);
        root.setBackgroundColor(primary);
        root.setOnApplyWindowInsetsListener((v, ins) -> {
            int l, t, r, b;
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets s = ins.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets ime = ins.getInsets(WindowInsets.Type.ime());
                l = s.left;
                t = s.top;
                r = s.right;
                b = Math.max(s.bottom, ime.bottom);
            } else {
                l = ins.getSystemWindowInsetLeft();
                t = ins.getSystemWindowInsetTop();
                r = ins.getSystemWindowInsetRight();
                b = ins.getSystemWindowInsetBottom();
            }
            v.setPadding(l, t, r, b);
            return ins;
        });

        web = new WebView(this);
        web.setBackgroundColor(Color.WHITE);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        configureWebView();

        bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        bar.setProgressTintList(ColorStateList.valueOf(primary));
        bar.setVisibility(View.GONE);
        FrameLayout.LayoutParams barLp = new FrameLayout.LayoutParams(-1, dp(3));
        barLp.gravity = Gravity.TOP;
        root.addView(bar, barLp);

        splash = buildSplash();
        offlineView = buildMessage(getString(R.string.err_title), getString(R.string.err_msg), true, false);
        expiredView = buildMessage(getString(R.string.exp_title), getString(R.string.exp_msg), true, true);
        for (View v : new View[]{splash, offlineView, expiredView}) {
            v.setClickable(true); // يمنع وصول اللمس إلى الصفحة خلف الشاشة
            root.addView(v, new FrameLayout.LayoutParams(-1, -1));
        }
        showOnly(splash);
    }

    private View buildSplash() {
        LinearLayout s = new LinearLayout(this);
        s.setOrientation(LinearLayout.VERTICAL);
        s.setGravity(Gravity.CENTER);
        s.setBackgroundColor(primary);

        ImageView icon = new ImageView(this);
        try {
            icon.setImageDrawable(getPackageManager().getApplicationIcon(getApplicationInfo()));
        } catch (Exception ignored) {
            // بلا أيقونة
        }
        s.addView(icon, new LinearLayout.LayoutParams(dp(88), dp(88)));

        TextView name = text(getString(R.string.app_name), 20, onPrimary, true);
        LinearLayout.LayoutParams nlp = new LinearLayout.LayoutParams(-2, -2);
        nlp.topMargin = dp(16);
        s.addView(name, nlp);

        ProgressBar spin = new ProgressBar(this);
        spin.setIndeterminateTintList(ColorStateList.valueOf(onPrimary));
        LinearLayout.LayoutParams slp = new LinearLayout.LayoutParams(dp(28), dp(28));
        slp.topMargin = dp(24);
        s.addView(spin, slp);
        return s;
    }

    private View buildMessage(String title, String msg, boolean withRetry, boolean showContact) {
        LinearLayout v = new LinearLayout(this);
        v.setOrientation(LinearLayout.VERTICAL);
        v.setGravity(Gravity.CENTER);
        v.setBackgroundColor(Color.WHITE);
        v.setPadding(dp(32), dp(32), dp(32), dp(32));

        TextView mark = text("!", 30, Color.parseColor("#B3261E"), true);
        GradientDrawable circle = new GradientDrawable();
        circle.setShape(GradientDrawable.OVAL);
        circle.setColor(Color.parseColor("#FBE3E0"));
        mark.setBackground(circle);
        v.addView(mark, new LinearLayout.LayoutParams(dp(68), dp(68)));

        TextView t = text(title, 20, Color.parseColor("#1B1B1B"), true);
        LinearLayout.LayoutParams tlp = new LinearLayout.LayoutParams(-2, -2);
        tlp.topMargin = dp(20);
        v.addView(t, tlp);

        TextView m = text(msg, 15, Color.parseColor("#4B5651"), false);
        m.setLineSpacing(0, 1.3f);
        LinearLayout.LayoutParams mlp = new LinearLayout.LayoutParams(-2, -2);
        mlp.topMargin = dp(8);
        v.addView(m, mlp);

        if (showContact && contact != null && !contact.isEmpty()) {
            TextView c = text(contact, 15, primary, true);
            c.setTextIsSelectable(true);
            LinearLayout.LayoutParams clp = new LinearLayout.LayoutParams(-2, -2);
            clp.topMargin = dp(14);
            v.addView(c, clp);
        }

        if (withRetry) {
            Button b = new Button(this);
            b.setText(getString(R.string.retry));
            b.setTextColor(onPrimary);
            b.setAllCaps(false);
            GradientDrawable bg = new GradientDrawable();
            bg.setCornerRadius(dp(10));
            bg.setColor(primary);
            b.setBackground(bg);
            b.setPadding(dp(28), 0, dp(28), 0);
            b.setOnClickListener(x -> checkLicense());
            LinearLayout.LayoutParams blp = new LinearLayout.LayoutParams(-2, dp(46));
            blp.topMargin = dp(24);
            v.addView(b, blp);
        }
        return v;
    }

    private void showOnly(View which) {
        splash.setVisibility(which == splash ? View.VISIBLE : View.GONE);
        offlineView.setVisibility(which == offlineView ? View.VISIBLE : View.GONE);
        expiredView.setVisibility(which == expiredView ? View.VISIBLE : View.GONE);
    }

    private void applyBarAppearance() {
        if (Build.VERSION.SDK_INT >= 30 && getWindow().getInsetsController() != null) {
            int flags = android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                    | android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            getWindow().getInsetsController().setSystemBarsAppearance(onPrimary == Color.WHITE ? 0 : flags, flags);
        }
    }

    // ---------- WebView ----------

    private void configureWebView() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                String sc = u.getScheme() == null ? "" : u.getScheme().toLowerCase();
                if (sc.equals("http") || sc.equals("https")) return false;
                if (EXTERNAL_SCHEMES.contains(sc)) openExternal(u);
                return true; // أي رابط آخر يُتجاهل
            }

            @Override
            public void onPageStarted(WebView v, String url, Bitmap favicon) {
                bar.setProgress(0);
                bar.setVisibility(View.VISIBLE);
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                bar.setVisibility(View.GONE);
                if (!pageFailed) showOnly(null);
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame()) {
                    pageFailed = true;
                    showOnly(offlineView);
                }
            }

            @Override
            public void onReceivedSslError(WebView v, SslErrorHandler h, SslError e) {
                h.cancel();
                pageFailed = true;
                showOnly(offlineView);
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView v, int p) {
                bar.setProgress(p);
            }

            @Override
            public boolean onShowFileChooser(WebView w, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (fileCb != null) fileCb.onReceiveValue(null);
                fileCb = cb;
                try {
                    startActivityForResult(p.createIntent(), FILE_REQ);
                } catch (Exception e) {
                    fileCb = null;
                    return false;
                }
                return true;
            }
        });

        web.setDownloadListener((url, ua, cd, mime, len) -> openExternal(Uri.parse(url)));
    }

    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException ignored) {
            // لا يوجد تطبيق يتعامل مع الرابط
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void onActivityResult(int req, int res, Intent data) {
        if (req == FILE_REQ && fileCb != null) {
            fileCb.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data));
            fileCb = null;
            return;
        }
        super.onActivityResult(req, res, data);
    }

    // ---------- الترخيص ----------

    private void checkLicense() {
        pageFailed = false;
        showOnly(splash);
        if (licenseUrl == null || licenseUrl.isEmpty()) {
            loadSite();
            return;
        }
        new Thread(() -> {
            String state = "error";
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(licenseUrl).openConnection();
                c.setConnectTimeout(8000);
                c.setReadTimeout(8000);
                c.setUseCaches(false);
                if (c.getResponseCode() == 200) {
                    try (InputStream in = c.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                        byte[] buf = new byte[2048];
                        int n;
                        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                        JSONObject j = new JSONObject(new String(out.toByteArray(), StandardCharsets.UTF_8));
                        state = j.optBoolean("active", false) ? "active" : "inactive";
                    }
                }
                c.disconnect();
            } catch (Exception ignored) {
                state = "error";
            }
            final String st = state;
            ui.post(() -> handleLicense(st));
        }).start();
    }

    private void handleLicense(String st) {
        long now = System.currentTimeMillis();
        if (st.equals("active")) {
            prefs.edit().putLong("lastOk", now).apply();
            loadSite();
        } else if (st.equals("inactive")) {
            prefs.edit().remove("lastOk").apply();
            showOnly(expiredView);
        } else {
            long last = prefs.getLong("lastOk", 0);
            if (last > 0 && now - last < graceDays * DAY) loadSite();
            else showOnly(offlineView);
        }
    }

    private void loadSite() {
        pageFailed = false;
        web.loadUrl(startUrl);
    }

    // ---------- زر الرجوع ----------

    private void handleBack() {
        boolean overlay = offlineView.getVisibility() == View.VISIBLE || expiredView.getVisibility() == View.VISIBLE;
        if (!overlay && web.canGoBack()) web.goBack();
        else finish();
    }

    private void registerBack() {
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                    new OnBackInvokedCallback() {
                        @Override
                        public void onBackInvoked() {
                            handleBack();
                        }
                    });
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        handleBack(); // للإصدارات الأقدم من 13
    }

    @Override
    protected void onPause() {
        super.onPause();
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        ui.removeCallbacksAndMessages(null);
        web.destroy();
        super.onDestroy();
    }
}
