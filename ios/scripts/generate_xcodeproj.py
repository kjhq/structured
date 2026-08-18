#!/usr/bin/env python3
"""Write ios/StructuredWidget.xcodeproj/project.pbxproj for the local StructuredCore package."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROJ = ROOT / "StructuredWidget.xcodeproj"
PROJ.mkdir(exist_ok=True)

# Deterministic 24-char hex ids
ids = {
    "project": "A10000000000000000000001",
    "app_target": "A10000000000000000000002",
    "ext_target": "A10000000000000000000003",
    "app_product": "A10000000000000000000010",
    "ext_product": "A10000000000000000000011",
    "widgetkit": "A10000000000000000000012",
    "swiftui": "A10000000000000000000013",
    "app_plist": "A10000000000000000000020",
    "ext_plist": "A10000000000000000000021",
    "app_ent": "A10000000000000000000022",
    "ext_ent": "A10000000000000000000023",
    "app_assets": "A10000000000000000000024",
    "ext_assets": "A10000000000000000000025",
    "pkg_ref": "A10000000000000000000030",
    "pkg_app": "A10000000000000000000031",
    "pkg_ext": "A10000000000000000000032",
    "src_app_swift": "A10000000000000000000040",
    "src_settings": "A10000000000000000000041",
    "src_constants": "A10000000000000000000042",
    "src_creds": "A10000000000000000000043",
    "src_sync": "A10000000000000000000044",
    "src_bundle": "A10000000000000000000045",
    "src_view": "A10000000000000000000046",
    "bf_app_swift": "A10000000000000000000050",
    "bf_settings": "A10000000000000000000051",
    "bf_constants_app": "A10000000000000000000052",
    "bf_creds_app": "A10000000000000000000053",
    "bf_sync_app": "A10000000000000000000054",
    "bf_assets_app": "A10000000000000000000055",
    "bf_widgetkit_app": "A10000000000000000000056",
    "bf_swiftui_app": "A10000000000000000000057",
    "bf_core_app": "A10000000000000000000058",
    "bf_embed_ext": "A10000000000000000000059",
    "bf_bundle": "A10000000000000000000060",
    "bf_view": "A10000000000000000000061",
    "bf_constants_ext": "A10000000000000000000062",
    "bf_creds_ext": "A10000000000000000000063",
    "bf_sync_ext": "A10000000000000000000064",
    "bf_assets_ext": "A10000000000000000000065",
    "bf_widgetkit_ext": "A10000000000000000000066",
    "bf_swiftui_ext": "A10000000000000000000067",
    "bf_core_ext": "A10000000000000000000068",
    "app_sources": "A10000000000000000000070",
    "app_frameworks": "A10000000000000000000071",
    "app_resources": "A10000000000000000000072",
    "app_embed": "A10000000000000000000073",
    "ext_sources": "A10000000000000000000074",
    "ext_frameworks": "A10000000000000000000075",
    "ext_resources": "A10000000000000000000076",
    "group_root": "A10000000000000000000080",
    "group_app": "A10000000000000000000081",
    "group_shared": "A10000000000000000000082",
    "group_ext": "A10000000000000000000083",
    "group_fw": "A10000000000000000000084",
    "group_products": "A10000000000000000000085",
    "conf_list_proj": "A10000000000000000000090",
    "conf_list_app": "A10000000000000000000091",
    "conf_list_ext": "A10000000000000000000092",
    "conf_proj_debug": "A10000000000000000000093",
    "conf_proj_release": "A10000000000000000000094",
    "conf_app_debug": "A10000000000000000000095",
    "conf_app_release": "A10000000000000000000096",
    "conf_ext_debug": "A10000000000000000000097",
    "conf_ext_release": "A10000000000000000000098",
    "proxy": "A100000000000000000000A0",
    "dep": "A100000000000000000000A1",
}

pbx = f"""// !$*UTF8*$!
{{
	archiveVersion = 1;
	classes = {{
	}};
	objectVersion = 56;
	objects = {{

/* Begin PBXBuildFile section */
		{ids['bf_app_swift']} /* StructuredWidgetApp.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {ids['src_app_swift']} /* StructuredWidgetApp.swift */; }};
		{ids['bf_settings']} /* SettingsView.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {ids['src_settings']} /* SettingsView.swift */; }};
		{ids['bf_constants_app']} /* AppConstants.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {ids['src_constants']} /* AppConstants.swift */; }};
		{ids['bf_creds_app']} /* CredentialStore.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {ids['src_creds']} /* CredentialStore.swift */; }};
		{ids['bf_sync_app']} /* WidgetSync.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {ids['src_sync']} /* WidgetSync.swift */; }};
		{ids['bf_assets_app']} /* Assets.xcassets in Resources */ = {{isa = PBXBuildFile; fileRef = {ids['app_assets']} /* Assets.xcassets */; }};
		{ids['bf_widgetkit_app']} /* WidgetKit.framework in Frameworks */ = {{isa = PBXBuildFile; fileRef = {ids['widgetkit']} /* WidgetKit.framework */; }};
		{ids['bf_swiftui_app']} /* SwiftUI.framework in Frameworks */ = {{isa = PBXBuildFile; fileRef = {ids['swiftui']} /* SwiftUI.framework */; }};
		{ids['bf_core_app']} /* StructuredCore in Frameworks */ = {{isa = PBXBuildFile; productRef = {ids['pkg_app']} /* StructuredCore */; }};
		{ids['bf_embed_ext']} /* StructuredWidgetExtension.appex in Embed Foundation Extensions */ = {{isa = PBXBuildFile; fileRef = {ids['ext_product']} /* StructuredWidgetExtension.appex */; settings = {{ATTRIBUTES = (RemoveHeadersOnCopy, ); }}; }};
		{ids['bf_bundle']} /* StructuredWidgetBundle.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {ids['src_bundle']} /* StructuredWidgetBundle.swift */; }};
		{ids['bf_view']} /* CombinedWidgetView.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {ids['src_view']} /* CombinedWidgetView.swift */; }};
		{ids['bf_constants_ext']} /* AppConstants.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {ids['src_constants']} /* AppConstants.swift */; }};
		{ids['bf_creds_ext']} /* CredentialStore.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {ids['src_creds']} /* CredentialStore.swift */; }};
		{ids['bf_sync_ext']} /* WidgetSync.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {ids['src_sync']} /* WidgetSync.swift */; }};
		{ids['bf_assets_ext']} /* Assets.xcassets in Resources */ = {{isa = PBXBuildFile; fileRef = {ids['ext_assets']} /* Assets.xcassets */; }};
		{ids['bf_widgetkit_ext']} /* WidgetKit.framework in Frameworks */ = {{isa = PBXBuildFile; fileRef = {ids['widgetkit']} /* WidgetKit.framework */; }};
		{ids['bf_swiftui_ext']} /* SwiftUI.framework in Frameworks */ = {{isa = PBXBuildFile; fileRef = {ids['swiftui']} /* SwiftUI.framework */; }};
		{ids['bf_core_ext']} /* StructuredCore in Frameworks */ = {{isa = PBXBuildFile; productRef = {ids['pkg_ext']} /* StructuredCore */; }};
