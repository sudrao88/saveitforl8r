import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    // Remote URL for OTA live updates
    private let remoteUrl = "https://saveitforl8r.com"

    // Capacitor Preferences key prefix (matches Android CapacitorStorage)
    private let prefsPrefix = "CapacitorStorage."

    // Preference keys (must match useNativeOTA.ts)
    private let prefUseRemote = "ota_use_remote"
    private let prefServerUrl = "ota_server_url"

    // App Group for Share Extension
    private let appGroupId = "group.com.saveitforl8r.app"
    private let shareKey = "ShareExtensionData"

    // Flag to dispatch share data once WebView is ready
    private var pendingShareDispatch = false

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Configure server URL for OTA updates
        configureServerUrl()
        return true
    }

    /**
     * Configures the WebView to load from either bundled assets or remote URL.
     * Reads the OTA preference set by the React app via Capacitor Preferences.
     */
    private func configureServerUrl() {
        let defaults = UserDefaults.standard

        // Capacitor Preferences stores values with a prefix
        let useRemote = defaults.string(forKey: prefsPrefix + prefUseRemote) ?? "false"

        if useRemote == "true" {
            let serverUrl = defaults.string(forKey: prefsPrefix + prefServerUrl) ?? remoteUrl

            // Validate the URL starts with the expected production domain.
            // An attacker who gains XSS could modify UserDefaults to point to a
            // malicious server, so we enforce an allowlist here.
            if serverUrl == remoteUrl || serverUrl.hasPrefix(remoteUrl + "/") {
                defaults.set(serverUrl, forKey: "serverUrl")
                print("[OTA] Loading from remote URL: \(serverUrl)")
            } else {
                print("[OTA] Blocked invalid OTA server URL: \(serverUrl)")
                // Fall back to default remote URL
                defaults.set(remoteUrl, forKey: "serverUrl")
            }
        } else {
            // Remove any previously set server URL to use bundled assets
            defaults.removeObject(forKey: "serverUrl")
            print("[OTA] Loading from bundled assets")
        }
    }

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
    }

    func applicationWillTerminate(_ application: UIApplication) {
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Handle share extension URL scheme
        if url.scheme == "com.saveitforl8r.app" && url.host == "share" {
            print("[Share] Received share URL, will dispatch to JS")
            pendingShareDispatch = true
            // Dispatch after a short delay to ensure WebView is ready
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
                self?.dispatchShareDataToJS()
            }
            return true
        }

        // Default Capacitor URL handling (deep links, OAuth)
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
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
        userDefaults.synchronize()

        print("[Share] Dispatching share data to JS: \(jsonString.prefix(100))...")

        // Dispatch to WebView via Capacitor bridge
        guard let bridge = (window?.rootViewController as? CAPBridgeViewController)?.bridge else {
            print("[Share] Bridge not available")
            return
        }

        // Sanitize the JSON string for safe JS injection
        let escaped = jsonString
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
            .replacingOccurrences(of: "\n", with: "\\n")
            .replacingOccurrences(of: "\r", with: "\\r")

        let js = "window.dispatchEvent(new CustomEvent('onShareReceived', { detail: JSON.parse('\(escaped)') }));"
        bridge.webView?.evaluateJavaScript(js) { _, error in
            if let error = error {
                print("[Share] JS dispatch error: \(error)")
            } else {
                print("[Share] Share data dispatched to JS successfully")
            }
        }
    }
}
