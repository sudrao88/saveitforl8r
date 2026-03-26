package com.saveitforl8r.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

/**
 * Foreground service for long-running sync operations.
 * Shows a persistent notification with progress while syncing.
 * Only used for user-initiated bulk sync from settings.
 */
public class ForegroundSyncService extends Service {
    private static final String TAG = "ForegroundSyncService";
    private static final String CHANNEL_ID = "sync_channel";
    private static final int NOTIFICATION_ID = 1001;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;

        if ("START".equals(action)) {
            int totalItems = intent.getIntExtra("totalItems", 0);
            Notification notification = buildNotification(
                "Syncing memories...",
                totalItems > 0 ? "Syncing " + totalItems + " memories to Google Drive" : "Starting sync..."
            );
            startForeground(NOTIFICATION_ID, notification);
            Log.d(TAG, "Foreground sync service started");
        } else if ("UPDATE_PROGRESS".equals(action)) {
            int current = intent.getIntExtra("current", 0);
            int total = intent.getIntExtra("total", 0);
            updateNotification("Syncing memories...", "Synced " + current + "/" + total + " memories");
        } else if ("STOP".equals(action)) {
            stopForeground(true);
            stopSelf();
            Log.d(TAG, "Foreground sync service stopped");
        }

        return START_NOT_STICKY;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Sync Progress",
                NotificationManager.IMPORTANCE_LOW // Low importance = no sound
            );
            channel.setDescription("Shows progress during memory sync operations");
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    private Notification buildNotification(String title, String text) {
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_notification)
            .setOngoing(true)
            .setSilent(true)
            .build();
    }

    private void updateNotification(String title, String text) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.notify(NOTIFICATION_ID, buildNotification(title, text));
        }
    }
}