/* End PBXBuildFile section */

/* Begin PBXContainerItemProxy section */
		{ids['proxy']} /* PBXContainerItemProxy */ = {{
			isa = PBXContainerItemProxy;
			containerPortal = {ids['project']} /* Project object */;
			proxyType = 1;
			remoteGlobalIDString = {ids['ext_target']};
			remoteInfo = StructuredWidgetExtension;
		}};
/* End PBXContainerItemProxy section */

/* Begin PBXCopyFilesBuildPhase section */
		{ids['app_embed']} /* Embed Foundation Extensions */ = {{
			isa = PBXCopyFilesBuildPhase;
			buildActionMask = 2147483647;
			dstPath = "";
			dstSubfolderSpec = 13;
			files = (
				{ids['bf_embed_ext']} /* StructuredWidgetExtension.appex in Embed Foundation Extensions */,
			);
			name = "Embed Foundation Extensions";
			runOnlyForDeploymentPostprocessing = 0;
		}};
/* End PBXCopyFilesBuildPhase section */

/* Begin PBXFileReference section */
		{ids['app_product']} /* StructuredWidget.app */ = {{isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = StructuredWidget.app; sourceTree = BUILT_PRODUCTS_DIR; }};
		{ids['ext_product']} /* StructuredWidgetExtension.appex */ = {{isa = PBXFileReference; explicitFileType = "wrapper.app-extension"; includeInIndex = 0; path = StructuredWidgetExtension.appex; sourceTree = BUILT_PRODUCTS_DIR; }};
		{ids['widgetkit']} /* WidgetKit.framework */ = {{isa = PBXFileReference; lastKnownFileType = wrapper.framework; name = WidgetKit.framework; path = System/Library/Frameworks/WidgetKit.framework; sourceTree = SDKROOT; }};
		{ids['swiftui']} /* SwiftUI.framework */ = {{isa = PBXFileReference; lastKnownFileType = wrapper.framework; name = SwiftUI.framework; path = System/Library/Frameworks/SwiftUI.framework; sourceTree = SDKROOT; }};
		{ids['src_app_swift']} /* StructuredWidgetApp.swift */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = StructuredWidgetApp.swift; sourceTree = "<group>"; }};
		{ids['src_settings']} /* SettingsView.swift */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = SettingsView.swift; sourceTree = "<group>"; }};
		{ids['app_plist']} /* Info.plist */ = {{isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Info.plist; sourceTree = "<group>"; }};
		{ids['app_ent']} /* StructuredWidget.entitlements */ = {{isa = PBXFileReference; lastKnownFileType = text.plist.entitlements; path = StructuredWidget.entitlements; sourceTree = "<group>"; }};
		{ids['app_assets']} /* Assets.xcassets */ = {{isa = PBXFileReference; lastKnownFileType = folder.assetcatalog; path = Assets.xcassets; sourceTree = "<group>"; }};
		{ids['src_constants']} /* AppConstants.swift */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = AppConstants.swift; sourceTree = "<group>"; }};
		{ids['src_creds']} /* CredentialStore.swift */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = CredentialStore.swift; sourceTree = "<group>"; }};
		{ids['src_sync']} /* WidgetSync.swift */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = WidgetSync.swift; sourceTree = "<group>"; }};
		{ids['src_bundle']} /* StructuredWidgetBundle.swift */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = StructuredWidgetBundle.swift; sourceTree = "<group>"; }};
		{ids['src_view']} /* CombinedWidgetView.swift */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = CombinedWidgetView.swift; sourceTree = "<group>"; }};
		{ids['ext_plist']} /* Info.plist */ = {{isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Info.plist; sourceTree = "<group>"; }};
		{ids['ext_ent']} /* StructuredWidgetExtension.entitlements */ = {{isa = PBXFileReference; lastKnownFileType = text.plist.entitlements; path = StructuredWidgetExtension.entitlements; sourceTree = "<group>"; }};
		{ids['ext_assets']} /* Assets.xcassets */ = {{isa = PBXFileReference; lastKnownFileType = folder.assetcatalog; path = Assets.xcassets; sourceTree = "<group>"; }};
