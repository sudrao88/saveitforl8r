package com.saveitforl8r.app;

import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.core.splashscreen.SplashScreen;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.JSObject;

public class MainActivity extends BridgeActivity implements ShareIntentHandler.ShareResultListener {

    private static final String TAG = "SaveItForL8r";
    private boolean jsAppReady = false;
    private boolean webViewReady = false;
    private ShareIntentHandler shareHandler;
    private JSObject pendingShareData = null;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    // Splash screen timeout: dismiss even if JS never signals ready
    private static final int SPLASH_TIMEOUT_MS = 5000;

    // Remote URL for OTA live updates
    private static final String REMOTE_URL = "https://saveitforl8r.com";
    private static final String CAPACITOR_PREFS_NAME = "CapacitorStorage";
    private static final String PREF_USE_REMOTE = "ota_use_remote";
    private static final String PREF_SERVER_URL = "ota_server_url";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        try {
            // Install splash screen - stays visible until JS app signals ready
            SplashScreen splashScreen = SplashScreen.installSplashScreen(this);
            splashScreen.setKeepOnScreenCondition(() -> !webViewReady);

            // NOTE: Do NOT call configureServerUrl() here — Capacitor 8's Bridge
            // ignores intent extras for serverUrl. Instead, we load the remote URL
            // directly on the WebView after bridge init (see setupWebView).
            super.onCreate(savedInstanceState);

            // Initialize Share Handler
            shareHandler = new ShareIntentHandler(this, this);

            // Setup WebView JS interface and load remote URL if OTA mode is active.
            // This must happen after super.onCreate() so the bridge is initialized.
            setupWebView();

            // Timeout fallback: dismiss splash even if JS never signals ready
            mainHandler.postDelayed(() -> {
                if (!webViewReady) {
                    Log.w(TAG, "Splash screen timeout - dismissing after " +
                          (SPLASH_TIMEOUT_MS / 1000) + " seconds");
                    webViewReady = true;
                }
            }, SPLASH_TIMEOUT_MS);

            // Process initial intent
            if (getIntent() != null) {
                shareHandler.handleIntent(getIntent());
            }
        } catch (Exception e) {
            Log.e(TAG, "Error in onCreate", e);
            // Ensure splash screen doesn't hang on error
            webViewReady = true;
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent != null && shareHandler != null) {
            shareHandler.handleIntent(intent);
        }
    }

    @Override
    public void onShareDataReady(JSObject data) {
        Log.d(TAG, "Share data ready to send to JS");
        pendingShareData = data;
        
        // Post to main thread to ensure bridge access is safe
        mainHandler.post(this::dispatchShareData);
    }

    private void dispatchShareData() {
        try {
            if (jsAppReady && pendingShareData != null && bridge != null) {
                Log.d(TAG, "Dispatching share data to JS");
                // triggerJSEvent sends a window event
                bridge.triggerJSEvent("onShareReceived", "window", pendingShareData.toString());
                pendingShareData = null;
            } else {
                Log.d(TAG, "Cannot dispatch share data yet. Ready: " + jsAppReady + ", Data: " + (pendingShareData != null));
            }
        } catch (Exception e) {
            Log.e(TAG, "Error dispatching share data", e);
        }
    }

    private void setupWebView() {
        try {
            if (bridge == null || bridge.getWebView() == null) {
                // Retry in 100ms
                mainHandler.postDelayed(this::setupWebView, 100);
                return;
            }

            WebView webView = bridge.getWebView();

            // Add JS Interface for app-ready signaling from React
            webView.addJavascriptInterface(new AppReadyInterface(this), "AndroidBridge");

            // IMPORTANT: Do NOT call webView.setWebViewClient() here.
            // Capacitor's BridgeWebViewClient handles shouldInterceptRequest() to serve
            // local assets from the bundled assets/public/ directory. Replacing it causes
            // "Web page not available" on first launch because the WebView tries to load
            // https://localhost/ over the network instead of from local assets.

            // After bridge and JS interface are ready, load the remote URL if OTA
            // remote mode was previously enabled (persisted in SharedPreferences).
            loadRemoteUrlIfNeeded();
        } catch (Exception e) {
            Log.e(TAG, "Error setting up WebView", e);
        }
    }

    /**
     * If the user has previously switched to OTA remote mode, load the remote URL
     * directly on the WebView. Capacitor 8's Bridge does NOT read serverUrl from
     * intent extras — it only reads from CapConfig (capacitor.config.json). So we
     * bypass the config pipeline and navigate the WebView directly.
     *
     * The splash screen is still visible at this point, covering any brief flash
     * from the local-to-remote navigation.
     */
    private void loadRemoteUrlIfNeeded() {
        try {
            SharedPreferences prefs = getSharedPreferences(CAPACITOR_PREFS_NAME, MODE_PRIVATE);
            String useRemote = prefs.getString(PREF_USE_REMOTE, "false");

            if (!"true".equals(useRemote)) {
                Log.d(TAG, "Using local bundled assets");
                return;
            }

            String serverUrl = prefs.getString(PREF_SERVER_URL, REMOTE_URL);

            // Validate the URL against the expected production domain.
            if (serverUrl == null || !(serverUrl.equals(REMOTE_URL) || serverUrl.startsWith(REMOTE_URL + "/"))) {
                Log.w(TAG, "Blocked invalid OTA server URL: " + serverUrl);
                prefs.edit().putString(PREF_USE_REMOTE, "false").apply();
                return;
            }

            Log.d(TAG, "OTA remote mode active — loading: " + serverUrl);
            WebView webView = bridge.getWebView();
            webView.clearCache(true);
            webView.loadUrl(serverUrl);
        } catch (Exception e) {
            Log.e(TAG, "Error loading remote URL for OTA", e);
        }
    }

    // Made public and static (or keeping ref) to be safe
    public class AppReadyInterface {
        private MainActivity activity;

        public AppReadyInterface(MainActivity activity) {
            this.activity = activity;
        }

        @JavascriptInterface
        public void signalAppReady() {
            Log.d(TAG, "JS App signaled ready");
            if (activity != null) {
                activity.mainHandler.post(() -> {
                    activity.jsAppReady = true;
                    activity.webViewReady = true; // Dismiss splash screen
                    activity.dispatchShareData();
                });
            }
        }

        @JavascriptInterface
        public void enableRemoteMode() {
            Log.d(TAG, "Enabling remote mode via Bridge");
            if (activity == null) return;

            SharedPreferences prefs = activity.getSharedPreferences(CAPACITOR_PREFS_NAME, MODE_PRIVATE);
            prefs.edit()
                .putString(PREF_USE_REMOTE, "true")
                .putString(PREF_SERVER_URL, REMOTE_URL)
                .apply();

            // Load the remote URL directly on the WebView. No activity restart
            // needed — Capacitor's bridge and JS interfaces persist across navigations.
            activity.mainHandler.post(() -> {
                try {
                    if (activity.bridge != null && activity.bridge.getWebView() != null) {
                        WebView webView = activity.bridge.getWebView();
                        webView.clearCache(true);
                        webView.loadUrl(REMOTE_URL);
                    }
                } catch (Exception e) {
                    Log.e(TAG, "Error loading remote URL in enableRemoteMode", e);
                }
            });
        }

        @JavascriptInterface
        public void disableRemoteMode() {
            Log.d(TAG, "Disabling remote mode via Bridge");
            if (activity == null) return;

            SharedPreferences prefs = activity.getSharedPreferences(CAPACITOR_PREFS_NAME, MODE_PRIVATE);
            prefs.edit()
                .putString(PREF_USE_REMOTE, "false")
                .remove(PREF_SERVER_URL)
                .apply();

            // Restart the activity to cleanly reinitialize with bundled local assets.
            // Unlike enableRemoteMode (which can navigate in-place), going back to
            // bundled mode requires Capacitor's BridgeWebViewClient to serve local
            // assets from the default https://localhost/ origin.
            activity.mainHandler.post(() -> {
                Intent intent = activity.getIntent();
                activity.finish();
                activity.startActivity(intent);
            });
        }
    }

}
