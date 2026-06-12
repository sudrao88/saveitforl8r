package com.saveitforl8r.app;

import android.util.Log;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Downloads the on-device embedding model (~200 MB .task bundle) to the app's
 * files directory. Mirrors OTADownloadManager's safety rules: HTTPS only,
 * temp-file + atomic rename so a partial download never shadows a good one.
 * Unlike OTA assets the model is too large to buffer, so it streams straight
 * to disk with periodic progress callbacks.
 */
public class EmbeddingModelDownloader {

    private static final String TAG = "EmbeddingModel";

    private static final int CONNECT_TIMEOUT_MS = 15_000;
    private static final int READ_TIMEOUT_MS = 60_000;
    // Progress callback granularity — every 2 MB
    private static final long PROGRESS_INTERVAL_BYTES = 2L * 1024 * 1024;
    // Hard cap to protect storage: 500 MB
    private static final long MAX_MODEL_BYTES = 500L * 1024 * 1024;

    public interface ProgressListener {
        void onProgress(long bytesDownloaded, long totalBytes);
    }

    private final AtomicBoolean cancelled = new AtomicBoolean(false);

    public void cancel() {
        cancelled.set(true);
    }

    /**
     * Synchronous download — callers run this on a background executor.
     * Throws on failure or cancellation; on success the model is at target.
     */
    public void download(String modelUrl, File target, ProgressListener listener) throws IOException {
        if (modelUrl == null || !modelUrl.startsWith("https://")) {
            throw new IOException("Model URL must use HTTPS");
        }
        cancelled.set(false);

        File parent = target.getParentFile();
        if (parent != null && !parent.mkdirs() && !parent.isDirectory()) {
            throw new IOException("Failed to create model directory");
        }
        File tempFile = new File(parent, target.getName() + ".tmp");

        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(modelUrl).openConnection();
            conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
            conn.setReadTimeout(READ_TIMEOUT_MS);
            int code = conn.getResponseCode();
            if (code != HttpURLConnection.HTTP_OK) {
                throw new IOException("HTTP " + code + " downloading model");
            }

            long totalBytes = conn.getContentLengthLong();
            if (totalBytes > MAX_MODEL_BYTES) {
                throw new IOException("Model exceeds size limit");
            }

            long downloaded = 0;
            long lastReported = 0;
            try (InputStream in = new BufferedInputStream(conn.getInputStream());
                 FileOutputStream out = new FileOutputStream(tempFile)) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = in.read(buffer)) != -1) {
                    if (cancelled.get()) {
                        throw new IOException("Download cancelled");
                    }
                    out.write(buffer, 0, read);
                    downloaded += read;
                    if (downloaded > MAX_MODEL_BYTES) {
                        throw new IOException("Model exceeds size limit");
                    }
                    if (listener != null && downloaded - lastReported >= PROGRESS_INTERVAL_BYTES) {
                        lastReported = downloaded;
                        listener.onProgress(downloaded, totalBytes);
                    }
                }
                out.getFD().sync();
            }

            if (listener != null) {
                listener.onProgress(downloaded, totalBytes > 0 ? totalBytes : downloaded);
            }

            if (target.exists() && !target.delete()) {
                throw new IOException("Failed to replace existing model file");
            }
            if (!tempFile.renameTo(target)) {
                throw new IOException("Failed to move model into place");
            }
            Log.d(TAG, "Model downloaded: " + target.getAbsolutePath() + " (" + downloaded + " bytes)");
        } finally {
            if (conn != null) conn.disconnect();
            if (tempFile.exists() && !tempFile.delete()) {
                Log.w(TAG, "Failed to delete temp model file");
            }
        }
    }
}