/* End PBXFileReference section */

/* Begin PBXFrameworksBuildPhase section */
		{ids['app_frameworks']} /* Frameworks */ = {{
			isa = PBXFrameworksBuildPhase;
			buildActionMask = 2147483647;
			files = (
				{ids['bf_swiftui_app']} /* SwiftUI.framework in Frameworks */,
				{ids['bf_widgetkit_app']} /* WidgetKit.framework in Frameworks */,
				{ids['bf_core_app']} /* StructuredCore in Frameworks */,
			);
			runOnlyForDeploymentPostprocessing = 0;
		}};
		{ids['ext_frameworks']} /* Frameworks */ = {{
			isa = PBXFrameworksBuildPhase;
			buildActionMask = 2147483647;
			files = (
				{ids['bf_swiftui_ext']} /* SwiftUI.framework in Frameworks */,
				{ids['bf_widgetkit_ext']} /* WidgetKit.framework in Frameworks */,
				{ids['bf_core_ext']} /* StructuredCore in Frameworks */,
			);
			runOnlyForDeploymentPostprocessing = 0;
		}};
/* End PBXFrameworksBuildPhase section */

/* Begin PBXGroup section */
		{ids['group_root']} = {{
			isa = PBXGroup;
			children = (
				{ids['group_app']} /* App */,
				{ids['group_shared']} /* Shared */,
				{ids['group_ext']} /* WidgetExtension */,
				{ids['group_fw']} /* Frameworks */,
				{ids['group_products']} /* Products */,
			);
			sourceTree = "<group>";
		}};
		{ids['group_app']} /* App */ = {{
			isa = PBXGroup;
			children = (
				{ids['src_app_swift']} /* StructuredWidgetApp.swift */,
				{ids['src_settings']} /* SettingsView.swift */,
				{ids['app_plist']} /* Info.plist */,
				{ids['app_ent']} /* StructuredWidget.entitlements */,
				{ids['app_assets']} /* Assets.xcassets */,
			);
			path = App;
			sourceTree = "<group>";
		}};
		{ids['group_shared']} /* Shared */ = {{
			isa = PBXGroup;
			children = (
				{ids['src_constants']} /* AppConstants.swift */,
				{ids['src_creds']} /* CredentialStore.swift */,
				{ids['src_sync']} /* WidgetSync.swift */,
			);
			path = Shared;
			sourceTree = "<group>";
		}};
		{ids['group_ext']} /* WidgetExtension */ = {{
			isa = PBXGroup;
			children = (
				{ids['src_bundle']} /* StructuredWidgetBundle.swift */,
				{ids['src_view']} /* CombinedWidgetView.swift */,
				{ids['ext_plist']} /* Info.plist */,
				{ids['ext_ent']} /* StructuredWidgetExtension.entitlements */,
				{ids['ext_assets']} /* Assets.xcassets */,
			);
			path = WidgetExtension;
			sourceTree = "<group>";
		}};
		{ids['group_fw']} /* Frameworks */ = {{
			isa = PBXGroup;
			children = (
				{ids['widgetkit']} /* WidgetKit.framework */,
				{ids['swiftui']} /* SwiftUI.framework */,
			);
			name = Frameworks;
			sourceTree = "<group>";
		}};
		{ids['group_products']} /* Products */ = {{
			isa = PBXGroup;
			children = (
				{ids['app_product']} /* StructuredWidget.app */,
				{ids['ext_product']} /* StructuredWidgetExtension.appex */,
			);
			name = Products;
			sourceTree = "<group>";
		}};
