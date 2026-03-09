#!/bin/bash
# Build and install Email.app to /Applications

set -e

export PATH="$HOME/.cargo/bin:$PATH"

echo "Building..."
npm run tauri build

echo "Installing..."
rm -rf /Applications/Email.app
cp -r src-tauri/target/release/bundle/macos/Email.app /Applications/Email.app
xattr -cr /Applications/Email.app

echo "Done. Email.app v$(node -p "require('./package.json').version") installed."
