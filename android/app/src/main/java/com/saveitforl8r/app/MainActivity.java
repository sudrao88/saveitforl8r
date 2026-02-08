package com.saveitforl8r.app;

import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

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

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        try {
            // Install splash screen - stays visible until JS app signals ready
            SplashScreen splashScreen = SplashScreen.installSplashScreen(this);
            splashScreen.setKeepOnScreenCondition(() -> !webViewReady);

            super.onCreate(savedInstanceState);

            // Initialize Share Handler
            shareHandler = new ShareIntentHandler(this, this);

            // Setup WebView JS interface and apply OTA update if previously downloaded.
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

            // If a previous OTA update was downloaded, serve it via setServerBasePath.
            // This keeps the origin as https://localhost — preserving IndexedDB,
            // localStorage, and all Capacitor plugin functionality.
            applyDownloadedUpdateIfExists();
        } catch (Exception e) {
            Log.e(TAG, "Error setting up WebView", e);
        }
    }

    /**
     * If an OTA update was previously downloaded, tell Capacitor's local server
     * to serve files from the download directory instead of the bundled assets.
     *
     * bridge.setServerBasePath() preserves the https://localhost origin, so
     * IndexedDB, localStorage, and Capacitor plugins all continue working.
     * It also automatically reloads the WebView.
     */
    private void applyDownloadedUpdateIfExists() {
        try {
            SharedPreferences prefs = getSharedPreferences(CAPACITOR_PREFS_NAME, MODE_PRIVATE);
            String useRemote = prefs.getString(PREF_USE_REMOTE, "false");

            if (!"true".equals(useRemote)) {
                Log.d(TAG, "Using bundled assets (OTA not active)");
                return;
            }

            String updatePath = OTADownloadManager.getExistingUpdatePath(getFilesDir());
            if (updatePath != null) {
                Log.d(TAG, "Applying previously downloaded OTA update from: " + updatePath);
                // setServerBasePath tells the local server to serve files from this
                // filesystem path, then reloads the WebView. Origin stays https://localhost.
                bridge.setServerBasePath(updatePath);
            } else {
                Log.w(TAG, "OTA preference is true but no downloaded update found — resetting");
                prefs.edit().putString(PREF_USE_REMOTE, "false").apply();
            }
        } catch (Exception e) {
            Log.e(TAG, "Error applying downloaded OTA update", e);
        }
    }

    public class AppReadyInterface {
        private final MainActivity activity;

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

        /**
         * Downloads new web assets from the remote server and applies the update.
         * Called from JS when the user taps the "Update" button.
         *
         * The assets are downloaded to local storage, then served via
         * bridge.setServerBasePath(). The origin stays https://localhost so
         * IndexedDB, localStorage, and Capacitor plugins all continue working.
         */
        @JavascriptInterface
        public void enableRemoteMode() {
            Log.d(TAG, "Starting OTA download from: " + REMOTE_URL);
            if (activity == null) return;

            SharedPreferences prefs = activity.getSharedPreferences(CAPACITOR_PREFS_NAME, MODE_PRIVATE);

            OTADownloadManager.downloadUpdate(activity.getFilesDir(), REMOTE_URL,
                new OTADownloadManager.Callback() {
                    @Override
                    public void onSuccess(String updatePath) {
                        Log.d(TAG, "OTA download complete, applying update from: " + updatePath);
                        prefs.edit().putString(PREF_USE_REMOTE, "true").apply();

                        // setServerBasePath switches the local server to serve from the
                        // downloaded directory and reloads the WebView automatically.
                        if (activity.bridge != null) {
                            activity.bridge.setServerBasePath(updatePath);
                        }
                    }

                    @Override
                    public void onError(String error) {
                        Log.e(TAG, "OTA download failed: " + error);
                        // Notify JS of failure so it can show an error to the user
                        if (activity.bridge != null) {
                            String safeError = JSONObject.quote(error);
                            activity.bridge.eval(
                                "window.dispatchEvent(new CustomEvent('ota-error', " +
                                "{ detail: " + safeError + " }));",
                                v -> {}
                            );
                        }
                    }
                }
            );
        }

        /**
         * Clears the downloaded OTA update and restarts with bundled assets.
         */
        @JavascriptInterface
        public void disableRemoteMode() {
            Log.d(TAG, "Disabling remote mode via Bridge");
            if (activity == null) return;

            SharedPreferences prefs = activity.getSharedPreferences(CAPACITOR_PREFS_NAME, MODE_PRIVATE);
            prefs.edit().putString(PREF_USE_REMOTE, "false").apply();

            // Delete downloaded assets
            OTADownloadManager.clearUpdate(activity.getFilesDir());

            // Restart activity to reinitialize with bundled assets.
            // setServerBasePath has already changed the local server's base path,
            // so we need a full restart to reset it to the default bundled assets.
            activity.mainHandler.post(() -> {
                Intent intent = activity.getIntent();
                activity.finish();
                activity.startActivity(intent);
            });
        }
    }

}
