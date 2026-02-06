package com.saveitforl8r.app;

import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Log;
import android.webkit.MimeTypeMap;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class ShareIntentHandler {
    private static final String TAG = "ShareIntentHandler";
    private final Context context;
    private final ExecutorService executorService;
    private final ShareResultListener listener;

    public interface ShareResultListener {
        void onShareDataReady(JSObject data);
    }

    public ShareIntentHandler(Context context, ShareResultListener listener) {
        this.context = context;
        this.listener = listener;
        this.executorService = Executors.newSingleThreadExecutor();
    }

    public void handleIntent(Intent intent) {
        if (intent == null) return;

        String action = intent.getAction();
        String type = intent.getType();

        if ((Intent.ACTION_SEND.equals(action) || Intent.ACTION_SEND_MULTIPLE.equals(action)) && type != null) {
            Log.d(TAG, "Processing share intent: " + action + " type: " + type);
            executorService.execute(() -> processIntent(intent));
        }
    }

    private void processIntent(Intent intent) {
        try {
            JSObject ret = new JSObject();
            String text = extractText(intent);
            ret.put("text", text);

            JSArray files = new JSArray();
            String action = intent.getAction();

            if (Intent.ACTION_SEND.equals(action)) {
                Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                if (uri != null) {
                    JSObject fileObj = processUri(uri);
                    if (fileObj != null) files.put(fileObj);
                }
            } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
                ArrayList<Uri> uris = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
                if (uris != null) {
                    for (Uri uri : uris) {
                        JSObject fileObj = processUri(uri);
                        if (fileObj != null) files.put(fileObj);
                    }
                }
            }
            
            // Check ClipData as fallback
            if (files.length() == 0 && intent.getClipData() != null) {
                ClipData clipData = intent.getClipData();
                for (int i = 0; i < clipData.getItemCount(); i++) {
                    Uri uri = clipData.getItemAt(i).getUri();
                    if (uri != null) {
                        JSObject fileObj = processUri(uri);
                        if (fileObj != null) files.put(fileObj);
                    }
                }
            }

            ret.put("attachments", files);

            Log.d(TAG, "Share processing complete. Found " + files.length() + " attachments.");
            if (listener != null) {
                listener.onShareDataReady(ret);
            }

        } catch (Exception e) {
            Log.e(TAG, "Error processing share intent", e);
        }
    }

    private String extractText(Intent intent) {
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        if (text == null) {
            text = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        }
        return text != null ? text : "";
    }

    private JSObject processUri(Uri uri) {
        try {
            ContentResolver resolver = context.getContentResolver();
            
            // Get filename
            String name = "shared_file";
            String mimeType = resolver.getType(uri);
            if (mimeType == null) mimeType = "application/octet-stream";
            
            try (Cursor cursor = resolver.query(uri, null, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    int nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (nameIndex >= 0) {
                        name = cursor.getString(nameIndex);
                    }
                }
            } catch (Exception e) {
                Log.w(TAG, "Could not query cursor for filename: " + e.getMessage());
            }

            // Ensure extension
            if (!name.contains(".")) {
                String ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mimeType);
                if (ext != null) name += "." + ext;
            }

            // Copy to cache
            File cacheDir = new File(context.getCacheDir(), "shares");
            if (!cacheDir.exists()) cacheDir.mkdirs();
            
            File file = new File(cacheDir, System.currentTimeMillis() + "_" + name);
            
            try (InputStream is = resolver.openInputStream(uri);
                 FileOutputStream fos = new FileOutputStream(file)) {
                
                if (is == null) return null;
                
                byte[] buffer = new byte[8192];
                int bytesRead;
                while ((bytesRead = is.read(buffer)) != -1) {
                    fos.write(buffer, 0, bytesRead);
                }
            }

            JSObject fileObj = new JSObject();
            fileObj.put("name", name);
            fileObj.put("mimeType", mimeType);
            fileObj.put("path", "file://" + file.getAbsolutePath()); 
            
            return fileObj;

        } catch (Exception e) {
            Log.e(TAG, "Failed to process URI: " + uri, e);
            return null;
        }
    }
}
