package com.saveitforl8r.app;

import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebViewClient;

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
        // Install splash screen
        SplashScreen splashScreen = SplashScreen.installSplashScreen(this);
        splashScreen.setKeepOnScreenCondition(() -> !webViewReady);

        configureServerUrl();
        super.onCreate(savedInstanceState);

        // Initialize Share Handler
        shareHandler = new ShareIntentHandler(this, this);

        // Setup WebView listeners
        setupWebView();

        // Process initial intent
        if (getIntent() != null) {
            shareHandler.handleIntent(getIntent());
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent != null) {
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
        if (jsAppReady && pendingShareData != null && bridge != null) {
            Log.d(TAG, "Dispatching share data to JS");
            // triggerJSEvent sends a window event
            bridge.triggerJSEvent("onShareReceived", "window", pendingShareData.toString());
            pendingShareData = null;
        } else {
            Log.d(TAG, "Cannot dispatch share data yet. Ready: " + jsAppReady + ", Data: " + (pendingShareData != null));
        }
    }

    private void setupWebView() {
        if (bridge == null || bridge.getWebView() == null) {
            mainHandler.postDelayed(this::setupWebView, 100);
            return;
        }

        WebView webView = bridge.getWebView();
        
        // Add JS Interface
        webView.addJavascriptInterface(new AppReadyInterface(), "AndroidBridge");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                webViewReady = true;
            }
        });
    }

    private class AppReadyInterface {
        @JavascriptInterface
        public void signalAppReady() {
            Log.d(TAG, "JS App signaled ready");
            mainHandler.post(() -> {
                jsAppReady = true;
                dispatchShareData();
            });
        }
    }

    private void configureServerUrl() {
        SharedPreferences prefs = getSharedPreferences(CAPACITOR_PREFS_NAME, MODE_PRIVATE);
        String useRemote = prefs.getString(PREF_USE_REMOTE, "false");

        if ("true".equals(useRemote)) {
            String serverUrl = prefs.getString(PREF_SERVER_URL, REMOTE_URL);
            getIntent().putExtra("serverUrl", serverUrl);
        }
    }
}
