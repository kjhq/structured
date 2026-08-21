import Foundation

public enum TimeFormat {
    public static func formatHour(_ hours: Double, use24h: Bool) -> String {
        let totalMinutes = Int(floor(hours * 60.0 + 0.5))
        let h = ((totalMinutes / 60) % 24 + 24) % 24
        let m = ((totalMinutes % 60) + 60) % 60
        if use24h {
            return String(format: "%02d:%02d", h, m)
        }
        let period = h < 12 ? "a" : "p"
        let displayH: Int
        switch h {
        case 0: displayH = 12
        case 13...23: displayH = h - 12
        default: displayH = h
        }
        if m == 0 {
            return "\(displayH)\(period)"
        }
        return String(format: "%d:%02d%@", displayH, m, period)
    }

    public static func formatDuration(_ minutes: Int) -> String {
        let m = max(0, minutes)
        if m < 60 { return "\(m)m" }
        let h = m / 60
        let rem = m % 60
        return rem == 0 ? "\(h)h" : "\(h)h \(rem)m"
    }

    public static func formatRelativeUpdated(ageMs: Int64) -> String {
        let mins = max(0, Int(ageMs / 60_000))
        switch mins {
        case 0: return "just now"
        case 1: return "1 min ago"
        case 2..<60: return "\(mins) min ago"
        default:
            let h = mins / 60
            return h == 1 ? "1h ago" : "\(h)h ago"
        }
    }

    public static func hourOfDayFraction(hour: Int, minute: Int) -> Float {
        let total = hour * 60 + minute
        return min(1, max(0, Float(total) / (24.0 * 60.0)))
    }
}
