package com.saveitforl8r.app;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.MappedByteBuffer;
import java.nio.channels.FileChannel;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

import org.tensorflow.lite.Interpreter;

/**
 * Native embedding generation using TensorFlow Lite on Android.
 *
 * Uses bge-base-en-v1.5 (768-dim) for higher quality search than the
 * web WASM fallback (bge-small, 384-dim). TFLite leverages NNAPI for
 * hardware acceleration on supported devices (GPU/NPU/DSP).
 *
 * Results are dispatched back to JS via window.dispatchEvent on the WebView.
 */
public class NativeEmbeddingPlugin {

    private static final String TAG = "NativeEmbedding";

    // Model URLs
    private static final String MODEL_DOWNLOAD_URL = "https://saveitforl8r.com/models/bge-base-en-v1.5.tflite";
    private static final String TOKENIZER_DOWNLOAD_URL = "https://saveitforl8r.com/models/bge-base-en-v1.5-tokenizer.json";

    // Model parameters
    public static final int EMBEDDING_DIMENSIONS = 768;
    private static final int MAX_SEQUENCE_LENGTH = 512;

    // File names
    private static final String MODEL_FILENAME = "bge-base-en-v1.5.tflite";
    private static final String TOKENIZER_FILENAME = "bge-base-en-v1.5-tokenizer.json";

    private final Context context;
    private final WebView webView;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    private Interpreter interpreter;
    private WordPieceTokenizer tokenizer;
    private boolean isDownloading = false;
    private double downloadProgress = 0;

    public NativeEmbeddingPlugin(Context context, WebView webView) {
        this.context = context;
        this.webView = webView;
    }

    // ── Model paths ──────────────────────────────────────────────────────

