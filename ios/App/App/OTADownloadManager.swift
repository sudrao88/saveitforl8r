import Foundation

/// Downloads web assets from the remote server to local filesystem for OTA updates.
/// After download, Capacitor's setServerBasePath() serves them from the local directory,
/// keeping the origin as capacitor://localhost — preserving IndexedDB, localStorage,
/// and Capacitor plugin functionality.
class OTADownloadManager {

    static let updateDirName = "ota_web_update"
    private static let tempDirName = "ota_web_update_tmp"
    private static let connectTimeoutSecs: TimeInterval = 15
    private static let maxStringDownloadBytes = 5 * 1024 * 1024  // 5 MB
    private static let maxFileDownloadBytes = 50 * 1024 * 1024   // 50 MB

    enum OTAError: Error, LocalizedError {
        case invalidURL
        case httpError(Int, String)
        case downloadFailed(String)
        case missingIndex
        case renameFailed

        var errorDescription: String? {
            switch self {
            case .invalidURL: return "OTA update URL must use HTTPS"
            case .httpError(let code, let url): return "HTTP \(code) for \(url)"
            case .downloadFailed(let msg): return msg
            case .missingIndex: return "index.html missing or empty after download"
            case .renameFailed: return "Failed to rename temp dir to update dir"
            }
        }
    }

    /// Downloads all web assets from the remote URL to a local directory.
    /// Completion is called on the main thread.
    static func downloadUpdate(remoteUrl: String, completion: @escaping (Result<String, Error>) -> Void) {
        guard remoteUrl.hasPrefix("https://") else {
            DispatchQueue.main.async { completion(.failure(OTAError.invalidURL)) }
            return
        }

        Task {
            do {
                let path = try await performDownload(remoteUrl: remoteUrl)
                DispatchQueue.main.async { completion(.success(path)) }
            } catch {
                DispatchQueue.main.async { completion(.failure(error)) }
            }
        }
    }

    private static func performDownload(remoteUrl: String) async throws -> String {
        let docsDir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        let updateDir = docsDir.appendingPathComponent(updateDirName)
        let tempDir = docsDir.appendingPathComponent(tempDirName)

        // Clean up any previous temp dir
        try? FileManager.default.removeItem(at: tempDir)
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)

