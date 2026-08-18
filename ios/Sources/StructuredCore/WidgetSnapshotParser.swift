import Foundation

public enum WidgetSnapshotParserError: Error, Equatable {
    case invalidJSON
    case missingLogicalDate
    case missingVersion
}

public enum WidgetSnapshotParser {
    public static func parse(data: Data) throws -> WidgetSnapshot {
        guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw WidgetSnapshotParserError.invalidJSON
        }
        return try parse(obj)
    }

    public static func parse(_ json: [String: Any]) throws -> WidgetSnapshot {
        guard let logicalRaw = json["logical_date"] as? String,
              let logicalDate = DayDate(isoString: logicalRaw)
        else { throw WidgetSnapshotParserError.missingLogicalDate }
        guard let version = json["version"] as? String else {
            throw WidgetSnapshotParserError.missingVersion
        }
        let dayStartsRaw = (json["day_starts_at"] as? String) ?? "00:00:00"
        return WidgetSnapshot(
            logicalDate: logicalDate,
            timezone: (json["timezone"] as? String) ?? "",
            dayStartsAt: parseLocalTime(dayStartsRaw),
            generatedAt: (json["generated_at"] as? String) ?? "",
            version: version,
            today: parseTimeline(json["today"]),
            inbox: parseTimeline(json["inbox"]),
            due: parseTimeline(json["due"]),
            tomorrow: parseTimeline(json["tomorrow"]),
            week: parseTimeline(json["week"])
        )
    }

    public static func parseTimeline(_ raw: Any?) -> [StructuredTask] {
        guard let arr = raw as? [Any] else { return [] }
        return arr.compactMap { item in
            guard let obj = item as? [String: Any] else { return nil }
            return fromJSON(obj)
        }
    }

    private static func fromJSON(_ json: [String: Any]) -> StructuredTask {
        let idValue = json["id"]
        let id: String
        if let s = idValue as? String, !s.isEmpty {
            id = s
        } else if let n = idValue {
            id = String(describing: n)
        } else {
            id = "unknown"
        }
        let day: String? = {
            guard let s = json["day"] as? String, !s.isEmpty, s != "null" else { return nil }
            return s
        }()
        let startTime = parseStartTime(json)
        let duration: Int
        if let d = json["duration_minutes"] as? Int {
            duration = d
        } else if let d = json["duration_minutes"] as? Double {
            duration = Int(d)
        } else if let d = json["duration"] as? Int {
            duration = d
        } else if let d = json["duration"] as? Double {
            duration = Int(d)
        } else {
            duration = 0
        }
        let isAllDay = json["is_all_day"] as? Bool ?? false
        let completedAt: String? = {
            if json["completed_at"] is NSNull { return nil }
            if let s = json["completed_at"] as? String, !s.isEmpty, s != "null" { return s }
            return nil
        }()
        let notes = (json["notes"] as? String) ?? (json["note"] as? String) ?? ""
        let colorRaw = json["color"] as? String ?? ""
        let color = colorRaw.isEmpty ? "#5e96cb" : colorRaw
        let symbol: String? = {
            guard let s = json["symbol"] as? String, !s.isEmpty, s != "null" else { return nil }
            return s
        }()
        let isOccurrence = json["is_occurrence"] as? Bool ?? false
        let isInInbox = day == nil && !isOccurrence
        return StructuredTask(
            id: id,
            title: (json["title"] as? String) ?? "",
            day: day,
            startTime: startTime,
            duration: duration,
            isAllDay: isAllDay,
            isInInbox: isInInbox,
            color: color,
            note: notes,
            completedAt: completedAt,
            timezone: nil,
            alerts: parseAlerts(json["alerts"]),
            symbol: symbol
        )
    }

    private static func parseStartTime(_ json: [String: Any]) -> Double? {
        guard json["start_time"] != nil, !(json["start_time"] is NSNull) else { return nil }
        let raw = json["start_time"]
        if let n = raw as? NSNumber {
            return n.doubleValue
        }
        if let n = raw as? Double {
            return n
        }
        if let n = raw as? Int {
            return Double(n)
        }
        if let s = raw as? String {
            if s.isEmpty || s == "null" { return nil }
            if let t = parseLocalTimeOptional(s) {
                return Double(t.hour) + Double(t.minute) / 60.0 + 0.0
            }
            return Double(s)
        }
        return nil
    }

    private static func parseAlerts(_ raw: Any?) -> [Alert] {
        guard let arr = raw as? [Any] else { return [] }
        return arr.compactMap { item -> Alert? in
            guard let o = item as? [String: Any] else { return nil }
            let type = (o["kind"] as? String) ?? (o["type"] as? String) ?? "start"
            let offset: Int?
            if o["offset_minutes"] is NSNull {
                offset = nil
            } else if let n = o["offset_minutes"] as? Int {
                offset = n
            } else if o["offset"] is NSNull {
                offset = nil
            } else if let n = o["offset"] as? Int {
                offset = n
            } else {
                offset = nil
            }
            return Alert(type: type, offset: offset)
        }
    }

    private static func parseLocalTime(_ raw: String) -> ClockTime {
        parseLocalTimeOptional(raw) ?? ClockTime(hour: 0, minute: 0)
    }

    private static func parseLocalTimeOptional(_ raw: String) -> ClockTime? {
        let trimmed = raw.split(separator: ".").first.map(String.init) ?? raw
        let parts = trimmed.split(separator: ":")
        guard parts.count >= 2, let h = Int(parts[0]), let m = Int(parts[1]) else { return nil }
        return ClockTime(hour: h, minute: m)
    }
}
