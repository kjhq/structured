// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "StructuredCore",
    platforms: [
        .iOS(.v17),
        .macOS(.v13),
    ],
    products: [
        .library(name: "StructuredCore", targets: ["StructuredCore"]),
    ],
    targets: [
        .target(name: "StructuredCore"),
        .testTarget(
            name: "StructuredCoreTests",
            dependencies: ["StructuredCore"]
        ),
    ]
)
