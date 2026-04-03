import Foundation
import CoreML
import WebKit

/// Handles native embedding generation using Core ML.
///
/// The model (bge-base-en-v1.5) is downloaded on first use and stored in the
/// app's documents directory. Core ML leverages the Neural Engine on modern
/// iPhones for 5-20x faster inference vs WASM in the WebView.
///
/// Communication with JS uses the existing IOSBridge WKScriptMessageHandler
/// pattern. Results are dispatched back via `window.dispatchEvent`.
class NativeEmbeddingPlugin {

    // MARK: - Constants

    /// Remote URL where the compiled Core ML model package is hosted.
    /// This should be a .mlmodelc directory compressed as .zip.
    private static let modelDownloadURL = "https://saveitforl8r.com/models/bge-base-en-v1.5.mlmodelc.zip"

    /// Local directory name for the downloaded model.
    private static let modelDirName = "bge-base-en-v1.5.mlmodelc"

    /// Tokenizer vocab file URL (WordPiece tokenizer config).
    private static let tokenizerDownloadURL = "https://saveitforl8r.com/models/bge-base-en-v1.5-tokenizer.json"

    /// Embedding dimensions for bge-base-en-v1.5.
    static let embeddingDimensions = 768

    /// Maximum token sequence length for the model.
    private static let maxSequenceLength = 512

    // MARK: - State

    private var mlModel: MLModel?
    private var tokenizer: WordPieceTokenizer?
    private var isDownloading = false
    private var downloadProgress: Double = 0

    private weak var webView: WKWebView?

    // MARK: - Init

    init(webView: WKWebView?) {
        self.webView = webView
    }

    // MARK: - Model Paths