    private File getModelsDir() {
        File dir = new File(context.getFilesDir(), "MLModels");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    private File getModelFile() {
        return new File(getModelsDir(), MODEL_FILENAME);
    }

    private File getTokenizerFile() {
        return new File(getModelsDir(), TOKENIZER_FILENAME);
    }

    private boolean isModelDownloaded() {
        return getModelFile().exists() && getTokenizerFile().exists();
    }

    // ── Public API (called from JavascriptInterface) ─────────────────────

    public void handleModelStatus(int requestId) {
        if (interpreter != null) {
            sendResult(requestId, statusJson("ready"));
        } else if (isDownloading) {
            sendResult(requestId, downloadingJson());
        } else if (isModelDownloaded()) {
            // Downloaded but not loaded — load it
            executor.execute(() -> {
                boolean success = loadModel();
                mainHandler.post(() -> sendResult(requestId, statusJson(success ? "ready" : "error")));
            });
        } else {
            sendResult(requestId, statusJson("not_downloaded"));
        }
    }

    public void handleDownloadModel(int requestId) {
        if (isDownloading) {
            sendResult(requestId, downloadingJson());
            return;
        }

        if (isModelDownloaded()) {
            executor.execute(() -> {
                boolean success = loadModel();
                mainHandler.post(() -> sendResult(requestId, statusJson(success ? "ready" : "error")));
            });
            return;
        }

        isDownloading = true;
        downloadProgress = 0;

        executor.execute(() -> {
            try {
                // Download TFLite model
                downloadFile(MODEL_DOWNLOAD_URL, getModelFile());
                downloadProgress = 70;

                // Download tokenizer
                downloadFile(TOKENIZER_DOWNLOAD_URL, getTokenizerFile());
                downloadProgress = 90;

                // Load model
                boolean success = loadModel();
                downloadProgress = 100;
                isDownloading = false;

                mainHandler.post(() -> sendResult(requestId, statusJson(success ? "ready" : "error")));
            } catch (Exception e) {
                Log.e(TAG, "Download failed", e);
                isDownloading = false;
                mainHandler.post(() -> sendError(requestId, e.getMessage()));
            }
        });
    }

    public void handleGenerate(int requestId, String text) {
        if (interpreter == null || tokenizer == null) {
            if (isModelDownloaded()) {
                executor.execute(() -> {
                    if (loadModel()) {
                        generateAndSend(requestId, text);
                    } else {
                        mainHandler.post(() -> sendError(requestId, "Failed to load model"));
                    }
                });
            } else {
                sendError(requestId, "Model not downloaded. Call embeddingDownloadModel first.");
            }
            return;
        }

        executor.execute(() -> generateAndSend(requestId, text));
    }

    public void handleGenerateBatch(int requestId, String textsJson) {
        if (interpreter == null || tokenizer == null) {
            sendError(requestId, "Model not loaded");
            return;
        }

        executor.execute(() -> {
            try {
                JSONArray textsArray = new JSONArray(textsJson);
                JSONArray results = new JSONArray();

                for (int i = 0; i < textsArray.length(); i++) {
                    String text = textsArray.getString(i);
                    double[] embedding = generateEmbedding(text);
                    JSONObject result = new JSONObject();
                    JSONArray embArray = new JSONArray();
                    for (double v : embedding) embArray.put(v);
                    result.put("embedding", embArray);
                    result.put("dimensions", EMBEDDING_DIMENSIONS);
                    results.put(result);
                }

                mainHandler.post(() -> sendResultRaw(requestId, results.toString()));
            } catch (Exception e) {
                Log.e(TAG, "Batch embedding failed", e);
                mainHandler.post(() -> sendError(requestId, e.getMessage()));
            }
        });
    }

    // ── Model loading ────────────────────────────────────────────────────

    private synchronized boolean loadModel() {
        if (interpreter != null) return true;

        try {
            // Load TFLite model with NNAPI delegate for hardware acceleration
            Interpreter.Options options = new Interpreter.Options();
            options.setNumThreads(4);
            // NNAPI acceleration (uses GPU/NPU/DSP when available)
            try {
                options.setUseNNAPI(true);
                Log.d(TAG, "NNAPI acceleration enabled");
            } catch (Exception e) {
                Log.w(TAG, "NNAPI not available, using CPU", e);
            }

            MappedByteBuffer modelBuffer = loadModelFile(getModelFile());
            interpreter = new Interpreter(modelBuffer, options);

            // Load tokenizer
            String tokenizerJson = readFileAsString(getTokenizerFile());
            tokenizer = new WordPieceTokenizer(tokenizerJson);

            Log.d(TAG, "Model loaded successfully (TFLite + NNAPI)");
            return true;
        } catch (Exception e) {
            Log.e(TAG, "Failed to load model", e);
            interpreter = null;
            tokenizer = null;
            return false;
        }
    }

    private MappedByteBuffer loadModelFile(File file) throws IOException {
        FileInputStream fis = new FileInputStream(file);
        FileChannel channel = fis.getChannel();
        MappedByteBuffer buffer = channel.map(FileChannel.MapMode.READ_ONLY, 0, channel.size());
        fis.close();
        return buffer;
    }

    private String readFileAsString(File file) throws IOException {
        StringBuilder sb = new StringBuilder();
        BufferedReader reader = new BufferedReader(new InputStreamReader(new FileInputStream(file)));
        String line;
        while ((line = reader.readLine()) != null) {
            sb.append(line);
        }
        reader.close();
        return sb.toString();
    }

    // ── Embedding generation ─────────────────────────────────────────────

    private void generateAndSend(int requestId, String text) {
        try {
            double[] embedding = generateEmbedding(text);
            JSONObject result = new JSONObject();
            JSONArray embArray = new JSONArray();
            for (double v : embedding) embArray.put(v);
            result.put("embedding", embArray);
            result.put("dimensions", EMBEDDING_DIMENSIONS);
            mainHandler.post(() -> sendResult(requestId, result));
        } catch (Exception e) {
            Log.e(TAG, "Embedding generation failed", e);
            mainHandler.post(() -> sendError(requestId, e.getMessage()));
        }
    }

    private double[] generateEmbedding(String text) throws Exception {
        // Tokenize
        WordPieceTokenizer.TokenizerOutput tokens = tokenizer.tokenize(text, MAX_SEQUENCE_LENGTH);

        int seqLen = tokens.inputIds.length;

        // Create input buffers
        // TFLite expects int32 inputs shaped [1, seqLen]
        int[][] inputIds = new int[1][seqLen];
        int[][] attentionMask = new int[1][seqLen];
        int[][] tokenTypeIds = new int[1][seqLen];

        System.arraycopy(tokens.inputIds, 0, inputIds[0], 0, seqLen);
        System.arraycopy(tokens.attentionMask, 0, attentionMask[0], 0, seqLen);
        System.arraycopy(tokens.tokenTypeIds, 0, tokenTypeIds[0], 0, seqLen);

        // Run inference
        // Output: [1, seqLen, hiddenSize]
        float[][][] output = new float[1][seqLen][EMBEDDING_DIMENSIONS];

        Map<Integer, Object> outputs = new HashMap<>();
        outputs.put(0, output);

        interpreter.runForMultipleInputsOutputs(
            new Object[]{inputIds, attentionMask, tokenTypeIds},
            outputs
        );

        // Mean pooling with attention mask
        double[] pooled = new double[EMBEDDING_DIMENSIONS];
        double maskSum = 0;

        for (int t = 0; t < seqLen; t++) {
            double mask = tokens.attentionMask[t];
            maskSum += mask;
            for (int h = 0; h < EMBEDDING_DIMENSIONS; h++) {
                pooled[h] += output[0][t][h] * mask;
            }
        }

        if (maskSum > 0) {
            for (int h = 0; h < EMBEDDING_DIMENSIONS; h++) {
                pooled[h] /= maskSum;
            }
        }

        // L2 normalize
        double norm = 0;
        for (double v : pooled) norm += v * v;
        norm = Math.sqrt(norm);
        if (norm > 0) {
            for (int h = 0; h < EMBEDDING_DIMENSIONS; h++) {
                pooled[h] /= norm;
            }
        }

        return pooled;
    }

    // ── File download ────────────────────────────────────────────────────

    private void downloadFile(String urlString, File destFile) throws IOException {
        URL url = new URL(urlString);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(30000);
        connection.setReadTimeout(60000);

        try (InputStream in = new BufferedInputStream(connection.getInputStream());
             FileOutputStream out = new FileOutputStream(destFile)) {
            byte[] buffer = new byte[8192];
            int bytesRead;
            while ((bytesRead = in.read(buffer)) != -1) {
                out.write(buffer, 0, bytesRead);
            }
        } finally {
            connection.disconnect();
        }
    }

    // ── JS communication ─────────────────────────────────────────────────

    private void sendResult(int requestId, JSONObject result) {
        try {
            JSONObject detail = new JSONObject();
            detail.put("requestId", requestId);
            detail.put("result", result);
            dispatchEvent(detail.toString());
        } catch (JSONException e) {
            Log.e(TAG, "Failed to build result JSON", e);
        }
    }

    private void sendResultRaw(int requestId, String resultJson) {
        String js = String.format(
            "window.dispatchEvent(new CustomEvent('nativeEmbeddingResult', { detail: { requestId: %d, result: %s } }));",
            requestId, resultJson
        );
        mainHandler.post(() -> webView.evaluateJavascript(js, null));
    }

    private void sendError(int requestId, String error) {
        try {
            JSONObject detail = new JSONObject();
            detail.put("requestId", requestId);
            detail.put("error", error);
            dispatchEvent(detail.toString());
        } catch (JSONException e) {
            Log.e(TAG, "Failed to build error JSON", e);
        }
    }

    private void dispatchEvent(String detailJson) {
        String js = "window.dispatchEvent(new CustomEvent('nativeEmbeddingResult', { detail: " + detailJson + " }));";
        mainHandler.post(() -> webView.evaluateJavascript(js, null));
    }

    // ── Helper JSON builders ─────────────────────────────────────────────

    private JSONObject statusJson(String status) {
        try {
            JSONObject obj = new JSONObject();
            obj.put("status", status);
            obj.put("modelName", "bge-base-en-v1.5");
            obj.put("dimensions", EMBEDDING_DIMENSIONS);
            return obj;
        } catch (JSONException e) {
            return new JSONObject();
        }
    }

    private JSONObject downloadingJson() {
        try {
            JSONObject obj = new JSONObject();
            obj.put("status", "downloading");
            obj.put("progress", downloadProgress);
            return obj;
        } catch (JSONException e) {
            return new JSONObject();
        }
    }

    // ── WordPiece Tokenizer ──────────────────────────────────────────────

    /**
     * Minimal WordPiece tokenizer for BERT-family models.
     * Loads vocabulary from HuggingFace tokenizer.json format.
     */
    static class WordPieceTokenizer {
        private final Map<String, Integer> vocab;
        private final int unkTokenId;
        private final int clsTokenId;
        private final int sepTokenId;

        static class TokenizerOutput {
            final int[] inputIds;
            final int[] attentionMask;
            final int[] tokenTypeIds;

            TokenizerOutput(int[] inputIds, int[] attentionMask, int[] tokenTypeIds) {
                this.inputIds = inputIds;
                this.attentionMask = attentionMask;
                this.tokenTypeIds = tokenTypeIds;
            }
        }

        WordPieceTokenizer(String jsonString) throws JSONException {
            JSONObject json = new JSONObject(jsonString);
            JSONObject model = json.getJSONObject("model");
            JSONObject vocabJson = model.getJSONObject("vocab");

            vocab = new HashMap<>();
            for (java.util.Iterator<String> it = vocabJson.keys(); it.hasNext(); ) {
                String key = it.next();
                vocab.put(key, vocabJson.getInt(key));
            }

            unkTokenId = vocab.getOrDefault("[UNK]", 100);
            clsTokenId = vocab.getOrDefault("[CLS]", 101);
            sepTokenId = vocab.getOrDefault("[SEP]", 102);
        }

        TokenizerOutput tokenize(String text, int maxLength) {
            String lowered = text.toLowerCase();
            String[] words = basicTokenize(lowered);

            // WordPiece tokenization
            java.util.List<Integer> tokens = new java.util.ArrayList<>();
            tokens.add(clsTokenId);

            for (String word : words) {
                java.util.List<Integer> subTokens = wordPieceTokenize(word);
                tokens.addAll(subTokens);
                if (tokens.size() >= maxLength - 1) break;
            }
            tokens.add(sepTokenId);

            // Truncate
            if (tokens.size() > maxLength) {
                tokens = tokens.subList(0, maxLength - 1);
                tokens.add(sepTokenId);
            }

            int len = tokens.size();
            int[] inputIds = new int[len];
            int[] attentionMask = new int[len];
            int[] tokenTypeIds = new int[len];

            for (int i = 0; i < len; i++) {
                inputIds[i] = tokens.get(i);
                attentionMask[i] = 1;
                tokenTypeIds[i] = 0;
            }

            return new TokenizerOutput(inputIds, attentionMask, tokenTypeIds);
        }

        private String[] basicTokenize(String text) {
            // Split on whitespace and punctuation
            java.util.List<String> tokens = new java.util.ArrayList<>();
            StringBuilder current = new StringBuilder();

            for (int i = 0; i < text.length(); i++) {
                char c = text.charAt(i);
                if (Character.isWhitespace(c)) {
                    if (current.length() > 0) {
                        tokens.add(current.toString());
                        current.setLength(0);
                    }
                } else if (isPunctuation(c)) {
                    if (current.length() > 0) {
                        tokens.add(current.toString());
                        current.setLength(0);
                    }
                    tokens.add(String.valueOf(c));
                } else {
                    current.append(c);
                }
            }
            if (current.length() > 0) tokens.add(current.toString());

            return tokens.toArray(new String[0]);
        }

        private boolean isPunctuation(char c) {
            int type = Character.getType(c);
            return type == Character.CONNECTOR_PUNCTUATION ||
                   type == Character.DASH_PUNCTUATION ||
                   type == Character.END_PUNCTUATION ||
                   type == Character.FINAL_QUOTE_PUNCTUATION ||
                   type == Character.INITIAL_QUOTE_PUNCTUATION ||
                   type == Character.OTHER_PUNCTUATION ||
                   type == Character.START_PUNCTUATION ||
                   type == Character.MATH_SYMBOL ||
                   type == Character.CURRENCY_SYMBOL ||
                   type == Character.OTHER_SYMBOL;
        }

        private java.util.List<Integer> wordPieceTokenize(String word) {
            if (vocab.containsKey(word)) {
                java.util.List<Integer> result = new java.util.ArrayList<>();
                result.add(vocab.get(word));
                return result;
            }

            java.util.List<Integer> tokens = new java.util.ArrayList<>();
            int start = 0;

            while (start < word.length()) {
                int end = word.length();
                boolean found = false;

                while (start < end) {
                    String substr = (start == 0)
                        ? word.substring(start, end)
                        : "##" + word.substring(start, end);

                    if (vocab.containsKey(substr)) {
                        tokens.add(vocab.get(substr));
                        start = end;
                        found = true;
                        break;
                    }
                    end--;
                }

                if (!found) {
                    tokens.add(unkTokenId);
                    start++;
                }
            }

            return tokens;
        }
    }
}
