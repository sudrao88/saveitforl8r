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

            configureServerUrl();
            super.onCreate(savedInstanceState);

            // Initialize Share Handler
            shareHandler = new ShareIntentHandler(this, this);

            // Setup WebView JS interface (without replacing Capacitor's WebViewClient)
            setupWebView();

            // Timeout fallback: dismiss splash after 5 seconds even if JS never signals ready
            mainHandler.postDelayed(() -> {
                if (!webViewReady) {
                    Log.w(TAG, "Splash screen timeout - dismissing after 5 seconds");
                    webViewReady = true;
                }
            }, 5000);

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
        } catch (Exception e) {
            Log.e(TAG, "Error setting up WebView", e);
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
    }

    private void configureServerUrl() {
        try {
            SharedPreferences prefs = getSharedPreferences(CAPACITOR_PREFS_NAME, MODE_PRIVATE);
            String useRemote = prefs.getString(PREF_USE_REMOTE, "false");

            if ("true".equals(useRemote)) {
                String serverUrl = prefs.getString(PREF_SERVER_URL, REMOTE_URL);
                getIntent().putExtra("serverUrl", serverUrl);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error configuring server URL", e);
        }
    }
}
