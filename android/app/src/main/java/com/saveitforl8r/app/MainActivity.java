package com.saveitforl8r.app;

import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.Locale;

import org.json.JSONObject;

import androidx.core.graphics.Insets;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.JSObject;

public class MainActivity extends BridgeActivity implements ShareIntentHandler.ShareResultListener {

    private static final String TAG = "SaveItForL8r";
    private boolean jsAppReady = false;
    private boolean webViewReady = false;
    private ShareIntentHandler shareHandler;
    private JSObject pendingShareData = null;
    private String pendingInsetsJs = null;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    // Splash screen timeout: dismiss even if JS never signals ready.
    // Kept short — the React app calls signalAppReady() on first render,
    // so this is only a safety net for unexpected failures.
    private static final int SPLASH_TIMEOUT_MS = 800;

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

            // Inject safe area insets as CSS variables so env(safe-area-inset-*)
            // works correctly on Android 15+ where edge-to-edge is enforced.
            setupEdgeToEdgeInsets();

            // Set light status bar icons (white text/icons) for dark theme
            WindowInsetsControllerCompat insetsController =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
            insetsController.setAppearanceLightStatusBars(false);

            // Timeout fallback: dismiss splash even if JS never signals ready
            mainHandler.postDelayed(() -> {
                if (!webViewReady) {
                    Log.w(TAG, "Splash screen timeout - dismissing after " +
                          (SPLASH_TIMEOUT_MS / 1000) + " seconds");
                    webViewReady = true;
                }
            }, SPLASH_TIMEOUT_MS);

            // Register periodic background sync via WorkManager
            SyncWorker.register(this);

            // Process initial intent
            if (getIntent() != null) {
                if (isWidgetDeepLink(getIntent())) {
                    handleWidgetDeepLink(getIntent());
                } else {
                    shareHandler.handleIntent(getIntent());
                }
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
        if (intent != null) {
            if (isWidgetDeepLink(intent)) {
                handleWidgetDeepLink(intent);
            } else if (shareHandler != null) {
                shareHandler.handleIntent(intent);
            }
        }
    }

    /**
     * Check if this intent is a widget deep-link (quick-note://).
     */
    private boolean isWidgetDeepLink(Intent intent) {
        if (intent == null || intent.getData() == null) return false;
        Uri data = intent.getData();
        return "com.saveitforl8r.app".equals(data.getScheme())
                && "quick-note".equals(data.getHost());
    }

    /**
     * Handle deep-link from the home screen widget.
     * Dispatches a JS event to focus the quick note bar and optionally
     * open a specific capture mode (e.g., camera).
     */
    private void handleWidgetDeepLink(Intent intent) {
        Uri data = intent.getData();
        String mode = data != null ? data.getQueryParameter("mode") : null;
        String eventDetail = mode != null ? "{\"mode\":\"" + mode + "\"}" : "{}";

        Log.d(TAG, "Widget deep link received, mode: " + mode);

        // Dispatch immediately if JS is ready, otherwise queue it
        mainHandler.post(() -> {
            if (jsAppReady && bridge != null) {
                bridge.triggerJSEvent("onWidgetQuickNote", "window", eventDetail);
            } else {
                // Queue and dispatch when app is ready
                pendingWidgetEvent = eventDetail;
            }
        });
    }

    private String pendingWidgetEvent = null;

