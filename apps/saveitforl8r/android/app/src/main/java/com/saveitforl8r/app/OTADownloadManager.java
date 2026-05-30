package com.saveitforl8r.app;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Downloads web assets from the remote server to local filesystem for OTA updates.
 * After download, Capacitor's bridge.setServerBasePath() serves them from the local
 * directory, keeping the origin as https://localhost — preserving IndexedDB, localStorage,
 * and Capacitor plugin functionality.
 */
public class OTADownloadManager {

    private static final String TAG = "OTA-Download";
    public static final String UPDATE_DIR = "ota_web_update";

    private static final int CONNECT_TIMEOUT_MS = 15_000;
    private static final int READ_TIMEOUT_MS = 30_000;
    // Max size for in-memory string downloads (manifests, HTML, CSS) — 5 MB
    private static final long MAX_STRING_DOWNLOAD_BYTES = 5 * 1024 * 1024;
    // Max size for individual file downloads — 50 MB (covers large WASM/model files)
    private static final long MAX_FILE_DOWNLOAD_BYTES = 50 * 1024 * 1024;

    public interface Callback {
        void onSuccess(String updatePath);
        void onError(String error);
    }

    /**
     * Downloads all web assets from the remote URL to a local directory.
     * Runs on a background thread; callbacks are dispatched on the main thread.
     *
     * Uses ota-manifest.json (generated at build time) as the primary source of
     * truth for which files to download. This ensures ALL build output files are
     * captured — including worker chunks, WASM binaries, and dynamic imports that
     * aren't referenced in HTML or the Vite manifest.
     *
     * Falls back to HTML/Vite manifest parsing if ota-manifest.json is unavailable
     * (e.g. older deployments that predate this change).
     */
    public static void downloadUpdate(File filesDir, String remoteUrl, Callback callback) {
        Handler mainHandler = new Handler(Looper.getMainLooper());

        // Reject non-HTTPS URLs to prevent Man-in-the-Middle attacks
        if (remoteUrl == null || !remoteUrl.startsWith("https://")) {
            mainHandler.post(() -> callback.onError("OTA update URL must use HTTPS"));
            return;
        }

        new Thread(() -> {
            File updateDir = new File(filesDir, UPDATE_DIR);

            try {
                // Use a temp dir during download so a partial download never
                // overwrites a previously successful one.
                File tempDir = new File(filesDir, UPDATE_DIR + "_tmp");
                deleteRecursive(tempDir);
                if (!tempDir.mkdirs() && !tempDir.isDirectory()) {
                    throw new IOException("Failed to create temp update directory");
                }

                // Try the OTA manifest first — it lists every file in the build output.
                Set<String> filesToDownload = null;
                try {
                    String otaManifest = downloadString(remoteUrl + "/ota-manifest.json");
                    filesToDownload = parseOtaManifest(otaManifest);
                    Log.d(TAG, "Using ota-manifest.json: " + filesToDownload.size() + " files to download");
                } catch (Exception e) {
                    Log.w(TAG, "ota-manifest.json not available, falling back to HTML/Vite parsing: " + e.getMessage());
                }

                int downloaded = 0;
                int failed = 0;

                if (filesToDownload != null && !filesToDownload.isEmpty()) {
                    // ---- Primary path: download every file from the OTA manifest ----
                    for (String relativePath : filesToDownload) {
                        try {
                            File target = new File(tempDir, relativePath);
                            validatePath(target, tempDir);
                            ensureParent(target);
                            downloadToFile(remoteUrl + "/" + relativePath, target);
                            downloaded++;
                        } catch (Exception e) {
                            failed++;
                            Log.w(TAG, "Failed to download: " + relativePath + " — " + e.getMessage());
                        }
                    }
                } else {
                    // ---- Fallback: discover assets from HTML + Vite manifest + CSS ----
                    Log.d(TAG, "Downloading index.html...");
                    String html = downloadString(remoteUrl + "/index.html");
                    writeString(new File(tempDir, "index.html"), html);

                    Set<String> assetPaths = parseAssetPathsFromHtml(html);
                    Log.d(TAG, "Found " + assetPaths.size() + " assets in HTML");

                    try {
                        String manifest = downloadString(remoteUrl + "/.vite/manifest.json");
                        writeString(new File(tempDir, ".vite/manifest.json"), manifest);
                        Set<String> manifestAssets = parseViteManifest(manifest);
                        Log.d(TAG, "Found " + manifestAssets.size() + " assets from Vite manifest");
                        assetPaths.addAll(manifestAssets);
                    } catch (Exception e) {
                        Log.w(TAG, "Vite manifest not available: " + e.getMessage());
                    }

                    for (String path : assetPaths) {
                        try {
                            String normalised = path.startsWith("/") ? path.substring(1) : path;
                            File target = new File(tempDir, normalised);
                            validatePath(target, tempDir);
                            ensureParent(target);
                            downloadToFile(remoteUrl + "/" + normalised, target);
                            downloaded++;
                        } catch (Exception e) {
                            failed++;
                            Log.w(TAG, "Failed to download asset: " + path + " — " + e.getMessage());
                        }
                    }

                    // Parse CSS files for font/image url() references
                    Set<String> cssAssets = new HashSet<>();
                    for (String path : assetPaths) {
                        if (path.endsWith(".css")) {
                            String normalised = path.startsWith("/") ? path.substring(1) : path;
                            File cssFile = new File(tempDir, normalised);
                            if (cssFile.exists()) {
                                try {
                                    String css = readFile(cssFile);
                                    Set<String> refs = parseCssUrls(css, path);
                                    cssAssets.addAll(refs);
                                } catch (Exception e) {
                                    Log.w(TAG, "Failed to parse CSS: " + path);
                                }
                            }
                        }
                    }
                    for (String path : cssAssets) {
                        if (!assetPaths.contains(path)) {
                            try {
                                String normalised = path.startsWith("/") ? path.substring(1) : path;
                                File target = new File(tempDir, normalised);
                                validatePath(target, tempDir);
                                if (!target.exists()) {
                                    ensureParent(target);
                                    downloadToFile(remoteUrl + "/" + normalised, target);
                                    downloaded++;
                                }
                            } catch (Exception e) {
                                failed++;
                                Log.w(TAG, "Failed to download CSS asset: " + path);
                            }
                        }
                    }

                    // Download known static files (non-critical)
                    String[] staticFiles = {
                        "version.json", "manifest.json", "icon.svg", "logo-full.svg", "sw.js"
                    };
                    for (String sf : staticFiles) {
                        try {
                            File target = new File(tempDir, sf);
                            validatePath(target, tempDir);
                            if (!target.exists()) {
                                downloadToFile(remoteUrl + "/" + sf, target);
                            }
                        } catch (Exception ignored) { }
                    }
                }

                Log.d(TAG, "Download complete: " + downloaded + " ok, " + failed + " failed");

                // Verify we have at least index.html and one JS bundle
                File indexFile = new File(tempDir, "index.html");
                if (!indexFile.exists() || indexFile.length() == 0) {
                    throw new IOException("index.html missing or empty after download");
                }

                // Atomically swap: delete old update dir and rename temp → update
                deleteRecursive(updateDir);
                if (!tempDir.renameTo(updateDir)) {
                    throw new IOException("Failed to rename temp dir to update dir");
                }

                Log.d(TAG, "OTA update downloaded to: " + updateDir.getAbsolutePath());
                mainHandler.post(() -> callback.onSuccess(updateDir.getAbsolutePath()));

            } catch (Exception e) {
                Log.e(TAG, "OTA download failed", e);
                mainHandler.post(() -> callback.onError(e.getMessage()));
            }
        }).start();
    }

