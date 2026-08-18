# iOS widget

Native iOS companion to `widget/` (Android). Same backend: Discord `/link` credentials and `GET /v1/widget/snapshot`.

```
ios/
├── Package.swift                 StructuredCore (logic + tests)
├── Sources/StructuredCore/       snapshot parse, today/week, list factory, refresh
├── Tests/StructuredCoreTests/
├── App/                          settings UI
├── WidgetExtension/              WidgetKit home-screen widget
├── Shared/                       App Group credentials + cache
├── StructuredWidget.xcodeproj
└── project.yml                   XcodeGen spec (optional regenerate)
```

## Open in Xcode (Mac)

1. Open `ios/StructuredWidget.xcodeproj`.
2. Select your Development Team for both **StructuredWidget** and **StructuredWidgetExtension**.
3. Confirm the App Group `group.com.example.structuredwidget` exists for that team (Signing & Capabilities).
4. Run on a simulator or device, then add **Planner · Day & Week** from the home-screen widget gallery.

If you prefer XcodeGen: `brew install xcodegen && cd ios && xcodegen generate`.

## Credentials

Same as Android:

1. Discord `/link` → copy user ID + `wt_…` token
2. Paste backend URL (simulator: `http://127.0.0.1:8003`)
3. Test connection
4. Add the widget

HTTP is allowed for localhost. Use HTTPS for remote hosts (App Transport Security).

## Tests

Core logic is Foundation-only and runs on Linux/macOS:

```bash
cd ios
swift test
```

Display rules match Android: due-first, hero/now, inbox/tomorrow/week, demo/stale/offline/relink banners, 15-minute refresh + ETag 304.