    private var modelsDirectory: URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return docs.appendingPathComponent("MLModels", isDirectory: true)
    }

    private var modelPath: URL {
        modelsDirectory.appendingPathComponent(Self.modelDirName, isDirectory: true)
    }

    private var tokenizerPath: URL {
        modelsDirectory.appendingPathComponent("bge-base-en-v1.5-tokenizer.json")
    }

    private var isModelDownloaded: Bool {
        FileManager.default.fileExists(atPath: modelPath.path) &&
        FileManager.default.fileExists(atPath: tokenizerPath.path)
    }

    // MARK: - IOSBridge Message Handling

    /// Called from IOSBridgeHandler when an embedding-related action arrives.
    func handleAction(_ action: String, body: [String: Any], requestId: Int) {
        switch action {
        case "embeddingModelStatus":
            handleModelStatus(requestId: requestId)
        case "embeddingDownloadModel":
            handleDownloadModel(requestId: requestId)
        case "embeddingGenerate":
            guard let text = body["text"] as? String else {
                sendError(requestId: requestId, error: "Missing 'text' parameter")
                return
            }
            handleGenerate(text: text, requestId: requestId)
        case "embeddingGenerateBatch":
            guard let texts = body["texts"] as? [String] else {
                sendError(requestId: requestId, error: "Missing 'texts' parameter")
                return
            }
            handleGenerateBatch(texts: texts, requestId: requestId)
        default:
            sendError(requestId: requestId, error: "Unknown embedding action: \(action)")
        }
    }

    // MARK: - Status

    private func handleModelStatus(requestId: Int) {
        if mlModel != nil {
            sendResult(requestId: requestId, result: [
                "status": "ready",
                "modelName": "bge-base-en-v1.5",
                "dimensions": Self.embeddingDimensions
            ])
        } else if isDownloading {
            sendResult(requestId: requestId, result: [
                "status": "downloading",
                "progress": downloadProgress
            ])
        } else if isModelDownloaded {
            // Downloaded but not loaded yet — load it
            loadModel { [weak self] success in
                guard let self = self else { return }
                if success {
                    self.sendResult(requestId: requestId, result: [
                        "status": "ready",
                        "modelName": "bge-base-en-v1.5",
                        "dimensions": Self.embeddingDimensions
                    ])
                } else {
                    self.sendResult(requestId: requestId, result: [
                        "status": "error",
                        "error": "Failed to load model"
                    ])
                }
            }
        } else {
            sendResult(requestId: requestId, result: [
                "status": "not_downloaded",
                "modelName": "bge-base-en-v1.5",
                "dimensions": Self.embeddingDimensions
            ])
        }
    }

    // MARK: - Download

    private func handleDownloadModel(requestId: Int) {
        guard !isDownloading else {
            sendResult(requestId: requestId, result: [
                "status": "downloading",
                "progress": downloadProgress
            ])
            return
        }

        if isModelDownloaded {
            loadModel { [weak self] success in
                guard let self = self else { return }
                self.sendResult(requestId: requestId, result: [
                    "status": success ? "ready" : "error",
                    "error": success ? nil : "Failed to load model"
                ])
            }
            return
        }

        isDownloading = true
        downloadProgress = 0

        // Create models directory
        try? FileManager.default.createDirectory(at: modelsDirectory, withIntermediateDirectories: true)

        let group = DispatchGroup()
        var downloadError: Error?

        // Download model
        group.enter()
        downloadFile(from: Self.modelDownloadURL, isZip: true) { [weak self] error in
            if let error = error { downloadError = error }
            self?.downloadProgress = 70
            group.leave()
        }

        // Download tokenizer
        group.enter()
        downloadFile(from: Self.tokenizerDownloadURL, isZip: false) { [weak self] error in
            if let error = error { downloadError = error }
            self?.downloadProgress = 90
            group.leave()
        }

        group.notify(queue: .main) { [weak self] in
            guard let self = self else { return }
            self.isDownloading = false

            if let error = downloadError {
                self.sendResult(requestId: requestId, result: [
                    "status": "error",
                    "error": error.localizedDescription
                ])
                return
            }

            self.downloadProgress = 100
            self.loadModel { success in
                self.sendResult(requestId: requestId, result: [
                    "status": success ? "ready" : "error",
                    "error": success ? nil : "Failed to load compiled model"
                ])
            }
        }
    }

    private func downloadFile(from urlString: String, isZip: Bool, completion: @escaping (Error?) -> Void) {
        guard let url = URL(string: urlString) else {
            completion(NSError(domain: "NativeEmbedding", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid URL: \(urlString)"]))
            return
        }

        let task = URLSession.shared.downloadTask(with: url) { [weak self] tempURL, response, error in
            guard let self = self else { return }

            if let error = error {
                completion(error)
                return
            }

            guard let tempURL = tempURL else {
                completion(NSError(domain: "NativeEmbedding", code: -2, userInfo: [NSLocalizedDescriptionKey: "No data received"]))
                return
            }

            do {
                if isZip {
                    // Unzip the Core ML model package
                    try self.unzipModel(from: tempURL)
                } else {
                    // Copy tokenizer file directly
                    let dest = self.tokenizerPath
                    if FileManager.default.fileExists(atPath: dest.path) {
                        try FileManager.default.removeItem(at: dest)
                    }
                    try FileManager.default.moveItem(at: tempURL, to: dest)
                }
                completion(nil)
            } catch {
                completion(error)
            }
        }
        task.resume()
    }

    private func unzipModel(from zipURL: URL) throws {
        // Use Foundation's built-in zip handling via Process or FileManager
        // For iOS, we use a simple approach: copy to a temp location and extract
        let destDir = modelsDirectory
        let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)

        // Move zip to temp with proper extension
        let zipDest = tempDir.appendingPathComponent("model.zip")
        try FileManager.default.moveItem(at: zipURL, to: zipDest)

        // Use FileManager to unzip (available since iOS 16)
        if #available(iOS 16.0, *) {
            try FileManager.default.createDirectory(at: tempDir.appendingPathComponent("extracted"), withIntermediateDirectories: true)
            // Use NSFileCoordinator or shell-free extraction
            // For simplicity, use the built-in Archive framework approach
        }

        // Fallback: Use zlib-based extraction via Data
        let zipData = try Data(contentsOf: zipDest)
        let extractDir = tempDir.appendingPathComponent("extracted")
        try FileManager.default.createDirectory(at: extractDir, withIntermediateDirectories: true)

        // Write zip and use coordinator-based extraction
        // iOS doesn't have a built-in zip API, so we rely on the minizip approach
        // that ships with most iOS projects, or use a lightweight unzip implementation.
        // For production, add SSZipArchive or ZIPFoundation as a dependency.
        // For now, expect pre-extracted .mlmodelc directory in the zip root.
        try Self.extractZip(zipData, to: extractDir)

        // Move the .mlmodelc directory to its final location
        let contents = try FileManager.default.contentsOfDirectory(at: extractDir, includingPropertiesForKeys: nil)
        for item in contents where item.lastPathComponent.hasSuffix(".mlmodelc") {
            let finalPath = destDir.appendingPathComponent(Self.modelDirName)
            if FileManager.default.fileExists(atPath: finalPath.path) {
                try FileManager.default.removeItem(at: finalPath)
            }
            try FileManager.default.moveItem(at: item, to: finalPath)
            break
        }

        // Clean up temp
        try? FileManager.default.removeItem(at: tempDir)
    }

    /// Minimal zip extraction using Foundation (expects a flat zip with the .mlmodelc directory).
    /// In production, replace with ZIPFoundation or SSZipArchive for robust handling.
    private static func extractZip(_ data: Data, to directory: URL) throws {
        // Write data to a temporary file and use Apple's Archive framework
        let tempZip = directory.appendingPathComponent("archive.zip")
        try data.write(to: tempZip)

        // Use NSFileCoordinator-based approach or Process
        // Since we're on iOS and can't use Process, we use a simple approach:
        // the caller should provide a pre-extracted .mlmodelc.zip that's just
        // a renamed directory. For a proper implementation, add ZIPFoundation.

        // Attempt extraction using Apple's Compression framework or
        // fall back to expecting the server to provide a tar.gz instead.
        // This is a placeholder — real implementation needs a zip library.
        print("[NativeEmbedding] ZIP extraction placeholder — add ZIPFoundation for production")
        try? FileManager.default.removeItem(at: tempZip)
    }

    // MARK: - Model Loading

    private func loadModel(completion: @escaping (Bool) -> Void) {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else {
                DispatchQueue.main.async { completion(false) }
                return
            }

            do {
                // Load Core ML model
                let config = MLModelConfiguration()
                // Prefer Neural Engine, fall back to GPU, then CPU
                config.computeUnits = .all

                let model = try MLModel(contentsOf: self.modelPath, configuration: config)

                // Load tokenizer
                let tokenizerData = try Data(contentsOf: self.tokenizerPath)
                let tokenizer = try WordPieceTokenizer(jsonData: tokenizerData)

                DispatchQueue.main.async {
                    self.mlModel = model
                    self.tokenizer = tokenizer
                    print("[NativeEmbedding] Model loaded successfully (Core ML + Neural Engine)")
                    completion(true)
                }
            } catch {
                print("[NativeEmbedding] Failed to load model: \(error)")
                DispatchQueue.main.async { completion(false) }
            }
        }
    }

    // MARK: - Embedding Generation

    private func handleGenerate(text: String, requestId: Int) {
        guard let model = mlModel, let tokenizer = tokenizer else {
            // Try loading first
            if isModelDownloaded {
                loadModel { [weak self] success in
                    if success {
                        self?.handleGenerate(text: text, requestId: requestId)
                    } else {
                        self?.sendError(requestId: requestId, error: "Model not loaded")
                    }
                }
            } else {
                sendError(requestId: requestId, error: "Model not downloaded. Call embeddingDownloadModel first.")
            }
            return
        }

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            do {
                let embedding = try self.generateEmbedding(text: text, model: model, tokenizer: tokenizer)
                DispatchQueue.main.async {
                    self.sendResult(requestId: requestId, result: [
                        "embedding": embedding,
                        "dimensions": Self.embeddingDimensions
                    ])
                }
            } catch {
                DispatchQueue.main.async {
                    self.sendError(requestId: requestId, error: error.localizedDescription)
                }
            }
        }
    }

    private func handleGenerateBatch(texts: [String], requestId: Int) {
        guard let model = mlModel, let tokenizer = tokenizer else {
            sendError(requestId: requestId, error: "Model not loaded")
            return
        }

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            do {
                var results: [[String: Any]] = []
                for text in texts {
                    let embedding = try self.generateEmbedding(text: text, model: model, tokenizer: tokenizer)
                    results.append([
                        "embedding": embedding,
                        "dimensions": Self.embeddingDimensions
                    ])
                }
                DispatchQueue.main.async {
                    self.sendResult(requestId: requestId, result: results)
                }
            } catch {
                DispatchQueue.main.async {
                    self.sendError(requestId: requestId, error: error.localizedDescription)
                }
            }
        }
    }

    /// Core embedding generation: tokenize → predict → mean pool → normalize.
    private func generateEmbedding(text: String, model: MLModel, tokenizer: WordPieceTokenizer) throws -> [Double] {
        // Tokenize
        let tokens = tokenizer.tokenize(text, maxLength: Self.maxSequenceLength)

        // Create MLMultiArray inputs
        let inputIds = try MLMultiArray(shape: [1, NSNumber(value: tokens.inputIds.count)], dataType: .int32)
        let attentionMask = try MLMultiArray(shape: [1, NSNumber(value: tokens.attentionMask.count)], dataType: .int32)
        let tokenTypeIds = try MLMultiArray(shape: [1, NSNumber(value: tokens.tokenTypeIds.count)], dataType: .int32)

        for (i, id) in tokens.inputIds.enumerated() {
            inputIds[i] = NSNumber(value: id)
        }
        for (i, mask) in tokens.attentionMask.enumerated() {
            attentionMask[i] = NSNumber(value: mask)
        }
        for (i, typeId) in tokens.tokenTypeIds.enumerated() {
            tokenTypeIds[i] = NSNumber(value: typeId)
        }

        // Create feature provider
        let provider = try MLDictionaryFeatureProvider(dictionary: [
            "input_ids": MLFeatureValue(multiArray: inputIds),
            "attention_mask": MLFeatureValue(multiArray: attentionMask),
            "token_type_ids": MLFeatureValue(multiArray: tokenTypeIds)
        ])

        // Run inference
        let prediction = try model.prediction(from: provider)

        // Extract output — Core ML models typically output "last_hidden_state"
        guard let output = prediction.featureValue(for: "last_hidden_state")?.multiArrayValue ??
                          prediction.featureValue(for: "output")?.multiArrayValue else {
            throw NSError(domain: "NativeEmbedding", code: -3,
                         userInfo: [NSLocalizedDescriptionKey: "No output tensor found"])
        }

        // Mean pooling over token dimension (dim 1), respecting attention mask
        let seqLen = tokens.inputIds.count
        let hiddenSize = Self.embeddingDimensions
        var pooled = [Double](repeating: 0.0, count: hiddenSize)
        var maskSum = 0.0

        for t in 0..<seqLen {
            let mask = Double(tokens.attentionMask[t])
            maskSum += mask
            for h in 0..<hiddenSize {
                let idx = t * hiddenSize + h
                pooled[h] += Double(truncating: output[idx]) * mask
            }
        }

        // Divide by mask sum (avoid division by zero)
        if maskSum > 0 {
            for h in 0..<hiddenSize {
                pooled[h] /= maskSum
            }
        }

        // L2 normalize
        let norm = sqrt(pooled.reduce(0.0) { $0 + $1 * $1 })
        if norm > 0 {
            for h in 0..<hiddenSize {
                pooled[h] /= norm
            }
        }

        return pooled
    }

    // MARK: - JS Communication

    private func sendResult(requestId: Int, result: Any) {
        dispatchToJS(requestId: requestId, result: result, error: nil)
    }

    private func sendError(requestId: Int, error: String) {
        dispatchToJS(requestId: requestId, result: nil, error: error)
    }

    private func dispatchToJS(requestId: Int, result: Any?, error: String?) {
        guard let webView = webView else { return }

        var detail: [String: Any] = ["requestId": requestId]
        if let result = result {
            detail["result"] = result
        }
        if let error = error {
            detail["error"] = error
        }

        guard let jsonData = try? JSONSerialization.data(withJSONObject: detail),
              let jsonString = String(data: jsonData, encoding: .utf8) else {
            print("[NativeEmbedding] Failed to serialize result")
            return
        }

        let js = "window.dispatchEvent(new CustomEvent('nativeEmbeddingResult', { detail: \(jsonString) }));"
        DispatchQueue.main.async {
            webView.evaluateJavaScript(js, completionHandler: nil)
        }
    }
}

