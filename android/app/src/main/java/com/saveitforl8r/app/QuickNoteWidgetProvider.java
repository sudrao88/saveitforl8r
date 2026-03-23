package com.saveitforl8r.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
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

    private static final String DEEP_LINK_SCHEME = "com.saveitforl8r.app";

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateWidget(context, appWidgetManager, appWidgetId);
        }
    }

    private void updateWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_quick_note);

        // Tap on input hint → open app with quick note bar focused
        Intent quickNoteIntent = new Intent(context, MainActivity.class);
        quickNoteIntent.setAction(Intent.ACTION_VIEW);
        quickNoteIntent.setData(Uri.parse(DEEP_LINK_SCHEME + "://quick-note"));
        quickNoteIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent quickNotePendingIntent = PendingIntent.getActivity(
                context, 0, quickNoteIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_input_hint, quickNotePendingIntent);

        // Tap on icon → open app normally
        Intent openAppIntent = new Intent(context, MainActivity.class);
        openAppIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openAppPendingIntent = PendingIntent.getActivity(
                context, 1, openAppIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_icon, openAppPendingIntent);

        // Tap on camera → open app in photo capture mode
        Intent cameraIntent = new Intent(context, MainActivity.class);
        cameraIntent.setAction(Intent.ACTION_VIEW);
        cameraIntent.setData(Uri.parse(DEEP_LINK_SCHEME + "://quick-note?mode=camera"));
        cameraIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent cameraPendingIntent = PendingIntent.getActivity(
                context, 2, cameraIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_camera_btn, cameraPendingIntent);

        // Tap on document → open app in document upload mode
        Intent docIntent = new Intent(context, MainActivity.class);
        docIntent.setAction(Intent.ACTION_VIEW);
        docIntent.setData(Uri.parse(DEEP_LINK_SCHEME + "://quick-note?mode=document"));
        docIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent docPendingIntent = PendingIntent.getActivity(
                context, 3, docIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_document_btn, docPendingIntent);

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }
}
