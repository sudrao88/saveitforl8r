import UIKit
import Capacitor
import WebKit

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    // Remote URL for OTA live updates
    private let remoteUrl = "https://saveitforl8r.com"

    // Capacitor Preferences key prefix (matches Android CapacitorStorage)
    private let prefsPrefix = "CapacitorStorage."

    // Preference keys (must match useNativeOTA.ts)
    private let prefUseRemote = "ota_use_remote"

    // App Group for Share Extension
    private let appGroupId = "group.com.saveitforl8r.app"
    private let shareKey = "ShareExtensionData"

    // Flag to dispatch share data once WebView is ready
    private var pendingShareDispatch = false

    // Whether bridge setup (IOSBridge + OTA) is complete
    private var bridgeSetUp = false

    // Retry counter for bridge setup
    private var bridgeSetupRetries = 0
    private let maxBridgeSetupRetries = 30  // 30 * 0.3s = 9 seconds max

    // Convenience accessor for the Capacitor bridge view controller
    private var bridgeViewController: CAPBridgeViewController? {
        window?.rootViewController as? CAPBridgeViewController
    }

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Register background task identifiers before launch sequence ends
        BackgroundSyncTask.register()

        // Wait for the Capacitor bridge to initialize, then set up OTA + IOSBridge.
        // Both require the bridge to be ready, so we use a single retry loop.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
            self?.setupBridge()
        }
        return true
    }

    // MARK: - Bridge Setup (OTA + IOSBridge)

    /// Waits for the Capacitor bridge to be ready, then:
    /// 1. Applies any previously downloaded OTA update via setServerBasePath
    /// 2. Registers the IOSBridge WKScriptMessageHandler for JS → native calls
    private func setupBridge() {
        guard !bridgeSetUp else { return }

        guard let vc = bridgeViewController,
              let bridge = vc.bridge,
              let webView = bridge.webView else {
            bridgeSetupRetries += 1
            if bridgeSetupRetries >= maxBridgeSetupRetries {
                print("[OTA] Bridge setup timed out after \(bridgeSetupRetries) retries")
                return
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
                self?.setupBridge()
            }
            return
        }

        // Register IOSBridge message handler (mirrors Android's AndroidBridge)
        webView.configuration.userContentController.add(
            IOSBridgeHandler(appDelegate: self),
            name: "IOSBridge"
        )
        bridgeSetUp = true
        print("[OTA] IOSBridge registered")

        // Apply downloaded OTA update if available
        applyDownloadedUpdateIfExists(vc: vc)

        // If share data arrived before the bridge was ready, dispatch it now
        if pendingShareDispatch {
            pendingShareDispatch = false
            dispatchShareDataToJS()
        }
    }

    // MARK: - OTA Update Management

    /// If an OTA update was previously downloaded, tell Capacitor's local server
    /// to serve files from the download directory instead of the bundled assets.
    /// Uses setServerBasePath which keeps the capacitor://localhost origin —
    /// preserving IndexedDB, localStorage, and Capacitor plugins.
    private func applyDownloadedUpdateIfExists(vc: CAPBridgeViewController) {
        let defaults = UserDefaults.standard
        let useRemote = defaults.string(forKey: prefsPrefix + prefUseRemote) ?? "false"

        guard useRemote == "true" else {
            print("[OTA] Using bundled assets (OTA not active)")
            return
        }

        if let updatePath = OTADownloadManager.getExistingUpdatePath() {
            // Compare OTA version against bundled version. If the APK/IPA was updated
            // with newer assets, discard the stale OTA download and use bundled.
            let otaBuild = readBuildNumber(from: URL(fileURLWithPath: updatePath).appendingPathComponent("version.json"))
            let bundledBuild = readBundledBuildNumber()

            if otaBuild == -1 || bundledBuild > otaBuild {
                print("[OTA] Bundled assets (build \(bundledBuild)) are newer than OTA (build \(otaBuild)) — discarding OTA")
                defaults.set("false", forKey: prefsPrefix + prefUseRemote)
                OTADownloadManager.clearUpdate()
                return
            }

            print("[OTA] Applying previously downloaded OTA update from: \(updatePath) (OTA build \(otaBuild), bundled build \(bundledBuild))")
            vc.setServerBasePath(path: updatePath)
        } else {
            print("[OTA] OTA preference is true but no downloaded update found — resetting")
            defaults.set("false", forKey: prefsPrefix + prefUseRemote)
        }
    }

    /// Reads the buildNumber from a version.json file. Returns -1 on failure.
    private func readBuildNumber(from url: URL) -> Int {
        guard let data = try? Data(contentsOf: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let buildNumber = json["buildNumber"] as? Int else {
            print("[OTA] Failed to read buildNumber from \(url.path)")
            return -1
        }
        return buildNumber
    }

    /// Reads the buildNumber from the bundled public/version.json.
    /// Returns -1 on failure (preserving OTA assets in that case).
    private func readBundledBuildNumber() -> Int {
        guard let url = Bundle.main.url(forResource: "version", withExtension: "json", subdirectory: "public") else {
            print("[OTA] Bundled public/version.json not found")
            return -1
        }
        return readBuildNumber(from: url)
    }

    /// Called by IOSBridge when JS requests an OTA update download.
    func handleEnableRemoteMode() {
        print("[OTA] Starting OTA download from: \(remoteUrl)")

        OTADownloadManager.downloadUpdate(remoteUrl: remoteUrl) { [weak self] result in
            guard let self = self else { return }

            switch result {
            case .success(let updatePath):
                print("[OTA] Download complete, applying update from: \(updatePath)")

                let defaults = UserDefaults.standard
                defaults.set("true", forKey: self.prefsPrefix + self.prefUseRemote)

                guard let vc = self.bridgeViewController else {
                    print("[OTA] Bridge view controller not available for setServerBasePath")
                    return
                }
                vc.setServerBasePath(path: updatePath)

            case .failure(let error):
                print("[OTA] Download failed: \(error.localizedDescription)")
                guard let bridge = self.bridgeViewController?.bridge,
                      let errorData = error.localizedDescription.data(using: .utf8) else { return }

                let base64Error = errorData.base64EncodedString()
                let js = "window.dispatchEvent(new CustomEvent('ota-error', { detail: atob('\(base64Error)') }));"
                bridge.webView?.evaluateJavaScript(js, completionHandler: nil)
            }
        }
    }

    /// Opens the app's notification settings so the user can re-enable
    /// notifications after previously denying permission.
    func handleOpenNotificationSettings() {
        print("[Notifications] Opening app notification settings")
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
    }

    /// Called by IOSBridge when JS requests switching back to bundled assets.
    func handleDisableRemoteMode() {
        print("[OTA] Disabling remote mode")

        let defaults = UserDefaults.standard
        defaults.set("false", forKey: prefsPrefix + prefUseRemote)

        // Delete downloaded assets
        OTADownloadManager.clearUpdate()

        // Remove any legacy serverUrl
        defaults.removeObject(forKey: "serverUrl")

        // Reload with bundled assets
        bridgeViewController?.setServerBasePath(path: "")
    }

    // MARK: - Lifecycle

    func applicationWillResignActive(_ application: UIApplication) {
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        BackgroundSyncTask.scheduleRefresh()
        BackgroundSyncTask.scheduleProcessing()
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Check for pending share data when app becomes active.
        // If the bridge is already set up, dispatch immediately.
        // If not, leave the flag so setupBridge() dispatches after bridge init.
        if pendingShareDispatch && bridgeSetUp {
            pendingShareDispatch = false
            dispatchShareDataToJS()
        }

        // Check for pending widget event
        if let widgetEvent = pendingWidgetEvent {
            pendingWidgetEvent = nil
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                self?.dispatchWidgetEvent(widgetEvent)
            }
        }
    }

    func applicationWillTerminate(_ application: UIApplication) {
    }

    // MARK: - URL Handling

    // Pending widget event detail to dispatch when JS is ready
    private var pendingWidgetEvent: String? = nil

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Handle widget "open app" — just bring the app to foreground
        if url.scheme == "com.saveitforl8r.app" && url.host == "open" {
            return true
        }

        // Handle widget "search" — open chat interface
        if url.scheme == "com.saveitforl8r.app" && url.host == "search" {
            print("[Widget] Received search deep link")
            let js = "window.dispatchEvent(new CustomEvent('onWidgetSearch'));"
            if let webView = bridgeViewController?.bridge?.webView {
                webView.evaluateJavaScript(js, completionHandler: nil)
            } else {
                pendingWidgetEvent = "__search__"
            }
            return true
        }

        // Handle share extension URL scheme
        if url.scheme == "com.saveitforl8r.app" && url.host == "share" {
            print("[Share] Received share URL, will dispatch to JS")
            pendingShareDispatch = true
            return true
        }

        // Handle widget deep link
        if url.scheme == "com.saveitforl8r.app" && url.host == "quick-note" {
            print("[Widget] Received quick-note deep link")
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
            let mode = components?.queryItems?.first(where: { $0.name == "mode" })?.value
            var dict: [String: String] = [:]
            if let mode = mode { dict["mode"] = mode }
            let eventDetail: String
            if let data = try? JSONSerialization.data(withJSONObject: dict),
               let str = String(data: data, encoding: .utf8) {
                eventDetail = str
            } else {
                eventDetail = "{}"
            }
            dispatchWidgetEvent(eventDetail)
            return true
        }

        // Default Capacitor URL handling (deep links, OAuth)
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    private func dispatchWidgetEvent(_ eventDetail: String) {
        guard let bridge = bridgeViewController?.bridge,
              let webView = bridge.webView else {
            // Queue for later dispatch
            pendingWidgetEvent = eventDetail
            return
        }

        // Special case: search deep link
        if eventDetail == "__search__" {
            // Use the same handshake pattern as share data: store on window
            // so the JS hook can pick it up if it hasn't mounted yet.
            let js = """
            (function() {
                window.dispatchEvent(new CustomEvent('onWidgetSearch'));
                window.__pendingWidgetSearch = true;
            })();
            """
            webView.evaluateJavaScript(js, completionHandler: nil)
            return
        }

        let base64 = Data(eventDetail.utf8).base64EncodedString()
        // Store on window AND dispatch event. If the JS listener is mounted,
        // the event fires. If not, the hook picks up __pendingWidgetEvent on mount.
        let js = """
        (function() {
            var data = JSON.parse(atob('\(base64)'));
            window.__pendingWidgetEvent = data;
            window.dispatchEvent(new CustomEvent('onWidgetQuickNote', { detail: data }));
        })();
        """
        webView.evaluateJavaScript(js) { _, error in
            if let error = error {
                print("[Widget] JS dispatch error: \(error)")
            } else {
                print("[Widget] Quick note event dispatched to JS")
            }
        }
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    // MARK: - Share Extension Data Dispatch

    // Retry counter for share dispatch (JS listener may not be registered yet)
    private var shareDispatchRetries = 0
    private let maxShareDispatchRetries = 10  // 10 * 0.5s = 5 seconds max

    private func dispatchShareDataToJS() {
        guard let userDefaults = UserDefaults(suiteName: appGroupId),
              let jsonString = userDefaults.string(forKey: shareKey) else {
            print("[Share] No share data found in app group")
            return
        }

        print("[Share] Dispatching share data to JS: \(jsonString.prefix(100))...")

        // Dispatch to WebView via Capacitor bridge
        guard let bridge = bridgeViewController?.bridge,
              let webView = bridge.webView else {
            print("[Share] Bridge not available, will retry after bridge setup")
            pendingShareDispatch = true
            return
        }

        // Pre-process attachments: read files and convert to base64 data URLs
        // on the native side so JS doesn't need to fetch file paths that may
        // be cleaned up by iOS before JS can access them (cold-start race condition).
        guard let jsonData = jsonString.data(using: .utf8),
              var shareDict = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any] else {
            print("[Share] Failed to parse share data")
            return
        }

        if let attachments = shareDict["attachments"] as? [[String: String]] {
            var enriched: [[String: String]] = []
            for att in attachments {
                var enrichedAtt = att
                if let path = att["path"], let mimeType = att["mimeType"] {
                    let fileURL = URL(fileURLWithPath: path)
                    if let fileData = try? Data(contentsOf: fileURL) {
                        let dataUrl = "data:\(mimeType);base64,\(fileData.base64EncodedString())"
                        enrichedAtt["dataUrl"] = dataUrl
                        print("[Share] Pre-encoded attachment: \(att["name"] ?? "unknown") (\(fileData.count) bytes)")
                    } else {
                        print("[Share] Failed to read attachment file: \(path)")
                    }
                }
                enriched.append(enrichedAtt)
            }
            shareDict["attachments"] = enriched
        }

        guard let enrichedData = try? JSONSerialization.data(withJSONObject: shareDict),
              let enrichedJson = String(data: enrichedData, encoding: .utf8) else {
            print("[Share] Failed to re-encode share data")
            return
        }

        let base64 = Data(enrichedJson.utf8).base64EncodedString()

        // Use a JS function that checks whether the listener is ready.
        // If window.__shareReceiverReady is set, dispatch immediately.
        // Otherwise, store on window for the listener to pick up on mount.
        let js = """
        (function() {
            var data = JSON.parse(atob('\(base64)'));
            if (window.__shareReceiverReady) {
                window.dispatchEvent(new CustomEvent('onShareReceived', { detail: data }));
                return 'dispatched';
            } else {
                window.__pendingShareData = data;
                return 'queued';
            }
        })();
        """
        webView.evaluateJavaScript(js) { [weak self] result, error in
            guard let self = self else { return }
            if let error = error {
                print("[Share] JS dispatch error: \(error)")
                // Retry if WebView isn't ready yet (e.g., page still loading)
                if self.shareDispatchRetries < self.maxShareDispatchRetries {
                    self.shareDispatchRetries += 1
                    print("[Share] Retrying dispatch (\(self.shareDispatchRetries)/\(self.maxShareDispatchRetries))...")
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                        self.dispatchShareDataToJS()
                    }
                }
                return
            }

            let status = result as? String ?? "unknown"
            print("[Share] Share data \(status) successfully")
            self.shareDispatchRetries = 0

            // Clear share data from UserDefaults only after successful dispatch/queue
            if let userDefaults = UserDefaults(suiteName: self.appGroupId) {
                userDefaults.removeObject(forKey: self.shareKey)
            }
        }
    }
}

// MARK: - IOSBridge WKScriptMessageHandler

/// Handles messages from JS via window.webkit.messageHandlers.IOSBridge.postMessage()
/// Mirrors Android's AndroidBridge JavascriptInterface.
class IOSBridgeHandler: NSObject, WKScriptMessageHandler {
    private weak var appDelegate: AppDelegate?

    init(appDelegate: AppDelegate) {
        self.appDelegate = appDelegate
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let action = body["action"] as? String else {
            print("[IOSBridge] Invalid message format")
            return
        }

        switch action {
        case "enableRemoteMode":
            appDelegate?.handleEnableRemoteMode()
        case "disableRemoteMode":
            appDelegate?.handleDisableRemoteMode()
        case "openNotificationSettings":
            appDelegate?.handleOpenNotificationSettings()
        case "syncCompleted":
            let success = (body["success"] as? Bool) ?? false
            BackgroundSyncTask.syncCompleted(success: success)
        default:
            print("[IOSBridge] Unknown action: \(action)")
        }
    }
}