/* End PBXGroup section */

/* Begin PBXNativeTarget section */
		{ids['app_target']} /* StructuredWidget */ = {{
			isa = PBXNativeTarget;
			buildConfigurationList = {ids['conf_list_app']} /* Build configuration list for PBXNativeTarget "StructuredWidget" */;
			buildPhases = (
				{ids['app_sources']} /* Sources */,
				{ids['app_frameworks']} /* Frameworks */,
				{ids['app_resources']} /* Resources */,
				{ids['app_embed']} /* Embed Foundation Extensions */,
			);
			buildRules = (
			);
			dependencies = (
				{ids['dep']} /* PBXTargetDependency */,
			);
			name = StructuredWidget;
			packageProductDependencies = (
				{ids['pkg_app']} /* StructuredCore */,
			);
			productName = StructuredWidget;
			productReference = {ids['app_product']} /* StructuredWidget.app */;
			productType = "com.apple.product-type.application";
		}};
		{ids['ext_target']} /* StructuredWidgetExtension */ = {{
			isa = PBXNativeTarget;
			buildConfigurationList = {ids['conf_list_ext']} /* Build configuration list for PBXNativeTarget "StructuredWidgetExtension" */;
			buildPhases = (
				{ids['ext_sources']} /* Sources */,
				{ids['ext_frameworks']} /* Frameworks */,
				{ids['ext_resources']} /* Resources */,
			);
			buildRules = (
			);
			dependencies = (
			);
			name = StructuredWidgetExtension;
			packageProductDependencies = (
				{ids['pkg_ext']} /* StructuredCore */,
			);
			productName = StructuredWidgetExtension;
			productReference = {ids['ext_product']} /* StructuredWidgetExtension.appex */;
			productType = "com.apple.product-type.app-extension";
		}};
/* End PBXNativeTarget section */

