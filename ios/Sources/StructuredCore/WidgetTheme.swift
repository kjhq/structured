import Foundation

public enum WidgetTheme {
    public static let defaultAccentHex = "#5E96CB"
    public static let successHex = "#26DE81"
    public static let warningHex = "#F7B731"
    public static let errorHex = "#EB3B5A"

    public struct RGBA: Equatable, Sendable {
        public var red: Double
        public var green: Double
        public var blue: Double
        public var alpha: Double

        public init(red: Double, green: Double, blue: Double, alpha: Double = 1) {
            self.red = red
            self.green = green
            self.blue = blue
            self.alpha = alpha
        }
    }

    public static func parseColor(_ hex: String?, fallback: String = defaultAccentHex) -> RGBA {
        let raw = (hex?.isEmpty == false ? hex! : fallback)
        return parse(raw) ?? parse(fallback) ?? RGBA(red: 94 / 255, green: 150 / 255, blue: 203 / 255)
    }

    public static func softAccent(_ color: RGBA) -> RGBA {
        RGBA(red: color.red, green: color.green, blue: color.blue, alpha: 0x1F / 255.0)
    }

    private static func parse(_ hex: String) -> RGBA? {
        var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6 || s.count == 8, let value = UInt32(s, radix: 16) else { return nil }
        if s.count == 8 {
            let a = Double((value >> 24) & 0xFF) / 255
            let r = Double((value >> 16) & 0xFF) / 255
            let g = Double((value >> 8) & 0xFF) / 255
            let b = Double(value & 0xFF) / 255
            return RGBA(red: r, green: g, blue: b, alpha: a)
        }
        let r = Double((value >> 16) & 0xFF) / 255
        let g = Double((value >> 8) & 0xFF) / 255
        let b = Double(value & 0xFF) / 255
        return RGBA(red: r, green: g, blue: b, alpha: 1)
    }
}

/// SF Symbol names already used by the Android widget / Structured backend.
public enum WidgetSymbol {
    public static func systemName(for symbol: String?) -> String {
        guard let symbol, !symbol.isEmpty else { return "circle.fill" }
        let known: Set<String> = [
            "alarm.fill", "alarm", "clock", "clock.fill",
            "moon.fill", "moon",
            "sun.max.fill", "sun.fill", "sun",
            "dumbbell.fill", "dumbbell",
            "car.fill", "car",
            "bicycle",
            "pencil", "pencil.and.outline",
            "calendar", "calendar.fill",
            "house.fill", "house",
            "text.badge.checkmark", "checkmark",
            "text.bubble", "message",
            "exclamationmark.triangle",
            "airplane", "bag", "flag",
        ]
        if known.contains(symbol) { return symbol }
        return "circle.fill"
    }
}