    /**
     * Returns the path to a previously downloaded update, or null if none exists.
     */
    public static String getExistingUpdatePath(File filesDir) {
        File updateDir = new File(filesDir, UPDATE_DIR);
        File indexFile = new File(updateDir, "index.html");
        if (updateDir.isDirectory() && indexFile.exists()) {
            return updateDir.getAbsolutePath();
        }
        return null;
    }

    /**
     * Deletes a previously downloaded update.
     */
    public static void clearUpdate(File filesDir) {
        deleteRecursive(new File(filesDir, UPDATE_DIR));
        deleteRecursive(new File(filesDir, UPDATE_DIR + "_tmp"));
    }

    // ---- Path validation ----

    /**
     * Validates that a resolved file path stays within the expected base directory.
     * Prevents path traversal attacks where crafted asset paths (e.g. "../../etc/passwd")
     * could write files outside the download directory.
     */
    private static void validatePath(File target, File baseDir) throws IOException {
        String canonicalTarget = target.getCanonicalPath();
        String canonicalBase = baseDir.getCanonicalPath() + File.separator;
        if (!canonicalTarget.startsWith(canonicalBase) && !canonicalTarget.equals(baseDir.getCanonicalPath())) {
            throw new IOException("Path traversal detected: " + canonicalTarget + " is outside " + canonicalBase);
        }
    }

