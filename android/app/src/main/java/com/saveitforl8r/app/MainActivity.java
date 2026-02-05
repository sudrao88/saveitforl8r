package com.saveitforl8r.app;

import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.ValueCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "SaveItForL8r";
    private boolean initialIntentHandled = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Handle share intent on cold start
        Intent intent = getIntent();
        if (intent != null) {
            String action = intent.getAction();
            String type = intent.getType();

            Log.d(TAG, "onCreate - Action: " + action + ", Type: " + type);

            if ((Intent.ACTION_SEND.equals(action) || Intent.ACTION_SEND_MULTIPLE.equals(action)) && type != null) {
                Log.d(TAG, "onCreate - Share intent detected, will notify JS after bridge is ready");
                initialIntentHandled = true;

                // Delay to ensure Capacitor bridge and JS are fully initialized
                // The bridge needs time to load the WebView and initialize plugins
                new Handler(Looper.getMainLooper()).postDelayed(() -> {
                    notifyShareIntentReceived();
                }, 1500); // Wait for splash screen and JS initialization
            }
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

    private void notifyShareIntentReceived() {
        if (bridge != null && bridge.getWebView() != null) {
            Log.d(TAG, "Dispatching sendIntentReceived event to JS");
            bridge.eval("window.dispatchEvent(new Event('sendIntentReceived'))", new ValueCallback<String>() {
                @Override
                public void onReceiveValue(String s) {
                    Log.d(TAG, "sendIntentReceived event dispatched, result: " + s);
                }
            });
        } else {
            Log.e(TAG, "Bridge or WebView not ready, retrying in 500ms");
            // Retry if bridge isn't ready yet
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                notifyShareIntentReceived();
            }, 500);
        }
    }
}
