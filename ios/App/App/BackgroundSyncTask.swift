import Foundation
import BackgroundTasks
import UIKit

/// Handles background sync operations for SaveItForL8R.
/// Registers and manages BGAppRefreshTask for periodic sync (~12 hours)
/// and BGProcessingTask for heavy sync during charging.
/// All operations are silent — no user-facing notifications.
class BackgroundSyncTask {
    static let refreshTaskIdentifier = "com.saveitforl8r.app.refresh"
    static let processingTaskIdentifier = "com.saveitforl8r.app.processing"

    /// Register background task identifiers.
    /// Must be called in application(_:didFinishLaunchingWithOptions:) BEFORE
    /// the end of the launch sequence.
    static func register() {
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: refreshTaskIdentifier,
            using: nil
        ) { task in
            handleRefreshTask(task as! BGAppRefreshTask)
        }

        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: processingTaskIdentifier,
            using: nil
        ) { task in
            handleProcessingTask(task as! BGProcessingTask)
        }

        print("[BackgroundSync] Task identifiers registered")
    }

    /// Schedule the next refresh task.
    /// Called after each task completion and when app enters background.
    static func scheduleRefresh() {
        let request = BGAppRefreshTaskRequest(identifier: refreshTaskIdentifier)
        // Target ~12 hours from now (iOS decides actual timing)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 12 * 60 * 60)

        do {
            try BGTaskScheduler.shared.submit(request)
            print("[BackgroundSync] Refresh task scheduled")
        } catch {
            print("[BackgroundSync] Failed to schedule refresh: \(error)")
        }
    }

    /// Schedule a processing task for heavy sync (during charging + Wi-Fi).
    static func scheduleProcessing() {
        let request = BGProcessingTaskRequest(identifier: processingTaskIdentifier)
        request.requiresNetworkConnectivity = true
        request.requiresExternalPower = true
        request.earliestBeginDate = Date(timeIntervalSinceNow: 12 * 60 * 60)

        do {
            try BGTaskScheduler.shared.submit(request)
            print("[BackgroundSync] Processing task scheduled")
        } catch {
            print("[BackgroundSync] Failed to schedule processing: \(error)")
        }
    }

    // MARK: - Task Handlers

    private static func handleRefreshTask(_ task: BGAppRefreshTask) {
        print("[BackgroundSync] Refresh task started")

        // Schedule the next refresh before doing work
        scheduleRefresh()

        // Set expiration handler
        task.expirationHandler = {
            print("[BackgroundSync] Refresh task expired")
            task.setTaskCompleted(success: false)
        }

        // Perform the sync work
        // We send a notification to the Capacitor bridge to trigger sync
        // via the WebView if it's loaded, or log for future implementation
        performSyncWork { success in
            task.setTaskCompleted(success: success)
            print("[BackgroundSync] Refresh task completed (success: \(success))")
        }
    }

    private static func handleProcessingTask(_ task: BGProcessingTask) {
        print("[BackgroundSync] Processing task started")

        task.expirationHandler = {
            print("[BackgroundSync] Processing task expired")
            task.setTaskCompleted(success: false)
        }

        // Processing tasks get more time — can do heavier sync
        performSyncWork { success in
            task.setTaskCompleted(success: success)
            print("[BackgroundSync] Processing task completed (success: \(success))")
        }
    }

    private static func performSyncWork(completion: @escaping (Bool) -> Void) {
        // Post a notification that the bridge can observe
        // This allows the Capacitor web layer to handle the actual sync
        DispatchQueue.main.async {
            NotificationCenter.default.post(
                name: NSNotification.Name("BackgroundSyncRequested"),
                object: nil
            )
        }

        // Give the WebView time to process (up to 25 seconds for refresh tasks)
        DispatchQueue.global().asyncAfter(deadline: .now() + 25) {
            completion(true)
        }
    }
}
