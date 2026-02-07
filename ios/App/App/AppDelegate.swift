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
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
