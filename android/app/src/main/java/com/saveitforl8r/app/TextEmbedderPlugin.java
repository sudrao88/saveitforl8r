package com.saveitforl8r.app;

import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mediapipe.tasks.core.BaseOptions;
import com.google.mediapipe.tasks.text.textembedder.TextEmbedder;
import com.google.mediapipe.tasks.text.textembedder.TextEmbedderResult;

import org.json.JSONException;

import java.io.File;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * On-device text embedding with EmbeddingGemma via the MediaPipe / Google AI
 * Edge TextEmbedder. The JS embedding worker proxies its embed calls here
 * through the main thread (see NativeProxyEmbedder in embedding.worker.ts);
 * results are stored and searched on the JS side exactly like web vectors.
 *
 * The model bundle (~200 MB) is far too large to ship in the APK, so it is
 * downloaded on demand from the project's asset host into filesDir/models.
 *
 * Threading: MediaPipe's TextEmbedder is not thread-safe — all model loading
 * and inference is serialized on a single-thread executor, keeping the main
 * thread free.
 */
@CapacitorPlugin(name = "TextEmbedder")
public class TextEmbedderPlugin extends Plugin {

    private static final String TAG = "TextEmbedderPlugin";

    static final String MODEL_ID = "embeddinggemma-300m";
    private static final String MODEL_DIR = "models";
    private static final String MODEL_FILE = MODEL_ID + ".task";
    // Project-controlled host (HuggingFace/Kaggle downloads are license-gated
    // and unsuitable for unauthenticated in-app downloads).
    private static final String MODEL_URL = "https://saveitforl8r.com/models/" + MODEL_FILE;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private TextEmbedder embedder;
    private EmbeddingModelDownloader activeDownload;

    private File modelFile() {
        return new File(new File(getContext().getFilesDir(), MODEL_DIR), MODEL_FILE);
    }

    @PluginMethod
    public void isModelAvailable(PluginCall call) {
        File model = modelFile();
        JSObject result = new JSObject();
        boolean available = model.exists() && model.length() > 0;
        result.put("available", available);
        if (available) {
            result.put("modelId", MODEL_ID);
            result.put("sizeBytes", model.length());
        }
        call.resolve(result);
    }

    @PluginMethod
    public void downloadModel(PluginCall call) {
        if (activeDownload != null) {
            call.reject("A model download is already in progress");
            return;
        }
        final EmbeddingModelDownloader downloader = new EmbeddingModelDownloader();
        activeDownload = downloader;

        new Thread(() -> {
            try {
                downloader.download(MODEL_URL, modelFile(), (bytesDownloaded, totalBytes) -> {
                    JSObject progress = new JSObject();
                    progress.put("bytesDownloaded", bytesDownloaded);
                    progress.put("totalBytes", totalBytes);
                    notifyListeners("downloadProgress", progress);
                });
                JSObject result = new JSObject();
                result.put("modelId", MODEL_ID);
                call.resolve(result);
            } catch (Exception e) {
                Log.e(TAG, "Model download failed", e);
                call.reject("Model download failed: " + e.getMessage());
            } finally {
                activeDownload = null;
            }
        }, "embedding-model-download").start();
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        EmbeddingModelDownloader downloader = activeDownload;
        if (downloader != null) {
            downloader.cancel();
        }
        call.resolve();
    }

    @PluginMethod
    public void deleteModel(PluginCall call) {
        executor.execute(() -> {
            closeEmbedder();
            File model = modelFile();
            if (model.exists() && !model.delete()) {
                call.reject("Failed to delete model file");
                return;
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void embed(PluginCall call) {
        JSArray texts = call.getArray("texts");
        if (texts == null || texts.length() == 0) {
            call.reject("texts is required");
            return;
        }

        executor.execute(() -> {
            try {
                TextEmbedder activeEmbedder = ensureEmbedder();
                JSArray vectors = new JSArray();
                int dim = 0;
                List<Object> textList = texts.toList();
                for (Object textObj : textList) {
                    String text = String.valueOf(textObj);
                    TextEmbedderResult result = activeEmbedder.embed(text);
                    float[] embedding = result.embeddingResult().embeddings().get(0).floatEmbedding();
                    dim = embedding.length;
                    vectors.put(toNormalizedJsArray(embedding));
                }
                JSObject result = new JSObject();
                result.put("vectors", vectors);
                result.put("modelId", MODEL_ID);
                result.put("dim", dim);
                call.resolve(result);
            } catch (Exception e) {
                Log.e(TAG, "Embed failed", e);
                call.reject("Embed failed: " + e.getMessage());
            }
        });
    }

    /** Lazily loads the embedder from the downloaded model file. */
    private TextEmbedder ensureEmbedder() {
        if (embedder == null) {
            File model = modelFile();
            if (!model.exists()) {
                throw new IllegalStateException("Embedding model is not downloaded");
            }
            TextEmbedder.TextEmbedderOptions options = TextEmbedder.TextEmbedderOptions.builder()
                .setBaseOptions(BaseOptions.builder().setModelAssetPath(model.getAbsolutePath()).build())
                .build();
            embedder = TextEmbedder.createFromOptions(getContext(), options);
            Log.d(TAG, "Embedder loaded from " + model.getAbsolutePath());
        }
        return embedder;
    }

    private void closeEmbedder() {
        if (embedder != null) {
            try {
                embedder.close();
            } catch (Exception e) {
                Log.w(TAG, "Failed to close embedder", e);
            }
            embedder = null;
        }
    }

    // Cosine similarity on the JS side assumes unit vectors — normalize here
    // so all stored vectors are directly comparable.
    private static JSArray toNormalizedJsArray(float[] embedding) throws JSONException {
        double normSq = 0;
        for (float v : embedding) normSq += (double) v * v;
        double norm = Math.sqrt(normSq);
        JSArray array = new JSArray();
        for (float v : embedding) {
            array.put(norm > 0 ? v / norm : v);
        }
        return array;
    }

    @Override
    protected void handleOnDestroy() {
        executor.execute(this::closeEmbedder);
        executor.shutdown();
        super.handleOnDestroy();
    }
}