/* Begin PBXProject section */
		{ids['project']} /* Project object */ = {{
			isa = PBXProject;
			attributes = {{
				BuildIndependentTargetsInParallel = 1;
				LastSwiftUpdateCheck = 1500;
				LastUpgradeCheck = 1500;
				TargetAttributes = {{
					{ids['app_target']} = {{
						CreatedOnToolsVersion = 15.0;
					}};
					{ids['ext_target']} = {{
						CreatedOnToolsVersion = 15.0;
					}};
				}};
			}};
			buildConfigurationList = {ids['conf_list_proj']} /* Build configuration list for PBXProject "StructuredWidget" */;
			compatibilityVersion = "Xcode 14.0";
			developmentRegion = en;
			hasScannedForEncodings = 0;
			knownRegions = (
				en,
				Base,
			);
			mainGroup = {ids['group_root']};
			packageReferences = (
				{ids['pkg_ref']} /* XCLocalSwiftPackageReference "." */,
			);
			productRefGroup = {ids['group_products']} /* Products */;
			projectDirPath = "";
			projectRoot = "";
			targets = (
				{ids['app_target']} /* StructuredWidget */,
				{ids['ext_target']} /* StructuredWidgetExtension */,
			);
		}};
/* End PBXProject section */

/* Begin PBXResourcesBuildPhase section */
		{ids['app_resources']} /* Resources */ = {{
			isa = PBXResourcesBuildPhase;
			buildActionMask = 2147483647;
			files = (
				{ids['bf_assets_app']} /* Assets.xcassets in Resources */,
			);
			runOnlyForDeploymentPostprocessing = 0;
		}};
		{ids['ext_resources']} /* Resources */ = {{
			isa = PBXResourcesBuildPhase;
			buildActionMask = 2147483647;
			files = (
				{ids['bf_assets_ext']} /* Assets.xcassets in Resources */,
			);
			runOnlyForDeploymentPostprocessing = 0;
		}};
/* End PBXResourcesBuildPhase section */

/* Begin PBXSourcesBuildPhase section */
		{ids['app_sources']} /* Sources */ = {{
			isa = PBXSourcesBuildPhase;
			buildActionMask = 2147483647;
			files = (
				{ids['bf_app_swift']} /* StructuredWidgetApp.swift in Sources */,
				{ids['bf_settings']} /* SettingsView.swift in Sources */,
				{ids['bf_constants_app']} /* AppConstants.swift in Sources */,
				{ids['bf_creds_app']} /* CredentialStore.swift in Sources */,
				{ids['bf_sync_app']} /* WidgetSync.swift in Sources */,
			);
			runOnlyForDeploymentPostprocessing = 0;
		}};
		{ids['ext_sources']} /* Sources */ = {{
			isa = PBXSourcesBuildPhase;
			buildActionMask = 2147483647;
			files = (
				{ids['bf_bundle']} /* StructuredWidgetBundle.swift in Sources */,
				{ids['bf_view']} /* CombinedWidgetView.swift in Sources */,
				{ids['bf_constants_ext']} /* AppConstants.swift in Sources */,
				{ids['bf_creds_ext']} /* CredentialStore.swift in Sources */,
				{ids['bf_sync_ext']} /* WidgetSync.swift in Sources */,
			);
			runOnlyForDeploymentPostprocessing = 0;
		}};
/* End PBXSourcesBuildPhase section */

/* Begin PBXTargetDependency section */
		{ids['dep']} /* PBXTargetDependency */ = {{
			isa = PBXTargetDependency;
			target = {ids['ext_target']} /* StructuredWidgetExtension */;
			targetProxy = {ids['proxy']} /* PBXContainerItemProxy */;
		}};
/* End PBXTargetDependency section */

