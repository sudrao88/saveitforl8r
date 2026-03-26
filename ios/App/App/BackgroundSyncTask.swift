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

    /// Pending task completion handler, called from JS when sync finishes.
    private static var pendingCompletion: ((Bool) -> Void)?
    private static let completionLock = NSLock()

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

    /// Called from the JavaScript layer (via Capacitor bridge) when background
    /// sync work is complete. This signals the pending BGTask to finish.
    static func syncCompleted(success: Bool) {
        completeOnce(success: success, reason: "JS signaled")
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

    // MARK: - Private Helpers

    /// Atomically invoke the pending completion handler exactly once.
    /// Subsequent calls are no-ops, preventing double calls to
    /// task.setTaskCompleted() which would crash.
    private static func completeOnce(success: Bool, reason: String) {
        completionLock.lock()
        let completion = pendingCompletion
        pendingCompletion = nil
        completionLock.unlock()

        if let completion = completion {
            completion(success)
            print("[BackgroundSync] Completed via \(reason) (success: \(success))")
        }
    }

    // MARK: - Task Handlers

    private static func handleRefreshTask(_ task: BGAppRefreshTask) {
        print("[BackgroundSync] Refresh task started")

        // Schedule the next refresh before doing work
        scheduleRefresh()

        // Set expiration handler — uses completeOnce so it's safe
        // even if the sync completion fires at the same time
        task.expirationHandler = {
            print("[BackgroundSync] Refresh task expired")
            completeOnce(success: false, reason: "expiration")
        }

        // Perform the sync work
        performSyncWork { success in
            task.setTaskCompleted(success: success)
        }
    }

    private static func handleProcessingTask(_ task: BGProcessingTask) {
        print("[BackgroundSync] Processing task started")

        task.expirationHandler = {
            print("[BackgroundSync] Processing task expired")
            completeOnce(success: false, reason: "expiration")
        }

        // Processing tasks get more time — can do heavier sync
        performSyncWork { success in
            task.setTaskCompleted(success: success)
        }
    }

    private static func performSyncWork(completion: @escaping (Bool) -> Void) {
        // Store completion handler — completeOnce guarantees it's called at most once
        completionLock.lock()
        pendingCompletion = completion
        completionLock.unlock()

        // Post a notification that the bridge can observe
        // This allows the Capacitor web layer to handle the actual sync
        DispatchQueue.main.async {
            NotificationCenter.default.post(
                name: NSNotification.Name("BackgroundSyncRequested"),
                object: nil
            )
        }

        // Safety timeout: if JS doesn't respond within 25 seconds,
        // complete the task to avoid being killed by the system.
        // BGAppRefreshTask has ~30s budget; we leave 5s margin.
        DispatchQueue.global().asyncAfter(deadline: .now() + 25) {
            completeOnce(success: false, reason: "timeout (25s)")
        }
    }
}