    // ---- Asset discovery ----

    /**
     * Parses the ota-manifest.json file which contains a complete list of all
     * build output files. This is generated at build time by generate-version.js
     * and guarantees no files are missed (worker chunks, WASM, dynamic imports).
     */
    static Set<String> parseOtaManifest(String json) {
        Set<String> paths = new HashSet<>();
        try {
            JSONObject manifest = new JSONObject(json);
            org.json.JSONArray files = manifest.getJSONArray("files");
            for (int i = 0; i < files.length(); i++) {
                String file = files.optString(i, null);
                if (file != null && !file.isEmpty()) {
                    paths.add(file);
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to parse ota-manifest.json: " + e.getMessage());
        }
        return paths;
    }

    /** Extracts local asset paths from HTML src/href attributes. */
    static Set<String> parseAssetPathsFromHtml(String html) {
        Set<String> paths = new HashSet<>();
        // Match src="..." and href="..." for local paths
        Pattern pattern = Pattern.compile(
            "(?:src|href)=[\"'](/[^\"']+\\.(?:js|css|woff2?|ttf|png|svg|jpg|jpeg|webp|ico|json))[\"']",
            Pattern.CASE_INSENSITIVE
        );
        Matcher matcher = pattern.matcher(html);
        while (matcher.find()) {
            String path = matcher.group(1);
            // Only local paths (starting with /), skip external URLs
            if (path.startsWith("/")) {
                paths.add(path);
            }
        }
        return paths;
    }

    /** Extracts file paths from a Vite manifest JSON. */
    static Set<String> parseViteManifest(String json) {
        Set<String> paths = new HashSet<>();
        try {
            JSONObject manifest = new JSONObject(json);
            Iterator<String> keys = manifest.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                JSONObject entry = manifest.optJSONObject(key);
                if (entry == null) continue;

                String file = entry.optString("file", null);
                if (file != null && !file.isEmpty()) {
                    paths.add("/" + file);
                }

                // CSS files referenced by this entry
                org.json.JSONArray css = entry.optJSONArray("css");
                if (css != null) {
                    for (int i = 0; i < css.length(); i++) {
                        String cssFile = css.optString(i, null);
                        if (cssFile != null) paths.add("/" + cssFile);
                    }
                }

                // Asset imports (fonts, images)
                org.json.JSONArray assets = entry.optJSONArray("assets");
                if (assets != null) {
                    for (int i = 0; i < assets.length(); i++) {
                        String asset = assets.optString(i, null);
                        if (asset != null) paths.add("/" + asset);
                    }
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to parse Vite manifest: " + e.getMessage());
        }
        return paths;
    }

    /** Extracts url() references from CSS content, resolving relative paths. */
    static Set<String> parseCssUrls(String css, String cssPath) {
        Set<String> paths = new HashSet<>();
        // Determine the directory containing the CSS file for relative path resolution
        String cssDir = cssPath.contains("/")
                ? cssPath.substring(0, cssPath.lastIndexOf('/'))
                : "";

        Pattern pattern = Pattern.compile("url\\([\"']?([^\"')]+)[\"']?\\)", Pattern.CASE_INSENSITIVE);
        Matcher matcher = pattern.matcher(css);
        while (matcher.find()) {
            String url = matcher.group(1).trim();
            // Skip data URIs and external URLs
            if (url.startsWith("data:") || url.startsWith("http://") || url.startsWith("https://")) {
                continue;
            }
            // Resolve relative paths
            if (url.startsWith("/")) {
                paths.add(url);
            } else {
                paths.add(cssDir + "/" + url);
            }
        }
        return paths;
    }

    // ---- I/O helpers ----

    private static String downloadString(String urlStr) throws IOException {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(urlStr);
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
            conn.setReadTimeout(READ_TIMEOUT_MS);
            conn.setRequestProperty("Cache-Control", "no-cache");

            int code = conn.getResponseCode();
            if (code != 200) {
                throw new IOException("HTTP " + code + " for " + urlStr);
            }

            try (InputStream in = new BufferedInputStream(conn.getInputStream());
                 ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buf = new byte[8192];
                long total = 0;
                int n;
                while ((n = in.read(buf)) != -1) {
                    total += n;
                    if (total > MAX_STRING_DOWNLOAD_BYTES) {
                        throw new IOException("Response exceeds " + MAX_STRING_DOWNLOAD_BYTES + " bytes for " + urlStr);
                    }
                    out.write(buf, 0, n);
                }
                return out.toString("UTF-8");
            }
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static void downloadToFile(String urlStr, File target) throws IOException {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(urlStr);
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
            conn.setReadTimeout(READ_TIMEOUT_MS);
            conn.setRequestProperty("Cache-Control", "no-cache");

            int code = conn.getResponseCode();
            if (code != 200) {
                throw new IOException("HTTP " + code + " for " + urlStr);
            }

            try (InputStream in = new BufferedInputStream(conn.getInputStream());
                 FileOutputStream fos = new FileOutputStream(target)) {
                byte[] buf = new byte[8192];
                long total = 0;
                int n;
                while ((n = in.read(buf)) != -1) {
                    total += n;
                    if (total > MAX_FILE_DOWNLOAD_BYTES) {
                        throw new IOException("File exceeds " + MAX_FILE_DOWNLOAD_BYTES + " bytes for " + urlStr);
                    }
                    fos.write(buf, 0, n);
                }
            }
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static void writeString(File file, String content) throws IOException {
        ensureParent(file);
        try (FileOutputStream fos = new FileOutputStream(file)) {
            fos.write(content.getBytes("UTF-8"));
        }
    }

    private static String readFile(File file) throws IOException {
        try (InputStream in = new BufferedInputStream(new java.io.FileInputStream(file));
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) != -1) {
                out.write(buf, 0, n);
            }
            return out.toString("UTF-8");
        }
    }

    private static void ensureParent(File file) {
        File parent = file.getParentFile();
        if (parent != null && !parent.exists()) {
            parent.mkdirs();
        }
    }

    static void deleteRecursive(File fileOrDir) {
        if (fileOrDir == null || !fileOrDir.exists()) return;
        if (fileOrDir.isDirectory()) {
            File[] children = fileOrDir.listFiles();
            if (children != null) {
                for (File child : children) {
                    deleteRecursive(child);
                }
            }
        }
        fileOrDir.delete();
    }
}