/* Begin XCBuildConfiguration section */
		{ids['conf_proj_debug']} /* Debug */ = {{
			isa = XCBuildConfiguration;
			buildSettings = {{
				ALWAYS_SEARCH_USER_PATHS = NO;
				CLANG_ENABLE_MODULES = YES;
				COPY_PHASE_STRIP = NO;
				DEBUG_INFORMATION_FORMAT = dwarf;
				ENABLE_TESTABILITY = YES;
				GCC_DYNAMIC_NO_PIC = NO;
				IPHONEOS_DEPLOYMENT_TARGET = 17.0;
				MTL_ENABLE_DEBUG_INFO = INCLUDE_SOURCE;
				ONLY_ACTIVE_ARCH = YES;
				SDKROOT = iphoneos;
				SWIFT_ACTIVE_COMPILATION_CONDITIONS = DEBUG;
				SWIFT_OPTIMIZATION_LEVEL = "-Onone";
				SWIFT_VERSION = 5.0;
			}};
			name = Debug;
		}};
		{ids['conf_proj_release']} /* Release */ = {{
			isa = XCBuildConfiguration;
			buildSettings = {{
				ALWAYS_SEARCH_USER_PATHS = NO;
				CLANG_ENABLE_MODULES = YES;
				COPY_PHASE_STRIP = NO;
				DEBUG_INFORMATION_FORMAT = "dwarf-with-dsym";
				IPHONEOS_DEPLOYMENT_TARGET = 17.0;
				MTL_ENABLE_DEBUG_INFO = NO;
				SDKROOT = iphoneos;
				SWIFT_COMPILATION_MODE = wholemodule;
				SWIFT_VERSION = 5.0;
				VALIDATE_PRODUCT = YES;
			}};
			name = Release;
		}};
		{ids['conf_app_debug']} /* Debug */ = {{
			isa = XCBuildConfiguration;
			buildSettings = {{
				ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;
				CODE_SIGN_ENTITLEMENTS = App/StructuredWidget.entitlements;
				CODE_SIGN_STYLE = Automatic;
				CURRENT_PROJECT_VERSION = 1;
				DEVELOPMENT_TEAM = "";
				GENERATE_INFOPLIST_FILE = NO;
				INFOPLIST_FILE = App/Info.plist;
				LD_RUNPATH_SEARCH_PATHS = "$(inherited) @executable_path/Frameworks";
				MARKETING_VERSION = 1.0;
				PRODUCT_BUNDLE_IDENTIFIER = com.example.structuredwidget;
				PRODUCT_NAME = "$(TARGET_NAME)";
				SUPPORTED_PLATFORMS = "iphoneos iphonesimulator";
				SUPPORTS_MACCATALYST = NO;
				SWIFT_EMIT_LOC_STRINGS = YES;
				SWIFT_VERSION = 5.0;
				TARGETED_DEVICE_FAMILY = "1,2";
			}};
			name = Debug;
		}};
		{ids['conf_app_release']} /* Release */ = {{
			isa = XCBuildConfiguration;
			buildSettings = {{
				ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;
				CODE_SIGN_ENTITLEMENTS = App/StructuredWidget.entitlements;
				CODE_SIGN_STYLE = Automatic;
				CURRENT_PROJECT_VERSION = 1;
				DEVELOPMENT_TEAM = "";
				GENERATE_INFOPLIST_FILE = NO;
				INFOPLIST_FILE = App/Info.plist;
				LD_RUNPATH_SEARCH_PATHS = "$(inherited) @executable_path/Frameworks";
				MARKETING_VERSION = 1.0;
				PRODUCT_BUNDLE_IDENTIFIER = com.example.structuredwidget;
				PRODUCT_NAME = "$(TARGET_NAME)";
				SUPPORTED_PLATFORMS = "iphoneos iphonesimulator";
				SUPPORTS_MACCATALYST = NO;
				SWIFT_EMIT_LOC_STRINGS = YES;
				SWIFT_VERSION = 5.0;
				TARGETED_DEVICE_FAMILY = "1,2";
			}};
			name = Release;
		}};
		{ids['conf_ext_debug']} /* Debug */ = {{
			isa = XCBuildConfiguration;
			buildSettings = {{
				CODE_SIGN_ENTITLEMENTS = WidgetExtension/StructuredWidgetExtension.entitlements;
				CODE_SIGN_STYLE = Automatic;
				CURRENT_PROJECT_VERSION = 1;
				DEVELOPMENT_TEAM = "";
				GENERATE_INFOPLIST_FILE = NO;
				INFOPLIST_FILE = WidgetExtension/Info.plist;
				LD_RUNPATH_SEARCH_PATHS = "$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks";
				MARKETING_VERSION = 1.0;
				PRODUCT_BUNDLE_IDENTIFIER = com.example.structuredwidget.widget;
				PRODUCT_NAME = "$(TARGET_NAME)";
				SKIP_INSTALL = YES;
				APPLICATION_EXTENSION_API_ONLY = YES;
				SUPPORTED_PLATFORMS = "iphoneos iphonesimulator";
				SWIFT_EMIT_LOC_STRINGS = YES;
				SWIFT_VERSION = 5.0;
				TARGETED_DEVICE_FAMILY = "1,2";
			}};
			name = Debug;
		}};
		{ids['conf_ext_release']} /* Release */ = {{
			isa = XCBuildConfiguration;
			buildSettings = {{
				CODE_SIGN_ENTITLEMENTS = WidgetExtension/StructuredWidgetExtension.entitlements;
				CODE_SIGN_STYLE = Automatic;
				CURRENT_PROJECT_VERSION = 1;
				DEVELOPMENT_TEAM = "";
				GENERATE_INFOPLIST_FILE = NO;
				INFOPLIST_FILE = WidgetExtension/Info.plist;
				LD_RUNPATH_SEARCH_PATHS = "$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks";
				MARKETING_VERSION = 1.0;
				PRODUCT_BUNDLE_IDENTIFIER = com.example.structuredwidget.widget;
				PRODUCT_NAME = "$(TARGET_NAME)";
				SKIP_INSTALL = YES;
				APPLICATION_EXTENSION_API_ONLY = YES;
				SUPPORTED_PLATFORMS = "iphoneos iphonesimulator";
				SWIFT_EMIT_LOC_STRINGS = YES;
				SWIFT_VERSION = 5.0;
				TARGETED_DEVICE_FAMILY = "1,2";
			}};
			name = Release;
		}};
