package com.saveitforl8r.app;

import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "SaveItForL8r";
    private boolean initialIntentHandled = false;
    private boolean jsAppReady = false;
    private boolean pendingShareIntent = false;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    // Remote URL for OTA live updates
    private static final String REMOTE_URL = "https://saveitforl8r.com";

    // Capacitor Preferences uses this SharedPreferences name
    private static final String CAPACITOR_PREFS_NAME = "CapacitorStorage";

    // Preference keys (must match useNativeOTA.ts)
    private static final String PREF_USE_REMOTE = "ota_use_remote";
    private static final String PREF_SERVER_URL = "ota_server_url";

    // Maximum time to wait for JS app to signal readiness (ms)
    private static final int MAX_WAIT_FOR_APP_READY = 10000;
    // Initial delay before checking if app is ready (ms)
    private static final int INITIAL_CHECK_DELAY = 2500;
    // Interval between retry checks (ms)
    private static final int RETRY_CHECK_INTERVAL = 500;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Configure server URL BEFORE calling super.onCreate()
        // which initializes the Capacitor bridge
        configureServerUrl();
        super.onCreate(savedInstanceState);

        // Inject JavaScript interface for app readiness signaling
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().addJavascriptInterface(new AppReadyInterface(), "AndroidBridge");
        }

        // Handle share intent on cold start
        Intent intent = getIntent();
        if (intent != null) {
            String action = intent.getAction();
            String type = intent.getType();

            Log.d(TAG, "onCreate - Action: " + action + ", Type: " + type);

            if ((Intent.ACTION_SEND.equals(action) || Intent.ACTION_SEND_MULTIPLE.equals(action)) && type != null) {
                Log.d(TAG, "onCreate - Share intent detected, will notify JS after app is ready");
                initialIntentHandled = true;
                pendingShareIntent = true;

                // Wait for the app to signal readiness, with fallback timeout
                scheduleShareIntentNotification();
            }
        }
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

        String action = intent.getAction();
        String type = intent.getType();

        Log.d(TAG, "onNewIntent - Action: " + action + ", Type: " + type);

        // Handle share intents (both single and multiple items)
        if ((Intent.ACTION_SEND.equals(action) || Intent.ACTION_SEND_MULTIPLE.equals(action)) && type != null) {
            Log.d(TAG, "onNewIntent - Share intent detected, updating intent and notifying JS");

            // Update the activity's intent so the SendIntent plugin can read the new intent
            setIntent(intent);

            // Small delay to ensure intent is set before JS reads it
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                notifyShareIntentReceived();
            }, 100);
        }
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