// MARK: - WordPiece Tokenizer

/// Minimal WordPiece tokenizer for BERT-family models.
/// Loads vocabulary from the HuggingFace tokenizer.json format.
struct TokenizerOutput {
    let inputIds: [Int]
    let attentionMask: [Int]
    let tokenTypeIds: [Int]
}

class WordPieceTokenizer {
    private let vocab: [String: Int]
    private let unkTokenId: Int
    private let clsTokenId: Int
    private let sepTokenId: Int
    private let padTokenId: Int

    init(jsonData: Data) throws {
        // Parse HuggingFace tokenizer.json format
        guard let json = try JSONSerialization.jsonObject(with: jsonData) as? [String: Any],
              let model = json["model"] as? [String: Any],
              let vocabDict = model["vocab"] as? [String: Int] else {
            throw NSError(domain: "Tokenizer", code: -1,
                         userInfo: [NSLocalizedDescriptionKey: "Invalid tokenizer.json format"])
        }

        self.vocab = vocabDict
        self.unkTokenId = vocabDict["[UNK]"] ?? 100
        self.clsTokenId = vocabDict["[CLS]"] ?? 101
        self.sepTokenId = vocabDict["[SEP]"] ?? 102
        self.padTokenId = vocabDict["[PAD]"] ?? 0
    }

