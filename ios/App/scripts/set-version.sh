#!/bin/bash
# Reads version info from the bundled version.json and sets
# CFBundleShortVersionString and CFBundleVersion in Info.plist.
# Add this as a "Run Script" build phase in the App target,
# BEFORE the "Compile Sources" phase.

VERSION_FILE="${BUILT_PRODUCTS_DIR}/${CONTENTS_FOLDER_PATH}/public/version.json"

# Fallback to source if built products don't exist yet
if [ ! -f "$VERSION_FILE" ]; then
    VERSION_FILE="${SRCROOT}/App/public/version.json"
fi

if [ ! -f "$VERSION_FILE" ]; then
    echo "warning: version.json not found, skipping version sync"
    exit 0
fi

# Extract version and buildNumber using python3 (available on all macOS)
VERSION=$(python3 -c "import json; d=json.load(open('$VERSION_FILE')); print(d['version'].replace('saveitforl8r-v',''))" 2>/dev/null)
BUILD_NUMBER=$(python3 -c "import json; d=json.load(open('$VERSION_FILE')); print(d['buildNumber'])" 2>/dev/null)

if [ -z "$VERSION" ] || [ -z "$BUILD_NUMBER" ]; then
    echo "warning: Failed to parse version.json, skipping version sync"
    exit 0
fi

# Use the build number as the marketing version (e.g., "58")
# and also as the bundle version
MARKETING_VERSION="1.0.${VERSION}"
BUNDLE_VERSION="${BUILD_NUMBER}"

echo "Setting app version: ${MARKETING_VERSION} (${BUNDLE_VERSION}) from version.json"

# Update the Info.plist in the build products
PLIST="${TARGET_BUILD_DIR}/${INFOPLIST_PATH}"
if [ -f "$PLIST" ]; then
    /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString ${MARKETING_VERSION}" "$PLIST"
    /usr/libexec/PlistBuddy -c "Set :CFBundleVersion ${BUNDLE_VERSION}" "$PLIST"
fi
