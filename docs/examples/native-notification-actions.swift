// Example only: action registration and response decoding, not a runnable app.
// Type-check from the repository root:
// xcrun swiftc -swift-version 5 -typecheck docs/examples/native-notification-actions.swift
//
// Production must retain this delegate, install it early in app launch, request
// permission, provide an event loop, and implement authenticated IPC + receipts.
// enqueue must synchronously copy into a bounded, thread-safe queue. It must not
// block on the Host, log the text, or treat local enqueue as prompt acceptance.
// That queue must use the notification's persisted replyRequestId, never mint a
// new requestId for every repeated OS callback. See the implementation document.

import Foundation
import UserNotifications

struct NotificationActionEvent {
    enum Kind {
        case open
        case reply
        case dismiss
    }

    let kind: Kind
    let deploymentId: String
    let notificationId: String
    let text: String?
}

@available(macOS 10.14, *)
final class NotificationActionDelegate: NSObject, UNUserNotificationCenterDelegate {
    static let openCategoryId = "DSH_TURN_OPEN_V1"
    static let replyCategoryId = "DSH_TURN_REPLY_V1"
    static let openActionId = "DSH_OPEN"
    static let replyActionId = "DSH_REPLY"

    private let enqueue: (NotificationActionEvent) -> Void
    private let onProblem: (String) -> Void

    init(
        enqueue: @escaping (NotificationActionEvent) -> Void,
        onProblem: @escaping (String) -> Void
    ) {
        self.enqueue = enqueue
        self.onProblem = onProblem
        super.init()
    }

    // Keep a strong reference to this object in the app. The center's delegate
    // alone is not the application's lifetime manager. Localize these labels in
    // production; they are literal Chinese here solely to demonstrate the API.
    func install(on center: UNUserNotificationCenter) {
        center.delegate = self

        let open = UNNotificationAction(
            identifier: Self.openActionId,
            title: "打开会话",
            options: [.foreground]
        )
        let reply = UNTextInputNotificationAction(
            identifier: Self.replyActionId,
            title: "回复",
            options: [.authenticationRequired],
            textInputButtonTitle: "发送",
            textInputPlaceholder: "向此会话发送指令"
        )

        let openCategory = UNNotificationCategory(
            identifier: Self.openCategoryId,
            actions: [open],
            intentIdentifiers: [],
            options: [.customDismissAction]
        )
        let replyCategory = UNNotificationCategory(
            identifier: Self.replyCategoryId,
            actions: [reply, open],
            intentIdentifiers: [],
            options: [.customDismissAction]
        )
        center.setNotificationCategories([openCategory, replyCategory])
        // Choose content.categoryIdentifier from verified capabilities when
        // delivering a notification. Foreground launches this helper, not the
        // correct Harness window; the authenticated navigation bridge does that.
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        // Completing the OS callback does not acknowledge a Harness prompt.
        defer { completionHandler() }

        let metadata = response.notification.request.content.userInfo
        guard
            let version = metadata["protocolVersion"] as? Int,
            version == 1,
            let deploymentId = metadata["deploymentId"] as? String,
            UUID(uuidString: deploymentId) != nil,
            let notificationId = metadata["notificationId"] as? String,
            UUID(uuidString: notificationId) != nil,
            response.notification.request.identifier == notificationId
        else {
            onProblem("invalid-notification-metadata")
            return
        }

        let kind: NotificationActionEvent.Kind
        let text: String?
        switch response.actionIdentifier {
        case UNNotificationDefaultActionIdentifier, Self.openActionId:
            kind = .open
            text = nil
        case Self.replyActionId:
            guard let input = response as? UNTextInputNotificationResponse else {
                onProblem("invalid-reply-response")
                return
            }
            let originalText = input.userText
            guard !originalText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                onProblem("empty-reply")
                return
            }
            guard !originalText.contains("\0") else {
                onProblem("invalid-reply-text")
                return
            }
            guard originalText.utf8.count <= 16 * 1024 else {
                onProblem("reply-too-large")
                return
            }
            kind = .reply
            text = originalText
        case UNNotificationDismissActionIdentifier:
            kind = .dismiss
            text = nil
        default:
            onProblem("unsupported-action")
            return
        }

        // The Host must still resolve its own authoritative registry, verify
        // expiry/session identity/permissions, and serialize reply admission.
        // Never select a session solely from untrusted notification metadata.
        enqueue(NotificationActionEvent(
            kind: kind,
            deploymentId: deploymentId,
            notificationId: notificationId,
            text: text
        ))
    }
}
