#!/bin/bash
# Download JetBrains Mono fonts for Rifler extension
# Run this script from the project root directory

FONTS_DIR="assets/fonts"
JETBRAINS_VERSION="2.304"
DOWNLOAD_URL="https://github.com/JetBrains/JetBrainsMono/releases/download/v${JETBRAINS_VERSION}/JetBrainsMono-${JETBRAINS_VERSION}.zip"
TEMP_ZIP="jetbrains-mono.zip"
TEMP_DIR="jetbrains-mono-temp"

echo "📦 Downloading JetBrains Mono v${JETBRAINS_VERSION}..."

# Download the release
curl -L -o "$TEMP_ZIP" "$DOWNLOAD_URL"

if [ $? -ne 0 ]; then
  echo "❌ Failed to download JetBrains Mono"
  exit 1
fi

echo "📂 Extracting fonts..."

# Create temp directory and extract
mkdir -p "$TEMP_DIR"
unzip -q "$TEMP_ZIP" -d "$TEMP_DIR"

# Create fonts directory if it doesn't exist
mkdir -p "$FONTS_DIR"

# Copy only the required .woff2 files
echo "📋 Copying required font files..."
find "$TEMP_DIR" -name "JetBrainsMono-Regular.woff2" -exec cp {} "$FONTS_DIR/" \;
find "$TEMP_DIR" -name "JetBrainsMono-Medium.woff2" -exec cp {} "$FONTS_DIR/" \;
find "$TEMP_DIR" -name "JetBrainsMono-Bold.woff2" -exec cp {} "$FONTS_DIR/" \;

# Cleanup
rm -rf "$TEMP_DIR"
rm "$TEMP_ZIP"

# Verify files were copied
if [ -f "$FONTS_DIR/JetBrainsMono-Regular.woff2" ] && \
   [ -f "$FONTS_DIR/JetBrainsMono-Medium.woff2" ] && \
   [ -f "$FONTS_DIR/JetBrainsMono-Bold.woff2" ]; then
  echo "✅ Fonts successfully installed in $FONTS_DIR"
  echo ""
  echo "Files:"
  ls -lh "$FONTS_DIR"/*.woff2
else
  echo "❌ Font installation failed - files not found"
  exit 1
fi

echo ""
echo "🎉 Font setup complete! Ready to build extension."