    private void dispatchPendingWidgetEvent() {
        if (pendingWidgetEvent != null && bridge != null) {
            bridge.triggerJSEvent("onWidgetQuickNote", "window", pendingWidgetEvent);
            pendingWidgetEvent = null;
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
                // Compare OTA version against bundled version. If the APK was updated
                // with newer assets, discard the stale OTA download and use bundled.
                int otaBuild = readBuildNumber(new java.io.File(updatePath, "version.json"));
                int bundledBuild = readBundledBuildNumber();

                if (otaBuild == -1 || bundledBuild > otaBuild) {
                    Log.d(TAG, "Bundled assets (build " + bundledBuild + ") are newer than OTA (build " + otaBuild + ") — discarding OTA");
                    prefs.edit().putString(PREF_USE_REMOTE, "false").apply();
                    OTADownloadManager.clearUpdate(getFilesDir());
                    return;
                }

                Log.d(TAG, "Applying previously downloaded OTA update from: " + updatePath +
                      " (OTA build " + otaBuild + ", bundled build " + bundledBuild + ")");
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

    /**
     * Reads the buildNumber from a version.json file. Returns -1 on failure.
     */
    private int readBuildNumber(java.io.File versionFile) {
        try (InputStream in = new java.io.FileInputStream(versionFile)) {
            JSONObject json = new JSONObject(new String(readAllBytesCompat(in), "UTF-8"));
            return json.optInt("buildNumber", -1);
        } catch (Exception e) {
            Log.w(TAG, "Failed to read buildNumber from " + versionFile + ": " + e.getMessage());
            return -1;
        }
    }

    /**
     * Reads the buildNumber from the bundled assets/public/version.json.
     * Returns -1 on failure (preserving OTA assets in that case).
     */
    private int readBundledBuildNumber() {
        try (InputStream in = getAssets().open("public/version.json")) {
            JSONObject json = new JSONObject(new String(readAllBytesCompat(in), "UTF-8"));
            return json.optInt("buildNumber", -1);
        } catch (Exception e) {
            Log.w(TAG, "Failed to read bundled version.json: " + e.getMessage());
            return -1;
        }
    }

    /** Reads all bytes from an InputStream. Compatible with API < 33. */
    private static byte[] readAllBytesCompat(InputStream in) throws java.io.IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[1024];
        int n;
        while ((n = in.read(buf)) != -1) {
            out.write(buf, 0, n);
        }
        return out.toByteArray();
    }

    /**
     * Listen for window insets and inject them as CSS custom properties into the WebView.
     * On Android 15+ (API 35+), edge-to-edge is enforced and the app draws behind the
     * status bar. The WebView doesn't map Android insets to CSS env(safe-area-inset-*),
     * so we bridge them manually.
     */
    private void setupEdgeToEdgeInsets() {
        View rootView = findViewById(android.R.id.content);
        if (rootView == null) return;

        ViewCompat.setOnApplyWindowInsetsListener(rootView, (view, windowInsets) -> {
            Insets systemBars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars());
            float density = getResources().getDisplayMetrics().density;

            // Convert px to CSS px (dp)
            final float top = systemBars.top / density;
            final float right = systemBars.right / density;
            final float bottom = systemBars.bottom / density;
            final float left = systemBars.left / density;

            // Build the JS injection string with explicit US locale to ensure
            // decimal points (not commas) in CSS values
            pendingInsetsJs = String.format(Locale.US,
                "document.documentElement.style.setProperty('--sat','%fpx');" +
                "document.documentElement.style.setProperty('--sar','%fpx');" +
                "document.documentElement.style.setProperty('--sab','%fpx');" +
                "document.documentElement.style.setProperty('--sal','%fpx');",
                top, right, bottom, left
            );

            // Dispatch immediately if the app is already ready, otherwise
            // it will be dispatched when signalAppReady() is called
            mainHandler.post(this::dispatchPendingInsets);

            return windowInsets;
        });
    }

    private void dispatchPendingInsets() {
        if (pendingInsetsJs != null && jsAppReady && bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().evaluateJavascript(pendingInsetsJs, null);
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
                    activity.dispatchPendingInsets();
                    activity.dispatchShareData();
                    activity.dispatchPendingWidgetEvent();
                });
            }
        }

        /**
         * Opens the app's notification settings page so the user can
         * re-enable notifications after previously denying permission.
         */
        @JavascriptInterface
        public void openNotificationSettings() {
            Log.d(TAG, "Opening notification settings");
            if (activity == null) return;
            activity.mainHandler.post(() -> {
                try {
                    Intent intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                    intent.putExtra(Settings.EXTRA_APP_PACKAGE, activity.getPackageName());
                    activity.startActivity(intent);
                } catch (Exception e) {
                    Log.e(TAG, "Failed to open notification settings", e);
                }
            });
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
         * Starts the foreground sync service with a persistent notification.
         * Called from JS when the user initiates a bulk sync operation.
         */
        @JavascriptInterface
        public void startForegroundSync(int totalItems) {
            Log.d(TAG, "Starting foreground sync service with " + totalItems + " items");
            if (activity == null) return;
            activity.mainHandler.post(() -> {
                try {
                    android.content.Intent intent = new android.content.Intent(activity, ForegroundSyncService.class);
                    intent.setAction(ForegroundSyncService.ACTION_START);
                    intent.putExtra("totalItems", totalItems);
                    activity.startService(intent);
                } catch (Exception e) {
                    Log.e(TAG, "Failed to start foreground sync service", e);
                }
            });
        }

        /**
         * Updates the foreground sync notification with current progress.
         */
        @JavascriptInterface
        public void updateSyncProgress(int current, int total) {
            if (activity == null) return;
            activity.mainHandler.post(() -> {
                try {
                    android.content.Intent intent = new android.content.Intent(activity, ForegroundSyncService.class);
                    intent.setAction(ForegroundSyncService.ACTION_UPDATE_PROGRESS);
                    intent.putExtra("current", current);
                    intent.putExtra("total", total);
                    activity.startService(intent);
                } catch (Exception e) {
                    Log.e(TAG, "Failed to update sync progress", e);
                }
            });
        }

        /**
         * Stops the foreground sync service and dismisses the notification.
         */
        @JavascriptInterface
        public void stopForegroundSync() {
            Log.d(TAG, "Stopping foreground sync service");
            if (activity == null) return;
            activity.mainHandler.post(() -> {
                try {
                    android.content.Intent intent = new android.content.Intent(activity, ForegroundSyncService.class);
                    intent.setAction(ForegroundSyncService.ACTION_STOP);
                    activity.startService(intent);
                } catch (Exception e) {
                    Log.e(TAG, "Failed to stop foreground sync service", e);
                }
            });
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
