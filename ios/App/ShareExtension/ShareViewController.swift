import UIKit
import Social
import MobileCoreServices
import UniformTypeIdentifiers

class ShareViewController: SLComposeServiceViewController {

    private let appGroupId = "group.com.saveitforl8r.app"
    private let shareKey = "ShareExtensionData"

    override func isContentValid() -> Bool {
        return true
    }

    override func didSelectPost() {
        handleShare { [weak self] in
            self?.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
        }
    }

    override func configurationItems() -> [Any]! {
        return []
    }

    private func handleShare(completion: @escaping () -> Void) {
        guard let extensionItems = extensionContext?.inputItems as? [NSExtensionItem] else {
            completion()
            return
        }

        let serialQueue = DispatchQueue(label: "com.saveitforl8r.share.serial")
        var shareText = contentText ?? ""
        var attachments: [[String: String]] = []
        let group = DispatchGroup()

        for item in extensionItems {
            guard let providers = item.attachments else { continue }

            for provider in providers {
                // Handle images
                if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
                    group.enter()
                    provider.loadItem(forTypeIdentifier: UTType.image.identifier, options: nil) { [weak self] data, error in
                        defer { group.leave() }
                        guard error == nil else { return }

                        if let url = data as? URL,
                           let fileData = try? Data(contentsOf: url) {
                            let mimeType = self?.mimeTypeForURL(url) ?? "image/jpeg"
                            serialQueue.sync {
                                self?.saveAttachment(data: fileData, name: url.lastPathComponent, mimeType: mimeType, attachments: &attachments)
                            }
                        } else if let image = data as? UIImage,
                                  let imageData = image.jpegData(compressionQuality: 0.8) {
                            serialQueue.sync {
                                self?.saveAttachment(data: imageData, name: "shared_image.jpg", mimeType: "image/jpeg", attachments: &attachments)
                            }
                        }
                    }
                }
                // Handle PDFs
                else if provider.hasItemConformingToTypeIdentifier(UTType.pdf.identifier) {
                    group.enter()
                    provider.loadItem(forTypeIdentifier: UTType.pdf.identifier, options: nil) { [weak self] data, error in
                        defer { group.leave() }
                        guard error == nil, let url = data as? URL,
                              let fileData = try? Data(contentsOf: url) else { return }
                        serialQueue.sync {
                            self?.saveAttachment(data: fileData, name: url.lastPathComponent, mimeType: "application/pdf", attachments: &attachments)
                        }
                    }
                }
                // Handle URLs
                else if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                    group.enter()
                    provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { data, error in
                        defer { group.leave() }
                        if let url = data as? URL {
                            serialQueue.sync {
                                if !shareText.isEmpty { shareText += "\n" }
                                shareText += url.absoluteString
                            }
                        }
                    }
                }
                // Handle plain text
                else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                    group.enter()
                    provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { data, error in
                        defer { group.leave() }
                        if let text = data as? String {
                            serialQueue.sync {
                                if !shareText.isEmpty { shareText += "\n" }
                                shareText += text
                            }
                        }
                    }
                }
            }
        }

        group.notify(queue: .main) { [weak self] in
            self?.saveShareData(text: shareText, attachments: attachments)
            self?.openMainApp()
            completion()
        }
    }

    private func mimeTypeForURL(_ url: URL) -> String {
        let ext = url.pathExtension.lowercased()
        switch ext {
        case "png": return "image/png"
        case "gif": return "image/gif"
        case "webp": return "image/webp"
        case "heic", "heif": return "image/heic"
        case "bmp": return "image/bmp"
        case "tiff", "tif": return "image/tiff"
        case "svg": return "image/svg+xml"
        default: return "image/jpeg"
        }
    }

    private func saveAttachment(data: Data, name: String, mimeType: String, attachments: inout [[String: String]]) {
        guard let containerURL = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupId) else { return }

        let sharesDir = containerURL.appendingPathComponent("shares", isDirectory: true)
        try? FileManager.default.createDirectory(at: sharesDir, withIntermediateDirectories: true)

        let fileName = "\(Int(Date().timeIntervalSince1970 * 1000))_\(name)"
        let fileURL = sharesDir.appendingPathComponent(fileName)

        do {
            try data.write(to: fileURL)
            attachments.append([
                "name": name,
                "mimeType": mimeType,
                "path": fileURL.path
            ])
        } catch {
            print("[ShareExtension] Failed to save attachment: \(error)")
        }
    }

    private func saveShareData(text: String, attachments: [[String: String]]) {
        guard let userDefaults = UserDefaults(suiteName: appGroupId) else { return }

        let shareData: [String: Any] = [
            "text": text,
            "attachments": attachments,
            "timestamp": Date().timeIntervalSince1970
        ]

        if let jsonData = try? JSONSerialization.data(withJSONObject: shareData),
           let jsonString = String(data: jsonData, encoding: .utf8) {
            userDefaults.set(jsonString, forKey: shareKey)
            print("[ShareExtension] Saved share data: \(text.prefix(50))... with \(attachments.count) attachments")
        }
    }

    private func openMainApp() {
        let url = URL(string: "com.saveitforl8r.app://share")!
        // Try the modern UIApplication.open API via responder chain
        var responder: UIResponder? = self
        while responder != nil {
            if let application = responder as? UIApplication {
                application.open(url, options: [:], completionHandler: nil)
                return
            }
            responder = responder?.next
        }
        // Fallback: use openURL selector for environments where UIApplication
        // is not directly castable in the responder chain
        let selector = sel_registerName("openURL:")
        responder = self
        while let current = responder {
            if current.responds(to: selector) {
                current.perform(selector, with: url)
                return
            }
            responder = current.next
        }
    }
}
