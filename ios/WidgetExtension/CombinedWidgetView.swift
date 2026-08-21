import SwiftUI
import StructuredCore

struct CombinedWidgetView: View {
    var entry: CombinedEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            header
            VStack(alignment: .leading, spacing: 2) {
                ForEach(Array(visibleRows.enumerated()), id: \.offset) { _, row in
                    rowView(row)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }

    private var compact: Bool {
        family == .systemSmall || family == .systemMedium
    }

    private var maxRows: Int {
        switch family {
        case .systemSmall: return 4
        case .systemMedium: return 8
        case .systemLarge: return 16
        case .systemExtraLarge: return 24
        default: return 10
        }
    }

    private var visibleRows: [TaskListItem] {
        let factory = CombinedListFactory(
            use24h: entry.use24h,
            compact: compact,
            clock: { entry.logicalDate },
            now: { ClockTime.now() }
        )
        let rows = factory.toRowList(
            todayState: entry.todayState,
            weekState: entry.weekState,
            displayState: entry.displayState
        )
        return Array(rows.prefix(maxRows))
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(entry.logicalDate.formattedWeekdayMonthDay())
                    .font(.system(size: 10, weight: .medium))
                    .tracking(0.8)
                    .foregroundStyle(Color.white.opacity(0.95))
                Spacer()
                Text(headerMeta)
                    .font(.system(size: 12))
                    .foregroundStyle(Color.white.opacity(0.6))
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.55))
            }
            if family != .systemSmall {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.white.opacity(0.12))
                        Capsule()
                            .fill(Color.white.opacity(0.55))
                            .frame(width: geo.size.width * CGFloat(dayFraction))
                    }
                }
                .frame(height: 2)
            }
        }
    }

    private var headerMeta: String {
        let count = WidgetHeader.todayTaskCount(entry.todayState)
        let now = ClockTime.now()
        let nowLabel = TimeFormat.formatHour(now.hours, use24h: entry.use24h)
        if count > 0 {
            return "\(count) · NOW \(nowLabel)"
        }
        return "NOW \(nowLabel)"
    }

    private var dayFraction: Float {
        let now = ClockTime.now()
        return TimeFormat.hourOfDayFraction(hour: now.hour, minute: now.minute)
    }

    @ViewBuilder
    private func rowView(_ row: TaskListItem) -> some View {
        switch row {
        case .statusBanner(let message, let kind):
            banner(message, kind: kind)
        case .sectionLabel(let label):
            section(label)
        case .heroRow(let task, let accent, let countdown, let status, let progress, let timeRange):
            hero(task, accent: accent, countdown: countdown, status: status, progress: progress, timeRange: timeRange)
        case .taskRow(let task, let isPast, let isCurrent):
            taskRow(task, isPast: isPast, isCurrent: isCurrent)
        case .inboxRow(let task):
            inboxRow(task)
        case .dueRow(let task, let dayLabel, let timeLabel):
            dueRow(task, dayLabel: dayLabel, timeLabel: timeLabel)
        case .moreRow(let count):
            caption(WidgetStrings.weekMore(count), indent: true)
        case .emptyDay:
            caption(WidgetStrings.weekFree, indent: true)
        case .dayHeader(_, let label, _, let isYesterday):
            Text(label)
                .font(.system(size: 10, weight: .medium))
                .tracking(0.8)
                .foregroundStyle(Color.white.opacity(isYesterday ? 0.4 : 0.95))
                .padding(.top, 8)
        }
    }

    private func banner(_ message: String, kind: TaskListItem.BannerKind) -> some View {
        let symbol: String
        switch kind {
        case .empty: symbol = "sun.max.fill"
        case .error: symbol = "exclamationmark.triangle.fill"
        case .info: symbol = "clock"
        case .warning: symbol = "alarm.fill"
        }
        return HStack(spacing: 10) {
            Image(systemName: symbol)
                .font(.system(size: 14))
                .foregroundStyle(Color.white.opacity(0.7))
            Text(message)
                .font(.system(size: 12))
                .foregroundStyle(Color.white.opacity(0.6))
                .lineLimit(2)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .padding(.vertical, 2)
    }

    private func section(_ label: String) -> some View {
        HStack(spacing: 8) {
            Text(label)
                .font(.system(size: 10, weight: .medium))
                .tracking(0.8)
                .foregroundStyle(Color.white.opacity(0.6))
            Rectangle().fill(Color.white.opacity(0.08)).frame(height: 0.5)
        }
        .padding(.top, 8)
    }

    private func hero(
        _ task: StructuredTask,
        accent: String,
        countdown: String,
        status: String,
        progress: Float,
        timeRange: String
    ) -> some View {
        let color = WidgetTheme.parseColor(accent).color
        let badgeColor: Color = {
            switch status {
            case "NOW": return WidgetTheme.parseColor(WidgetTheme.successHex).color
            case "NEXT": return WidgetTheme.parseColor(WidgetTheme.warningHex).color
            default: return Color.white.opacity(0.4)
            }
        }()
        return VStack(alignment: .leading, spacing: 4) {
            HStack {
                Image(systemName: WidgetSymbol.systemName(for: task.symbol))
                    .foregroundStyle(color)
                    .font(.system(size: 14))
                Text(task.title)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.95))
                    .lineLimit(1)
                Spacer()
                Text(status)
                    .font(.system(size: 10, weight: .medium))
                    .tracking(0.6)
                    .foregroundStyle(badgeColor)
            }
            HStack {
                Text(timeRange)
                    .font(.system(size: 12))
                    .foregroundStyle(Color.white.opacity(0.6))
                    .lineLimit(1)
                Spacer()
                Text(countdown)
                    .font(.system(size: 12))
                    .foregroundStyle(Color.white.opacity(0.6))
            }
            if status == "NOW" || progress > 0 {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.white.opacity(0.12))
                        Capsule().fill(color).frame(width: geo.size.width * CGFloat(progress))
                    }
                }
                .frame(height: 3)
            }
        }
        .padding(10)
        .background(color.opacity(0.12), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .padding(.vertical, 2)
    }

    private func taskRow(_ task: StructuredTask, isPast: Bool, isCurrent: Bool) -> some View {
        let accent = WidgetTheme.parseColor(task.color).color
        let timeText: String = {
            if task.isAllDay { return "all day" }
            if let start = task.startTime { return TimeFormat.formatHour(start, use24h: entry.use24h) }
            return ""
        }()
        return HStack(spacing: 8) {
            Text(timeText)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Color.white.opacity(isPast ? 0.27 : 0.6))
                .frame(width: 44, alignment: .leading)
            Image(systemName: WidgetSymbol.systemName(for: task.symbol))
                .font(.system(size: 12))
                .foregroundStyle(isPast ? Color.white.opacity(0.4) : accent)
            Text(task.title)
                .font(.system(size: 13))
                .foregroundStyle(Color.white.opacity(isPast ? 0.4 : 0.95))
                .lineLimit(1)
            Spacer()
            if isCurrent {
                Text("NOW")
                    .font(.system(size: 9, weight: .medium))
                    .foregroundStyle(WidgetTheme.parseColor(WidgetTheme.successHex).color)
            }
        }
        .padding(.vertical, 2)
    }

    private func inboxRow(_ task: StructuredTask) -> some View {
        HStack(spacing: 8) {
            Color.clear.frame(width: 44, height: 1)
            Image(systemName: WidgetSymbol.systemName(for: task.symbol))
                .font(.system(size: 12))
                .foregroundStyle(WidgetTheme.parseColor(task.color).color)
            Text(task.title)
                .font(.system(size: 13))
                .foregroundStyle(Color.white.opacity(0.95))
                .lineLimit(1)
            Spacer()
        }
        .padding(.vertical, 2)
    }

    private func dueRow(_ task: StructuredTask, dayLabel: String, timeLabel: String?) -> some View {
        HStack(spacing: 8) {
            Text(dayLabel)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Color.white.opacity(0.4))
                .frame(width: 44, alignment: .leading)
            Image(systemName: WidgetSymbol.systemName(for: task.symbol))
                .font(.system(size: 12))
                .foregroundStyle(WidgetTheme.parseColor(task.color).color)
            Text(task.title)
                .font(.system(size: 13))
                .foregroundStyle(Color.white.opacity(0.95))
                .lineLimit(1)
            Spacer()
            if let timeLabel {
                Text(timeLabel)
                    .font(.system(size: 9, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.6))
            }
        }
        .padding(.vertical, 2)
    }

    private func caption(_ text: String, indent: Bool) -> some View {
        HStack {
            if indent { Color.clear.frame(width: 44, height: 1) }
            Text(text)
                .font(.system(size: 12))
                .foregroundStyle(Color.white.opacity(0.4))
            Spacer()
        }
        .padding(.vertical, 2)
    }
}

extension WidgetTheme.RGBA {
    var color: Color {
        Color(red: red, green: green, blue: blue, opacity: alpha)
    }
}
