import SwiftUI
import StructuredCore

@main
struct StructuredWidgetApp: App {
    var body: some Scene {
        WindowGroup {
            SettingsView()
                .preferredColorScheme(.dark)
        }
    }
}
