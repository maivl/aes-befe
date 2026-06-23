#!/bin/bash
set -e
cd /home/z/my-project/zig-src
ZIG=${ZIG:-/tmp/zig-linux-x86_64-0.14.0/zig}
if [ ! -f "$ZIG" ]; then
  echo "ERROR: Zig compiler not found at $ZIG"
  exit 1
fi
echo "Building crypto.wasm (wasm32-freestanding)..."
"$ZIG" build-lib crypto_core.zig -target wasm32-freestanding -dynamic -fno-entry -fstrip -O ReleaseFast
echo "Building libcryptocore.so (native)..."
"$ZIG" build-lib crypto_core.zig -dynamic -fstrip -O ReleaseFast
echo "Copying artifacts..."
cp crypto.wasm /home/z/my-project/frontend/public/crypto.wasm
mkdir -p /home/z/my-project/zig-src/zig-out/lib
cp libcryptocore.so /home/z/my-project/zig-src/zig-out/lib/libcryptocore.so 2>/dev/null || true
cp libcryptocore.so /home/z/my-project/backend/libcryptocore.so 2>/dev/null || true
echo "Done. Artifacts:"
ls -la crypto.wasm libcryptocore.so
