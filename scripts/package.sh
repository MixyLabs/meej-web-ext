#!/usr/bin/env sh
set -eu

# Get version from git tag
TAG="$(git describe --tags --exact-match 2>/dev/null || true)"

if [ -z "$TAG" ]; then
  echo "ERROR: not on a git tag"
  exit 1
fi

# Remove 'v' prefix if present
VERSION="${TAG#v}"

echo "Building version $VERSION"

# Inject version
jq ".version = \"$VERSION\"" extension/manifest.json > extension/manifest.json.tmp
mv extension/manifest.json.tmp extension/manifest.json

# Zip extension
cd extension
zip -r ../meej-web-ext.zip .
#cd ..
