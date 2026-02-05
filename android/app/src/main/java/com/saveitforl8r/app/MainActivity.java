package com.saveitforl8r.app;

import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.webkit.ValueCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    // Remote URL for OTA live updates
    private static final String REMOTE_URL = "https://saveitforl8r.com";

    // Capacitor Preferences uses this SharedPreferences name
    private static final String CAPACITOR_PREFS_NAME = "CapacitorStorage";

    // Preference keys (must match useNativeOTA.ts)
    private static final String PREF_USE_REMOTE = "ota_use_remote";
    private static final String PREF_SERVER_URL = "ota_server_url";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Configure server URL BEFORE calling super.onCreate()
        // which initializes the Capacitor bridge
        configureServerUrl();
        super.onCreate(savedInstanceState);
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

        // Handle share intents (both single and multiple items)
        if ((Intent.ACTION_SEND.equals(action) || Intent.ACTION_SEND_MULTIPLE.equals(action)) && type != null) {
            // Update the activity's intent so the SendIntent plugin can read the new intent
            bridge.getActivity().setIntent(intent);

            // Dispatch a JavaScript event to notify the app that a share intent was received
            bridge.eval("window.dispatchEvent(new Event('sendIntentReceived'))", new ValueCallback<String>() {
                @Override
                public void onReceiveValue(String s) {
                    // Event dispatched
                }
            });
        }
    }
}
