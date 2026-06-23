// build.zig — builds the unified crypto core to two artifacts from ONE source:
//   `bun run build:wasm`  ->  crypto.wasm        (wasm32-freestanding, exports)
//   `bun run build:lib`   ->  libcryptocore.so   (native shared lib, C ABI)
const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOptions(.{});

    // ---- Native shared library (libcryptocore.so / .dll / .dylib) ----
    const lib = b.addSharedLibrary(.{
        .name = "cryptocore",
        .root_source_file = b.path("crypto_core.zig"),
        .target = target,
        .optimize = optimize,
    });
    b.installArtifact(lib);

    // ---- WebAssembly module (crypto.wasm) ----
    const wasm_target = b.resolveTargetQuery(.{
        .cpu_arch = .wasm32,
        .os_tag = .freestanding,
        .cpu_features_add = std.Target.Cpu.Feature.Set.empty,
    });
    const wasm = b.addSharedLibrary(.{
        .name = "crypto",
        .root_source_file = b.path("crypto_core.zig"),
        .target = wasm_target,
        .optimize = .ReleaseFast,
    });
    wasm.rdynamic = true; // export all `export fn`
    // Export memory so JS can read/write linear memory.
    wasm.import_memory = false;
    wasm.export_memory = true;
    b.installArtifact(wasm);
}
