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
            print("[OTA] Applying previously downloaded OTA update from: \(updatePath)")
            vc.setServerBasePath(path: updatePath)
        } else {
            print("[OTA] OTA preference is true but no downloaded update found — resetting")
            defaults.set("false", forKey: prefsPrefix + prefUseRemote)
        }
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
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Check for pending share data when app becomes active
        if pendingShareDispatch {
            pendingShareDispatch = false
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                self?.dispatchShareDataToJS()
            }
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
            let eventDetail = mode != nil ? "{\"mode\":\"\(mode!)\"}" : "{}"
            dispatchWidgetEvent(eventDetail)
            return true
        }

        // Default Capacitor URL handling (deep links, OAuth)
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    private func dispatchWidgetEvent(_ eventDetail: String) {
        guard let bridge = bridgeViewController?.bridge else {
            // Queue for later dispatch
            pendingWidgetEvent = eventDetail
            return
        }

        let base64 = Data(eventDetail.utf8).base64EncodedString()
        let js = "window.dispatchEvent(new CustomEvent('onWidgetQuickNote', { detail: JSON.parse(atob('\(base64)')) }));"
        bridge.webView?.evaluateJavaScript(js) { _, error in
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

    private func dispatchShareDataToJS() {
        guard let userDefaults = UserDefaults(suiteName: appGroupId),
              let jsonString = userDefaults.string(forKey: shareKey) else {
            print("[Share] No share data found in app group")
            return
        }

        // Clear the share data immediately to prevent re-processing
        userDefaults.removeObject(forKey: shareKey)

        print("[Share] Dispatching share data to JS: \(jsonString.prefix(100))...")

        // Dispatch to WebView via Capacitor bridge
        guard let bridge = bridgeViewController?.bridge else {
            print("[Share] Bridge not available")
            return
        }

        // Encode as Base64 to avoid JS string injection issues with user-controlled content
        guard let jsonData = jsonString.data(using: .utf8) else {
            print("[Share] Failed to encode share data")
            return
        }
        let base64 = jsonData.base64EncodedString()

        let js = "window.dispatchEvent(new CustomEvent('onShareReceived', { detail: JSON.parse(atob('\(base64)')) }));"
        bridge.webView?.evaluateJavaScript(js) { _, error in
            if let error = error {
                print("[Share] JS dispatch error: \(error)")
            } else {
                print("[Share] Share data dispatched to JS successfully")
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
        default:
            print("[IOSBridge] Unknown action: \(action)")
        }
    }
}