/* End XCBuildConfiguration section */

/* Begin XCConfigurationList section */
		{ids['conf_list_proj']} /* Build configuration list for PBXProject "StructuredWidget" */ = {{
			isa = XCConfigurationList;
			buildConfigurations = (
				{ids['conf_proj_debug']} /* Debug */,
				{ids['conf_proj_release']} /* Release */,
			);
			defaultConfigurationIsVisible = 0;
			defaultConfigurationName = Release;
		}};
		{ids['conf_list_app']} /* Build configuration list for PBXNativeTarget "StructuredWidget" */ = {{
			isa = XCConfigurationList;
			buildConfigurations = (
				{ids['conf_app_debug']} /* Debug */,
				{ids['conf_app_release']} /* Release */,
			);
			defaultConfigurationIsVisible = 0;
			defaultConfigurationName = Release;
		}};
		{ids['conf_list_ext']} /* Build configuration list for PBXNativeTarget "StructuredWidgetExtension" */ = {{
			isa = XCConfigurationList;
			buildConfigurations = (
				{ids['conf_ext_debug']} /* Debug */,
				{ids['conf_ext_release']} /* Release */,
			);
			defaultConfigurationIsVisible = 0;
			defaultConfigurationName = Release;
		}};
/* End XCConfigurationList section */

/* Begin XCLocalSwiftPackageReference section */
		{ids['pkg_ref']} /* XCLocalSwiftPackageReference "." */ = {{
			isa = XCLocalSwiftPackageReference;
			relativePath = .;
		}};
/* End XCLocalSwiftPackageReference section */

/* Begin XCSwiftPackageProductDependency section */
		{ids['pkg_app']} /* StructuredCore */ = {{
			isa = XCSwiftPackageProductDependency;
			package = {ids['pkg_ref']} /* XCLocalSwiftPackageReference "." */;
			productName = StructuredCore;
		}};
		{ids['pkg_ext']} /* StructuredCore */ = {{
			isa = XCSwiftPackageProductDependency;
			package = {ids['pkg_ref']} /* XCLocalSwiftPackageReference "." */;
			productName = StructuredCore;
		}};
/* End XCSwiftPackageProductDependency section */
	}};
	rootObject = {ids['project']} /* Project object */;
}}
"""

pbx = pbx.replace(" mar", "")

(PROJ / "project.pbxproj").write_text(pbx)
print(f"wrote {PROJ / 'project.pbxproj'}")
