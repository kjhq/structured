# iOS Widget Design

**Date:** 2026-08-18  
**Status:** Implementation  
**Scope:** Port the Android Structured home-screen widget to iOS WidgetKit, sharing the same REST snapshot API and display rules.

## Goal

Ship a native iOS companion that matches the Android **Planner · Day & Week** widget: connect with Discord `/link` credentials, fetch `GET /v1/widget/snapshot`, and render today / due / inbox / tomorrow / week with the same banners and demo fallback.

## Decisions

| Topic | Choice |
|---|---|
| Layout | `ios/` sibling of `widget/` (Android stays put) |
| Shared logic | `StructuredCore` Swift package — Foundation only, tested on Linux |
| UI | SwiftUI settings app + WidgetKit extension |
| Min iOS | 17 (container background, modern widgets) |
| Auth | Same headers: `X-Discord-Id` + `X-Widget-Token` |
| Refresh | WidgetKit timeline every 15 minutes + manual reload from the app |
| Credentials | App Group UserDefaults for URL/Discord ID; Keychain for the token |
| Compact vs full | Small/medium families = Android compact (no week/tomorrow); large/extra large = full list |
| Scrolling | WidgetKit cannot scroll; truncate rows to a family cap after the same list factory |

## Architecture

```
Settings app ──► App Group + Keychain ──► Widget extension
       │                                         │
       └──────────── StructuredCore ─────────────┘
                         │
              GET /v1/me  (probe)
              GET /v1/widget/snapshot  (ETag / 304)
```

`StructuredCore` owns:

- Snapshot JSON parsing (lenient, matching Android)
- `TodayRepository` / `WeekRepository`
- `CombinedListFactory` row model
- Demo sample data
- Cache versioning + refresh outcomes (live / demo / stale / offline / relink)

The app and extension only own storage, URLSession, and SwiftUI.

## Display rules (parity with Android)

Unchanged from `CombinedListFactory` / `TodayRepository`:

- Due first (cap 8, or 4 in compact), newest day first
- Empty-day banner only when today + inbox + due are empty
- Hero = in-progress timed, else next upcoming, else last timed
- Inbox cap 8; tomorrow cap 4 (omitted in compact)
- Week skips today and tomorrow-if-already-shown
- Status banners: demo / stale (>30 min) / offline / relink / timezone mismatch

## Out of scope

- Completing or editing tasks from the widget
- App Store listing / ASO
- Sharing a binary with Android (Kotlin Multiplatform)

## Testing

XCTest on `StructuredCore` ports the existing Android unit tests (parser, today/week state, list factory, cache, refresh outcomes). Linux `swift test` is the CI-friendly check; Xcode is required to build the app/extension.