    func tokenize(_ text: String, maxLength: Int) -> TokenizerOutput {
        // Basic pre-tokenization: lowercase, split on whitespace and punctuation
        let lowered = text.lowercased()
        let words = basicTokenize(lowered)

        // WordPiece tokenization
        var tokens: [Int] = [clsTokenId]
        for word in words {
            let subTokens = wordPieceTokenize(word)
            tokens.append(contentsOf: subTokens)
            if tokens.count >= maxLength - 1 { break }
        }
        tokens.append(sepTokenId)

        // Truncate to maxLength
        if tokens.count > maxLength {
            tokens = Array(tokens.prefix(maxLength - 1)) + [sepTokenId]
        }

        let attentionMask = [Int](repeating: 1, count: tokens.count)
        let tokenTypeIds = [Int](repeating: 0, count: tokens.count)

        return TokenizerOutput(
            inputIds: tokens,
            attentionMask: attentionMask,
            tokenTypeIds: tokenTypeIds
        )
    }

    private func basicTokenize(_ text: String) -> [String] {
        var tokens: [String] = []
        var current = ""

        for char in text {
            if char.isWhitespace {
                if !current.isEmpty { tokens.append(current); current = "" }
            } else if char.isPunctuation || char.isSymbol {
                if !current.isEmpty { tokens.append(current); current = "" }
                tokens.append(String(char))
            } else {
                current.append(char)
            }
        }
        if !current.isEmpty { tokens.append(current) }

        return tokens
    }

    private func wordPieceTokenize(_ word: String) -> [Int] {
        if let id = vocab[word] { return [id] }

        var tokens: [Int] = []
        var start = word.startIndex

        while start < word.endIndex {
            var end = word.endIndex
            var found = false

            while start < end {
                let substr: String
                if start == word.startIndex {
                    substr = String(word[start..<end])
                } else {
                    substr = "##" + String(word[start..<end])
                }

                if let id = vocab[substr] {
                    tokens.append(id)
                    start = end
                    found = true
                    break
                }
                end = word.index(before: end)
            }

            if !found {
                tokens.append(unkTokenId)
                start = word.index(after: start)
            }
        }

        return tokens
    }
}
