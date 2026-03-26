package com.saveitforl8r.app;

import android.content.Context;
import android.content.Intent;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.Worker;
import androidx.work.WorkManager;
import androidx.work.WorkerParameters;

import java.util.concurrent.TimeUnit;

/**
 * WorkManager Worker for periodic background sync.
 * Runs every 12 hours to check for pending enrichments and sync with Drive.
 * Fully silent — no notifications shown.
 *
 * The actual sync work is delegated to the WebView/JS layer via a broadcast
 * or by waking the Capacitor bridge briefly.
 */
public class SyncWorker extends Worker {
    private static final String TAG = "SyncWorker";
    public static final String WORK_NAME = "saveitforl8r-periodic-sync";
    public static final String ACTION_BACKGROUND_SYNC = "com.saveitforl8r.BACKGROUND_SYNC";

    public SyncWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Log.d(TAG, "Background sync started");
        try {
            // Send a broadcast that the app can listen for to trigger sync.
            // This approach works even when the WebView is not loaded.
            Intent intent = new Intent(ACTION_BACKGROUND_SYNC);
            getApplicationContext().sendBroadcast(intent);

            Log.d(TAG, "Background sync broadcast sent");
            return Result.success();
        } catch (Exception e) {
            Log.e(TAG, "Background sync failed", e);
            return Result.retry();
        }
    }

    /**
     * Register the periodic sync work request.
     * Called from MainActivity on app startup.
     */
    public static void register(Context context) {
        Constraints constraints = new Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .setRequiresBatteryNotLow(true)
            .build();

        PeriodicWorkRequest syncRequest = new PeriodicWorkRequest.Builder(
            SyncWorker.class,
            12, TimeUnit.HOURS
        )
            .setConstraints(constraints)
            .build();

        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            WORK_NAME,
            ExistingPeriodicWorkPolicy.KEEP, // Don't replace if already scheduled
            syncRequest
        );

        Log.d(TAG, "Periodic sync registered (12-hour interval)");
    }
}
