import Foundation

/// Streams the on-device embedding model (~200 MB) to Application Support,
/// mirroring the Android EmbeddingModelDownloader: HTTPS only, temp location
/// then atomic move so a partial download never shadows a good one.
final class EmbeddingModelDownloader: NSObject, URLSessionDownloadDelegate {

    typealias ProgressHandler = (Int64, Int64) -> Void
    typealias CompletionHandler = (Error?) -> Void

    private var session: URLSession?
    private var task: URLSessionDownloadTask?
    private var destination: URL?
    private var progressHandler: ProgressHandler?
    private var completionHandler: CompletionHandler?

    func download(from remote: URL, to destination: URL,
                  progress: @escaping ProgressHandler,
                  completion: @escaping CompletionHandler) {
        guard remote.scheme == "https" else {
            completion(NSError(domain: "EmbeddingModelDownloader", code: 1,
                               userInfo: [NSLocalizedDescriptionKey: "Model URL must use HTTPS"]))
            return
        }
        self.destination = destination
        self.progressHandler = progress
        self.completionHandler = completion

        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 60
        let session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
        self.session = session
        let task = session.downloadTask(with: remote)
        self.task = task
        task.resume()
    }

    func cancel() {
        task?.cancel()
        session?.invalidateAndCancel()
        finish(with: NSError(domain: "EmbeddingModelDownloader", code: 2,
                             userInfo: [NSLocalizedDescriptionKey: "Download cancelled"]))
    }

    private func finish(with error: Error?) {
        let completion = completionHandler
        completionHandler = nil
        progressHandler = nil
        task = nil
        session?.finishTasksAndInvalidate()
        session = nil
        completion?(error)
    }

    // MARK: - URLSessionDownloadDelegate

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                    didWriteData bytesWritten: Int64, totalBytesWritten: Int64,
                    totalBytesExpectedToWrite: Int64) {
        progressHandler?(totalBytesWritten, totalBytesExpectedToWrite)
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                    didFinishDownloadingTo location: URL) {
        guard let destination = destination else { return }
        do {
            if let http = downloadTask.response as? HTTPURLResponse, http.statusCode != 200 {
                throw NSError(domain: "EmbeddingModelDownloader", code: http.statusCode,
                              userInfo: [NSLocalizedDescriptionKey: "HTTP \(http.statusCode) downloading model"])
            }
            let dir = destination.deletingLastPathComponent()
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            if FileManager.default.fileExists(atPath: destination.path) {
                try FileManager.default.removeItem(at: destination)
            }
            try FileManager.default.moveItem(at: location, to: destination)
            finish(with: nil)
        } catch {
            finish(with: error)
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error = error {
            finish(with: error)
        }
    }
}
