import WidgetKit
import SwiftUI
import StructuredCore

@main
struct StructuredWidgetBundle: WidgetBundle {
    var body: some Widget {
        CombinedWidget()
    }
}

struct CombinedWidget: Widget {
    let kind = "CombinedWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: CombinedProvider()) { entry in
            CombinedWidgetView(entry: entry)
                .containerBackground(for: .widget) {
                    Color(red: 13 / 255, green: 13 / 255, blue: 13 / 255).opacity(0.92)
                }
        }
        .configurationDisplayName(WidgetStrings.widgetName)
        .description("Today's tasks, inbox, and the week ahead")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .systemExtraLarge])
    }
}

struct CombinedEntry: TimelineEntry {
    var date: Date
    var todayState: TodayState
    var weekState: WeekState
    var displayState: WidgetDisplayState
    var logicalDate: DayDate
    var use24h: Bool
}

struct CombinedProvider: TimelineProvider {
    func placeholder(in context: Context) -> CombinedEntry {
        demoEntry(date: Date())
    }

    func getSnapshot(in context: Context, completion: @escaping (CombinedEntry) -> Void) {
        completion(loadEntry(date: Date()) ?? demoEntry(date: Date()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<CombinedEntry>) -> Void) {
        Task {
            _ = await WidgetSync.refresh(manual: false)
            let now = Date()
            let entry = loadEntry(date: now) ?? demoEntry(date: now)
            let next = now.addingTimeInterval(15 * 60)
            completion(Timeline(entries: [entry], policy: .after(next)))
        }
    }

    private func loadEntry(date: Date) -> CombinedEntry? {
        let cache = SharedWidgetStore().loadCache()
        guard let stored = cache.get() else { return nil }
        return CombinedEntry(
            date: date,
            todayState: stored.todayState,
            weekState: stored.weekState,
            displayState: stored.displayState,
            logicalDate: stored.logicalDate ?? stored.todayState.logicalDate ?? DayDate.today(),
            use24h: Locale.current.uses24HourClock
        )
    }

    private func demoEntry(date: Date) -> CombinedEntry {
        let today = DayDate.today()
        let snapshot = SampleData.demoSnapshot(today: today, timezone: TimeZone.current.identifier)
        let todayState = TodayRepository().fromSnapshot(snapshot)
        let weekState = WeekRepository().fromSnapshot(snapshot)
        return CombinedEntry(
            date: date,
            todayState: todayState,
            weekState: weekState,
            displayState: .demo,
            logicalDate: today,
            use24h: Locale.current.uses24HourClock
        )
    }
}

private extension Locale {
    var uses24HourClock: Bool {
        let format = DateFormatter.dateFormat(fromTemplate: "j", options: 0, locale: self) ?? ""
        return !format.contains("a")
    }
}
