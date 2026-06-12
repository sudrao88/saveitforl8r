import Foundation
import Capacitor
#if canImport(MediaPipeTasksText)
import MediaPipeTasksText
#endif

/// On-device text embedding with EmbeddingGemma, mirroring the Android
/// TextEmbedderPlugin. The JS embedding worker proxies embed calls here
/// through the main thread (NativeProxyEmbedder in embedding.worker.ts).
///
/// NOTE: MediaPipe Tasks Text is distributed via CocoaPods, while this project
/// uses SPM — until the framework is integrated (CocoaPods target or an
/// xcframework), the `canImport` guard keeps this file compiling and the
/// plugin reports the model as unavailable, so iOS transparently stays on the
/// web embedding model. iOS still benefits from native-quality Related
/// Memories computed on Android devices via Drive sync.
@objc(TextEmbedderPlugin)
public class TextEmbedderPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TextEmbedderPlugin"
    public let jsName = "TextEmbedder"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isModelAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "downloadModel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelDownload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteModel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "embed", returnType: CAPPluginReturnPromise)
    ]

    static let modelId = "embeddinggemma-300m"
    // Project-controlled host — HuggingFace/Kaggle downloads are license-gated.
    private static let modelURL = "https://saveitforl8r.com/models/\(modelId).task"

    // MediaPipe's TextEmbedder is not thread-safe; serialize load + inference.
    private let inferenceQueue = DispatchQueue(label: "com.saveitforl8r.embedder")
    private var downloader: EmbeddingModelDownloader?

    #if canImport(MediaPipeTasksText)
    private var embedder: TextEmbedder?
    #endif

    private var modelFileURL: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("models", isDirectory: true)
        return dir.appendingPathComponent("\(Self.modelId).task")
    }

    private var frameworkAvailable: Bool {
        #if canImport(MediaPipeTasksText)
        return true
        #else
        return false
        #endif
    }

    @objc func isModelAvailable(_ call: CAPPluginCall) {
        let url = modelFileURL
        let exists = frameworkAvailable && FileManager.default.fileExists(atPath: url.path)
        var result: [String: Any] = ["available": exists]
        if exists {
            result["modelId"] = Self.modelId
            if let size = try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int64 {
                result["sizeBytes"] = size
            }
        }
        call.resolve(result)
    }

    @objc func downloadModel(_ call: CAPPluginCall) {
        guard frameworkAvailable else {
            call.reject("On-device embedding is not available in this build")
            return
        }
        guard downloader == nil else {
            call.reject("A model download is already in progress")
            return
        }
        guard let remote = URL(string: Self.modelURL) else {
            call.reject("Invalid model URL")
            return
        }

        let task = EmbeddingModelDownloader()
        downloader = task
        task.download(from: remote, to: modelFileURL, progress: { [weak self] downloaded, total in
            self?.notifyListeners("downloadProgress", data: [
                "bytesDownloaded": downloaded,
                "totalBytes": total
            ])
        }, completion: { [weak self] error in
            self?.downloader = nil
            if let error = error {
                call.reject("Model download failed: \(error.localizedDescription)")
            } else {
                call.resolve(["modelId": Self.modelId])
            }
        })
    }

    @objc func cancelDownload(_ call: CAPPluginCall) {
        downloader?.cancel()
        downloader = nil
        call.resolve()
    }

    @objc func deleteModel(_ call: CAPPluginCall) {
        inferenceQueue.async {
            #if canImport(MediaPipeTasksText)
            self.embedder = nil
            #endif
            let url = self.modelFileURL
            if FileManager.default.fileExists(atPath: url.path) {
                do {
                    try FileManager.default.removeItem(at: url)
                } catch {
                    call.reject("Failed to delete model: \(error.localizedDescription)")
                    return
                }
            }
            call.resolve()
        }
    }

    @objc func embed(_ call: CAPPluginCall) {
        guard let texts = call.getArray("texts", String.self), !texts.isEmpty else {
            call.reject("texts is required")
            return
        }

        #if canImport(MediaPipeTasksText)
        inferenceQueue.async {
            do {
                let embedder = try self.ensureEmbedder()
                var vectors: [[Double]] = []
                var dim = 0
                for text in texts {
                    let result = try embedder.embed(text: text)
                    guard let embedding = result.embeddingResult.embeddings.first?.floatEmbedding else {
                        throw NSError(domain: "TextEmbedder", code: 1,
                                      userInfo: [NSLocalizedDescriptionKey: "Empty embedding result"])
                    }
                    let floats = embedding.map { $0.doubleValue }
                    dim = floats.count
                    vectors.append(Self.normalize(floats))
                }
                call.resolve([
                    "vectors": vectors,
                    "modelId": Self.modelId,
                    "dim": dim
                ])
            } catch {
                call.reject("Embed failed: \(error.localizedDescription)")
            }
        }
        #else
        call.reject("On-device embedding is not available in this build")
        #endif
    }

    #if canImport(MediaPipeTasksText)
    private func ensureEmbedder() throws -> TextEmbedder {
        if let embedder = embedder { return embedder }
        let url = modelFileURL
        guard FileManager.default.fileExists(atPath: url.path) else {
            throw NSError(domain: "TextEmbedder", code: 2,
                          userInfo: [NSLocalizedDescriptionKey: "Embedding model is not downloaded"])
        }
        let options = TextEmbedderOptions()
        options.baseOptions.modelAssetPath = url.path
        let created = try TextEmbedder(options: options)
        embedder = created
        return created
    }
    #endif

    // Cosine similarity on the JS side assumes unit vectors.
    private static func normalize(_ vector: [Double]) -> [Double] {
        let norm = sqrt(vector.reduce(0) { $0 + $1 * $1 })
        guard norm > 0 else { return vector }
        return vector.map { $0 / norm }
    }
}
