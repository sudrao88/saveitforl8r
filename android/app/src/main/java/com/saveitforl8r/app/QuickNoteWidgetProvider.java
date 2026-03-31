package com.saveitforl8r.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

/**
 * Home screen widget that provides quick access to note creation.
 *
 * The widget shows a search-bar-style input hint, a camera button, and a
 * document upload button. Tapping the input area opens the app with the
 * QuickNoteBar focused. Tapping camera/document buttons opens the app with
 * the corresponding file picker pre-triggered.
 *
 * Note: Android RemoteViews don't support EditText, so the widget uses
 * a TextView hint that deep-links into the app when tapped.
 */
public class QuickNoteWidgetProvider extends AppWidgetProvider {

    /**
     * Custom actions for widget quick-note intents. Using explicit actions
     * instead of ACTION_VIEW with a custom URI scheme avoids Samsung One UI
     * intercepting the intent through its link handler/browser.
     * Separate actions per mode allow FLAG_IMMUTABLE PendingIntents.
     */
    public static final String ACTION_QUICK_NOTE_TEXT = "com.saveitforl8r.app.ACTION_QUICK_NOTE_TEXT";
    public static final String ACTION_QUICK_NOTE_CAMERA = "com.saveitforl8r.app.ACTION_QUICK_NOTE_CAMERA";
    public static final String ACTION_QUICK_NOTE_DOCUMENT = "com.saveitforl8r.app.ACTION_QUICK_NOTE_DOCUMENT";

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateWidget(context, appWidgetManager, appWidgetId);
        }
    }

    private void updateWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_quick_note);

        // Tap on input hint → open app with quick note bar focused
        views.setOnClickPendingIntent(R.id.widget_input_hint,
                buildQuickNotePendingIntent(context, 0, null));

        // Tap on icon → open app normally
        Intent openAppIntent = new Intent(context, MainActivity.class);
        openAppIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        views.setOnClickPendingIntent(R.id.widget_icon, PendingIntent.getActivity(
                context, 1, openAppIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));

        // Tap on camera → open app in photo capture mode
        views.setOnClickPendingIntent(R.id.widget_camera_btn,
                buildQuickNotePendingIntent(context, 2, "camera"));

        // Tap on document → open app in document upload mode
        views.setOnClickPendingIntent(R.id.widget_document_btn,
                buildQuickNotePendingIntent(context, 3, "document"));

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }

    /**
     * Builds a PendingIntent that launches the app's quick-note handler.
     *
     * Uses an explicit intent with a distinct action per mode instead of
     * ACTION_VIEW with a URI scheme. This is more reliable on Samsung One UI
     * devices which can intercept ACTION_VIEW intents through their link handler.
     * Distinct actions allow using FLAG_IMMUTABLE for better security.
     *
     * @param context      Application context
     * @param requestCode  Unique request code for the PendingIntent
     * @param mode         Optional capture mode ("camera", "document"), or null for text focus
     */
    private static PendingIntent buildQuickNotePendingIntent(Context context, int requestCode, String mode) {
        Intent intent = new Intent(context, MainActivity.class);

        String action;
        if ("camera".equals(mode)) {
            action = ACTION_QUICK_NOTE_CAMERA;
        } else if ("document".equals(mode)) {
            action = ACTION_QUICK_NOTE_DOCUMENT;
        } else {
            action = ACTION_QUICK_NOTE_TEXT;
        }
        intent.setAction(action);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        return PendingIntent.getActivity(
                context, requestCode, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
