package com.saveitforl8r.app;

import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.splashscreen.SplashScreen;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "SaveItForL8r";
    private boolean jsAppReady = false;
    private boolean pendingShareIntent = false;
    private boolean isInitializing = true; // Track if we're still in onCreate()
    private boolean webViewReady = false;
    private Intent pendingIntent = null; // Store the intent to process after WebView is ready
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    // Remote URL for OTA live updates
    private static final String REMOTE_URL = "https://saveitforl8r.com";

    // Capacitor Preferences uses this SharedPreferences name
    private static final String CAPACITOR_PREFS_NAME = "CapacitorStorage";

    // Preference keys (must match useNativeOTA.ts)
    private static final String PREF_USE_REMOTE = "ota_use_remote";
    private static final String PREF_SERVER_URL = "ota_server_url";

    // Maximum time to wait for JS app to signal readiness (ms)
    private static final int MAX_WAIT_FOR_APP_READY = 15000;
    // Initial delay before checking if app is ready (ms)
    private static final int INITIAL_CHECK_DELAY = 1000;
    // Interval between retry checks (ms)
    private static final int RETRY_CHECK_INTERVAL = 500;
    // Maximum retries for WebView setup (50 retries * 100ms = 5 seconds max)
    private static final int MAX_WEBVIEW_SETUP_RETRIES = 50;
    private int webViewSetupRetryCount = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // CRITICAL: Install splash screen BEFORE super.onCreate()
        // This is required for Android 12+ when using Theme.SplashScreen
        SplashScreen splashScreen = SplashScreen.installSplashScreen(this);

        // Keep the splash screen visible until the WebView is ready
        splashScreen.setKeepOnScreenCondition(() -> !webViewReady);

        // Configure server URL BEFORE calling super.onCreate()
        // which initializes the Capacitor bridge
        configureServerUrl();

        super.onCreate(savedInstanceState);

        // Check if this is a share intent and store it for later processing
        Intent intent = getIntent();
        if (intent != null && isShareIntent(intent)) {
            Log.d(TAG, "onCreate - Share intent detected, storing for later processing");
            pendingIntent = intent;
            pendingShareIntent = true;
        }

        // Setup WebView after bridge initialization
        setupWebView();

        // Mark initialization as complete
        isInitializing = false;

        Log.d(TAG, "onCreate completed, waiting for WebView to load");
    }

    /**
     * Check if an intent is a share intent
     */
    private boolean isShareIntent(Intent intent) {
        String action = intent.getAction();
        String type = intent.getType();
        return (Intent.ACTION_SEND.equals(action) || Intent.ACTION_SEND_MULTIPLE.equals(action)) && type != null;
    }

    /**
     * Setup WebView with proper listeners and JavaScript interface
     */
    private void setupWebView() {
        if (bridge == null || bridge.getWebView() == null) {
            webViewSetupRetryCount++;
            if (webViewSetupRetryCount <= MAX_WEBVIEW_SETUP_RETRIES) {
                Log.w(TAG, "setupWebView - Bridge or WebView is null, scheduling retry (" +
                    webViewSetupRetryCount + "/" + MAX_WEBVIEW_SETUP_RETRIES + ")");
                mainHandler.postDelayed(this::setupWebView, 100);
            } else {
                Log.e(TAG, "setupWebView - Max retries exceeded, WebView setup failed");
            }
            return;
        }

        // Reset retry count on success
        webViewSetupRetryCount = 0;

        WebView webView = bridge.getWebView();

        // Add JavaScript interface for app readiness signaling
        try {
            webView.addJavascriptInterface(new AppReadyInterface(), "AndroidBridge");
            Log.d(TAG, "setupWebView - JavaScript interface added");
        } catch (Exception e) {
            Log.e(TAG, "setupWebView - Failed to add JavaScript interface: " + e.getMessage(), e);
        }

        // Add a WebViewClient to detect when the page finishes loading
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                Log.d(TAG, "onPageFinished - URL: " + url);

                if (!webViewReady) {
                    webViewReady = true;
                    Log.d(TAG, "onPageFinished - WebView marked as ready");

                    // Process any pending share intent
                    if (pendingShareIntent && pendingIntent != null) {
                        Log.d(TAG, "onPageFinished - Processing pending share intent");
                        scheduleShareIntentNotification();
                    }
                }
            }
        });
    }

    /**
     * JavaScript interface for the React app to signal it's ready to receive share intents.
     */
    private class AppReadyInterface {
        @JavascriptInterface
        public void signalAppReady() {
            Log.d(TAG, "AppReadyInterface - JS app signaled ready");
            mainHandler.post(() -> {
                jsAppReady = true;
                if (pendingShareIntent) {
                    Log.d(TAG, "AppReadyInterface - Processing pending share intent");
                    pendingShareIntent = false;
                    notifyShareIntentReceived();
                }
            });
        }
    }

    /**
     * Schedules the share intent notification with proper timing.
     * Waits for either JS app readiness signal or fallback timeout.
     */
    private void scheduleShareIntentNotification() {
        final long startTime = System.currentTimeMillis();

        // Initial delay to let splash screen finish and WebView load
        mainHandler.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (!pendingShareIntent) {
                    Log.d(TAG, "scheduleShareIntentNotification - Intent already processed");
                    return;
                }

                long elapsed = System.currentTimeMillis() - startTime;

                if (jsAppReady) {
                    Log.d(TAG, "scheduleShareIntentNotification - App ready, notifying JS");
                    pendingShareIntent = false;
                    notifyShareIntentReceived();
                } else if (elapsed >= MAX_WAIT_FOR_APP_READY) {
                    Log.w(TAG, "scheduleShareIntentNotification - Max wait exceeded, attempting notification anyway");
                    pendingShareIntent = false;
                    notifyShareIntentReceived();
                } else {
                    Log.d(TAG, "scheduleShareIntentNotification - App not ready, retrying in " + RETRY_CHECK_INTERVAL + "ms");
                    mainHandler.postDelayed(this, RETRY_CHECK_INTERVAL);
                }
            }
        }, INITIAL_CHECK_DELAY);
    }

    /**
     * Configures the WebView to load from either bundled assets or remote URL.
     * Reads the OTA preference set by the React app via Capacitor Preferences.
     */
    private void configureServerUrl() {
        SharedPreferences prefs = getSharedPreferences(CAPACITOR_PREFS_NAME, MODE_PRIVATE);
        String useRemote = prefs.getString(PREF_USE_REMOTE, "false");

        if ("true".equals(useRemote)) {
            String serverUrl = prefs.getString(PREF_SERVER_URL, REMOTE_URL);
            // Pass server URL to Capacitor via intent extra
            // Capacitor reads this to override the default server configuration
            getIntent().putExtra("serverUrl", serverUrl);
            android.util.Log.d("OTA", "Loading from remote URL: " + serverUrl);
        } else {
            android.util.Log.d("OTA", "Loading from bundled assets");
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);

        // Skip processing if called during BridgeActivity.load() initialization
        // The share intent will be handled by onCreate() in that case
        if (isInitializing) {
            Log.d(TAG, "onNewIntent - Skipping during initialization (will be handled by onCreate)");
            return;
        }

        String action = intent.getAction();
        String type = intent.getType();

        Log.d(TAG, "onNewIntent - Action: " + action + ", Type: " + type + ", isInitializing: " + isInitializing);

        // Handle share intents (both single and multiple items) - warm start case
        if (isShareIntent(intent)) {
            Log.d(TAG, "onNewIntent - Share intent detected (warm start), updating intent and notifying JS");

            // Update the activity's intent so the SendIntent plugin can read the new intent
            setIntent(intent);
            pendingIntent = intent;

            // Reset state for new share intent
            pendingShareIntent = true;

            // Use scheduleShareIntentNotification to properly wait for JS readiness
            // This avoids race conditions where we might notify before JS is ready
            if (webViewReady) {
                scheduleShareIntentNotification();
            } else {
                // Will be handled when WebView finishes loading
                Log.d(TAG, "onNewIntent - WebView not ready, will notify after load");
            }
        }
    }

    @Override
    protected void onDestroy() {
        // Remove all pending callbacks and messages to prevent memory leaks
        // This ensures no references to the activity are held after destruction
        mainHandler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }

    private int notifyRetryCount = 0;
    private static final int MAX_NOTIFY_RETRIES = 10;

    private void notifyShareIntentReceived() {
        try {
            if (bridge != null && bridge.getWebView() != null) {
                Log.d(TAG, "Dispatching sendIntentReceived event to JS (attempt " + (notifyRetryCount + 1) + ")");

                // Use try-catch for the JavaScript evaluation to prevent crashes
                String jsCode = "try { window.dispatchEvent(new Event('sendIntentReceived')); 'success'; } catch(e) { 'error: ' + e.message; }";

                bridge.eval(jsCode, new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String s) {
                        Log.d(TAG, "sendIntentReceived event dispatched, result: " + s);
                        // Reset retry count on success
                        notifyRetryCount = 0;
                    }
                });
            } else {
                notifyRetryCount++;
                if (notifyRetryCount <= MAX_NOTIFY_RETRIES) {
                    Log.w(TAG, "Bridge or WebView not ready, retrying in 500ms (attempt " + notifyRetryCount + "/" + MAX_NOTIFY_RETRIES + ")");
                    mainHandler.postDelayed(() -> {
                        notifyShareIntentReceived();
                    }, 500);
                } else {
                    Log.e(TAG, "Max retries exceeded for notifyShareIntentReceived, giving up");
                    notifyRetryCount = 0;
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error in notifyShareIntentReceived: " + e.getMessage(), e);
            notifyRetryCount = 0;
        }
    }
}