        do {
            // Try ota-manifest.json first
            var filesToDownload: [String]?
            do {
                let manifestData = try await downloadData(from: remoteUrl + "/ota-manifest.json")
                if let json = try JSONSerialization.jsonObject(with: manifestData) as? [String: Any],
                   let files = json["files"] as? [String] {
                    filesToDownload = files
                    print("[OTA] Using ota-manifest.json: \(files.count) files to download")
                }
            } catch {
                print("[OTA] ota-manifest.json not available, falling back to HTML parsing: \(error.localizedDescription)")
            }

            var downloaded = 0
            var failed = 0

            if let files = filesToDownload, !files.isEmpty {
                // Primary path: download every file from the OTA manifest
                for relativePath in files {
                    do {
                        let target = tempDir.appendingPathComponent(relativePath)
                        try validatePath(target, within: tempDir)
                        try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
                        try await downloadToFile(from: remoteUrl + "/" + relativePath, to: target)
                        downloaded += 1
                    } catch {
                        failed += 1
                        print("[OTA] Failed to download: \(relativePath) — \(error.localizedDescription)")
                    }
                }
            } else {
                // Fallback: discover assets from HTML
                let htmlData = try await downloadData(from: remoteUrl + "/index.html")
                let htmlStr = String(data: htmlData, encoding: .utf8) ?? ""
                try htmlData.write(to: tempDir.appendingPathComponent("index.html"))

                var assetPaths = parseAssetPathsFromHtml(htmlStr)

                // Try Vite manifest
                do {
                    let manifestData = try await downloadData(from: remoteUrl + "/.vite/manifest.json")
                    let viteDir = tempDir.appendingPathComponent(".vite")
                    try FileManager.default.createDirectory(at: viteDir, withIntermediateDirectories: true)
                    try manifestData.write(to: viteDir.appendingPathComponent("manifest.json"))

                    if let manifestStr = String(data: manifestData, encoding: .utf8) {
                        assetPaths.formUnion(parseViteManifest(manifestStr))
                    }
                } catch {
                    print("[OTA] Vite manifest not available: \(error.localizedDescription)")
                }

                for path in assetPaths {
                    do {
                        let normalised = path.hasPrefix("/") ? String(path.dropFirst()) : path
                        let target = tempDir.appendingPathComponent(normalised)
                        try validatePath(target, within: tempDir)
                        try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
                        try await downloadToFile(from: remoteUrl + "/" + normalised, to: target)
                        downloaded += 1
                    } catch {
                        failed += 1
                        print("[OTA] Failed to download asset: \(path) — \(error.localizedDescription)")
                    }
                }

                // Download known static files
                for sf in ["version.json", "manifest.json", "icon.svg", "logo-full.svg", "sw.js"] {
                    let target = tempDir.appendingPathComponent(sf)
                    if !FileManager.default.fileExists(atPath: target.path) {
                        try? await downloadToFile(from: remoteUrl + "/" + sf, to: target)
                    }
                }
            }

            print("[OTA] Download complete: \(downloaded) ok, \(failed) failed")

            // Verify index.html exists
            let indexFile = tempDir.appendingPathComponent("index.html")
            guard FileManager.default.fileExists(atPath: indexFile.path),
                  (try? Data(contentsOf: indexFile))?.isEmpty == false else {
                throw OTAError.missingIndex
            }

            // Atomically swap: delete old update dir and rename temp → update
            try? FileManager.default.removeItem(at: updateDir)
            do {
                try FileManager.default.moveItem(at: tempDir, to: updateDir)
            } catch {
                throw OTAError.renameFailed
            }

            print("[OTA] OTA update downloaded to: \(updateDir.path)")
            return updateDir.path

        } catch {
            print("[OTA] Download failed: \(error.localizedDescription)")
            try? FileManager.default.removeItem(at: tempDir)
            throw error
        }
    }

    /// Returns the path to a previously downloaded update, or nil if none exists.
    static func getExistingUpdatePath() -> String? {
        let docsDir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        let updateDir = docsDir.appendingPathComponent(updateDirName)
        let indexFile = updateDir.appendingPathComponent("index.html")
        if FileManager.default.fileExists(atPath: indexFile.path) {
            return updateDir.path
        }
        return nil
    }

    /// Deletes a previously downloaded update.
    static func clearUpdate() {
        let docsDir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        try? FileManager.default.removeItem(at: docsDir.appendingPathComponent(updateDirName))
        try? FileManager.default.removeItem(at: docsDir.appendingPathComponent(tempDirName))
    }

    // MARK: - Path validation

    private static func validatePath(_ target: URL, within baseDir: URL) throws {
        let canonical = target.standardizedFileURL.path
        let basePath = baseDir.standardizedFileURL.path
        guard canonical.hasPrefix(basePath) else {
            throw OTAError.downloadFailed("Path traversal detected: \(canonical)")
        }
    }

    // MARK: - Asset discovery

    static func parseAssetPathsFromHtml(_ html: String) -> Set<String> {
        var paths = Set<String>()
        let pattern = try? NSRegularExpression(
            pattern: #"(?:src|href)=["'](/[^"']+\.(?:js|css|woff2?|ttf|png|svg|jpg|jpeg|webp|ico|json))["']"#,
            options: .caseInsensitive
        )
        let range = NSRange(html.startIndex..<html.endIndex, in: html)
        pattern?.enumerateMatches(in: html, range: range) { match, _, _ in
            if let matchRange = match?.range(at: 1), let swiftRange = Range(matchRange, in: html) {
                paths.insert(String(html[swiftRange]))
            }
        }
        return paths
    }

    static func parseViteManifest(_ json: String) -> Set<String> {
        var paths = Set<String>()
        guard let data = json.data(using: .utf8),
              let manifest = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return paths
        }
        for (_, value) in manifest {
            guard let entry = value as? [String: Any] else { continue }
            if let file = entry["file"] as? String, !file.isEmpty {
                paths.insert("/" + file)
            }
            if let cssFiles = entry["css"] as? [String] {
                for css in cssFiles { paths.insert("/" + css) }
            }
            if let assets = entry["assets"] as? [String] {
                for asset in assets { paths.insert("/" + asset) }
            }
        }
        return paths
    }

    // MARK: - I/O helpers

    /// Downloads data with a size limit appropriate for manifests, HTML, and CSS.
    private static func downloadData(from urlString: String) async throws -> Data {
        guard let url = URL(string: urlString) else {
            throw OTAError.invalidURL
        }

        var request = URLRequest(url: url, timeoutInterval: connectTimeoutSecs)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")

        let (data, response) = try await URLSession.shared.data(for: request)

        if let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode != 200 {
            throw OTAError.httpError(httpResponse.statusCode, urlString)
        }

        if data.count > maxStringDownloadBytes {
            throw OTAError.downloadFailed("Response exceeds \(maxStringDownloadBytes) bytes for \(urlString)")
        }

        return data
    }

    /// Downloads a file with the larger size limit for binary assets (JS bundles, WASM, images).
    private static func downloadToFile(from urlString: String, to target: URL) async throws {
        guard let url = URL(string: urlString) else {
            throw OTAError.invalidURL
        }

        var request = URLRequest(url: url, timeoutInterval: connectTimeoutSecs)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")

        let (data, response) = try await URLSession.shared.data(for: request)

        if let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode != 200 {
            throw OTAError.httpError(httpResponse.statusCode, urlString)
        }

        if data.count > maxFileDownloadBytes {
            throw OTAError.downloadFailed("File exceeds \(maxFileDownloadBytes) bytes for \(urlString)")
        }

        try data.write(to: target)
    }
}
