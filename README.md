# 统一加密核心 · Zig AES-256-CBC

一套 Zig 源码编译为 **Wasm**（浏览器）+ **动态库**（Bun FFI），双端算法/格式 100% 互通的流式加密系统。

## 核心特性

- **一套 Zig 源码双端复用** — `zig-src/crypto_core.zig` 编译为 `crypto.wasm`（浏览器 WebWorker）+ `libcryptocore.so`（Bun `bun:ffi`）
- **AES-256-CBC + PKCS7** — 真正流式分片，IV 跨块链接，仅末块填充，支持 TB 级低内存处理
- **PBKDF2-HMAC-SHA256** — 10 万次迭代密钥派生（Zig `std.crypto`）
- **统一文件格式 ENC1** — 自定义文件头携带原文件名/大小/MIME/时间戳/备注 + 内嵌缩略图
- **统一文本格式 ENT1** — 轻量文本加密
- **免密预览** — 无需密码即可读取文件头元信息与缩略图
- **双模式自由切换** — 前端本地加密（隐私优先）/ 后端服务加密（可控优先）
- **跨平台 100% 互通** — 前端加密可被后端解密，反之亦然

## 技术栈

| 层 | 技术 |
|---|---|
| 加密核心 | **Zig 0.14** (`std.crypto.aes.Aes256`, `std.crypto.pwhash.pbkdf2`) |
| 前端 | **SolidJS** + **Vite 8** + **Tailwind CSS 4** |
| 后端 | **Bun** + `bun:ffi` 加载 Zig `.so` |
| 格式层 | 共享 TypeScript（`crypto-core/src/format.ts`）|

## 项目结构

```
├── zig-src/           # Zig 加密核心源码 + 构建脚本
│   ├── crypto_core.zig    # 一套源码 → wasm + .so
│   └── build.sh           # 编译两个产物
├── crypto-core/       # 共享 TS 格式层 + Zig 加载器
│   └── src/
│       ├── format.ts          # ENC1/ENT1 格式 + 流式 API
│       ├── zig-loader-web.ts  # 浏览器 wasm 加载器
│       ├── zig-loader-native.ts # Bun .so 加载器 (bun:ffi)
│       └── zig-loader-types.ts # 共享接口
├── frontend/          # SolidJS + Vite 前端
│   └── src/
│       ├── App.tsx           # 主应用（双模式切换 + 标签页）
│       ├── worker/           # WebWorker 运行 Zig wasm
│       └── components/       # FileTab / TextTab / InspectTab
├── backend/           # Bun 后端服务 (port 3001)
│   └── src/index.ts
├── start-all.sh       # 启动 Vite + 后端（自动重启）
└── vercel.json        # Vercel 静态部署配置
```

## 本地开发

```bash
# 1. 编译 Zig 核心（需要 Zig 0.14）
cd zig-src && bash build.sh

# 2. 启动前端 + 后端
cd .. && bash start-all.sh
```

- 前端: http://localhost:3000
- 后端: http://localhost:3001

## Vercel 部署

项目已配置 `vercel.json`，支持一键部署到 Vercel：

1. Fork 仓库到 GitHub
2. 在 Vercel 导入项目
3. 部署（自动构建 Vite 前端为静态站点）

Vercel 部署为纯前端静态站点，默认使用**前端本地加密模式**（Zig Wasm 在浏览器内运行，明文不离开浏览器）。后端服务为可选的自托管组件。

## 编译 Zig 核心

```bash
cd zig-src
# 需要 Zig 0.14+ (https://ziglang.org/download/)
ZIG=/path/to/zig bash build.sh
```

产出：
- `frontend/public/crypto.wasm` — 浏览器加载
- `backend/libcryptocore.so` — Bun FFI 加载

## 加密格式

### ENC1 (文件)
```
"ENC1" | ver(1) | flags(1) | rsv(2) | headerJsonLen(4) | headerJson
| thumbnailLen(4) | thumbnail | salt(16) | iv(16) | ciphertext
```

### ENT1 (文本)
```
"ENT1" | ver(1) | flags(1) | rsv(2) | headerJsonLen(4) | headerJson
| salt(16) | iv(16) | ciphertext
```
