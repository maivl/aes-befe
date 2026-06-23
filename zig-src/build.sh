#!/bin/bash
set -e
cd /home/z/my-project/zig-src
ZIG=${ZIG:-/tmp/zig-linux-x86_64-0.14.0/zig}
if [ ! -f "$ZIG" ]; then
  echo "ERROR: Zig compiler not found at $ZIG"
  echo "Download from https://ziglang.org/download/"
  exit 1
fi

echo "Building crypto.wasm (wasm32-freestanding)..."
"$ZIG" build-exe crypto_core.zig -target wasm32-freestanding -fno-entry -rdynamic -O ReleaseFast
mv -f crypto_core.wasm crypto.wasm 2>/dev/null || true

echo "Building libcryptocore.so (native linux x86_64)..."
"$ZIG" build-lib crypto_core.zig -dynamic -O ReleaseFast
# Zig names it libcrypto_core.so — rename to what bun:ffi expects
cp -f libcrypto_core.so libcryptocore.so 2>/dev/null || true

echo "Copying artifacts..."
cp -f crypto.wasm /home/z/my-project/frontend/public/crypto.wasm
cp -f libcryptocore.so /home/z/my-project/backend/libcryptocore.so
mkdir -p /home/z/my-project/zig-src/zig-out/lib
cp -f libcryptocore.so /home/z/my-project/zig-src/zig-out/lib/libcryptocore.so

echo "Done. Artifacts:"
ls -la crypto.wasm libcryptocore.so
