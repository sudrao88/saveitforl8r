package com.saveitforl8r.app;

import android.content.Intent;
import android.webkit.ValueCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

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
