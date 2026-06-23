import { createSignal, Show, createMemo } from "solid-js";
import type { FileMeta } from "@crypto-core/src/format";
import { mode, toast } from "../store";
import { workerApi, type Progress, type InspectResult } from "../lib/worker";
import { backendApi } from "../lib/api";
import { generateThumbnail, type ThumbResult } from "../lib/thumbnail";
import { formatBytes, formatDate, downloadBlob, guessMime, getExtension } from "../lib/format";
import { ProgressBar, Empty } from "./ui";
import { FileDrop } from "./FileDrop";

export function FileTab() {
  const [encFile, setEncFile] = createSignal<File | null>(null);
  const [encPw, setEncPw] = createSignal("");
  const [encNote, setEncNote] = createSignal("");
  const [embedThumb, setEmbedThumb] = createSignal(true);
  const [thumb, setThumb] = createSignal<ThumbResult | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [progress, setProgress] = createSignal<Progress | null>(null);
  const [resultBlob, setResultBlob] = createSignal<Blob | null>(null);
  const [resultSize, setResultSize] = createSignal(0);

  const [decFile, setDecFile] = createSignal<File | null>(null);
  const [decPw, setDecPw] = createSignal("");
  const [decMeta, setDecMeta] = createSignal<InspectResult | null>(null);
  const [decBusy, setDecBusy] = createSignal(false);
  const [decBlob, setDecBlob] = createSignal<Blob | null>(null);

  async function pickEnc(files: File[]) {
    const f = files[0];
    setEncFile(f);
    setResultBlob(null);
    setThumb(null);
    if (f && embedThumb() && /image|video/.test(f.type)) setThumb(await generateThumbnail(f));
  }
  async function toggleThumb(v: boolean) {
    setEmbedThumb(v);
    if (v && encFile() && !thumb() && /image|video/.test(encFile()!.type)) setThumb(await generateThumbnail(encFile()!));
    if (!v) setThumb(null);
  }
  async function doEnc() {
    const f = encFile();
    if (!f) return toast("error", "请先选择文件");
    if (!encPw()) return toast("error", "请输入密码");
    setBusy(true);
    setProgress({ done: 0, total: f.size, phase: "准备中" });
    setResultBlob(null);
    try {
      const meta: FileMeta = {
        originalName: f.name,
        originalSize: f.size,
        mimeType: guessMime(f),
        extension: getExtension(f.name),
        createdAt: f.lastModified ? new Date(f.lastModified).toISOString() : new Date().toISOString(),
        encryptedAt: "",
        note: encNote(),
        ...(thumb() ? { thumbnailMime: thumb()!.mime, thumbnailW: thumb()!.width, thumbnailH: thumb()!.height } : {}),
      };
      const blob =
        mode() === "local"
          ? (await workerApi.encryptFile(f, encPw(), meta, thumb()?.bytes, setProgress)).blob
          : await backendApi.encryptFile(f, encPw(), meta, thumb()?.bytes);
      setResultBlob(blob);
      setResultSize(blob.size);
      toast("success", `加密完成 · ${formatBytes(blob.size)}`);
    } catch (e: any) {
      toast("error", e?.message || "加密失败");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }
  async function pickDec(files: File[]) {
    const f = files[0];
    setDecFile(f);
    setDecMeta(null);
    setDecBlob(null);
    setDecPw("");
    if (!f) return;
    try {
      setDecMeta(mode() === "local" ? await workerApi.inspectFile(f) : await backendApi.inspect(f));
    } catch (e: any) {
      toast("error", "无法读取文件头：" + (e?.message || ""));
    }
  }
  async function doDec() {
    const f = decFile();
    if (!f) return toast("error", "请选择加密文件");
    if (!decPw()) return toast("error", "请输入密码");
    setDecBusy(true);
    setDecBlob(null);
    try {
      const blob =
        mode() === "local"
          ? (await workerApi.decryptFile(f, decPw())).blob
          : await backendApi.decryptFile(f, decPw());
      setDecBlob(blob);
      toast("success", `解密完成 · ${formatBytes(blob.size)}`);
    } catch (e: any) {
      toast("error", "解密失败：" + (e?.message || "密码错误"));
    } finally {
      setDecBusy(false);
    }
  }

  const modeLabel = createMemo(() => (mode() === "local" ? "前端本地" : "后端服务"));

  return (
    <div class="grid lg:grid-cols-2 gap-4">
      {/* ENCRYPT */}
      <div class="surface p-5">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-[15px] font-semibold text-[var(--color-fg)]">文件加密</h2>
          <span class="text-[11px] text-[var(--color-muted)]">流式分片处理</span>
        </div>
        <FileDrop
          zone="encrypt"
          icon="🔒"
          label={encFile() ? encFile()!.name : "选择文件"}
          hint={encFile() ? `${formatBytes(encFile()!.size)} · ${guessMime(encFile()!)}` : "任意类型 · 支持大文件"}
          onFiles={pickEnc}
        />

        <Show when={encFile()}>
          <div class="mt-4 space-y-3">
            <div>
              <label class="label">加密密码</label>
              <input class="input" type="password" placeholder="输入密码" value={encPw()} onInput={(e) => setEncPw(e.target.value)} />
            </div>
            <div>
              <label class="label">备注（可选，写入文件头）</label>
              <input class="input" placeholder="例如：项目设计稿 v2" value={encNote()} onInput={(e) => setEncNote(e.target.value)} />
            </div>
            <label class="flex items-center gap-2 text-[13px] text-[var(--color-fg-secondary)] cursor-pointer">
              <input type="checkbox" class="w-4 h-4 accent-[var(--color-accent)]" checked={embedThumb()} onChange={(e) => toggleThumb(e.target.checked)} />
              嵌入缩略图（图片/视频自动生成）
            </label>

            <Show when={thumb()}>
              <div class="flex items-center gap-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] p-3">
                <img
                  src={`data:${thumb()!.mime};base64,${btoa(String.fromCharCode(...thumb()!.bytes))}`}
                  class="w-14 h-14 rounded-lg object-cover border border-[var(--color-border)]"
                  alt=""
                />
                <div class="text-[12px] text-[var(--color-muted)]">
                  <div class="text-[var(--color-fg)] font-medium">{thumb()!.width}×{thumb()!.height}</div>
                  <div>{formatBytes(thumb()!.bytes.length)}</div>
                  <div class="text-[var(--color-success)] mt-0.5">将嵌入文件头，可免密预览</div>
                </div>
              </div>
            </Show>

            <Show when={progress()}>
              <ProgressBar done={progress()!.done} total={progress()!.total} phase={progress()!.phase} />
            </Show>

            <div class="flex gap-2">
              <button class="btn btn-primary flex-1" disabled={busy()} onClick={doEnc}>
                {busy() ? "加密中…" : "加密文件"}
              </button>
              <Show when={resultBlob()}>
                <button class="btn btn-ghost" onClick={() => downloadBlob(resultBlob()!, encFile()!.name + ".enc")}>
                  下载 .enc
                </button>
              </Show>
            </div>

            <Show when={resultBlob()}>
              <div class="grid grid-cols-2 gap-2">
                <div class="stat"><span class="stat-k">原始</span><span class="stat-v">{formatBytes(encFile()!.size)}</span></div>
                <div class="stat"><span class="stat-k">密文</span><span class="stat-v">{formatBytes(resultSize())}</span></div>
              </div>
            </Show>

            <div class="text-[11px] text-[var(--color-muted)]">
              {modeLabel()} · {mode() === "local" ? "明文不离开浏览器" : "上传至 Bun 后端"}
            </div>
          </div>
        </Show>
      </div>

      {/* DECRYPT */}
      <div class="surface p-5">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-[15px] font-semibold text-[var(--color-fg)]">文件解密 / 预览</h2>
          <span class="text-[11px] text-[var(--color-muted)]">免密读取文件头</span>
        </div>
        <FileDrop
          zone="decrypt"
          icon="🔓"
          label={decFile() ? decFile()!.name : "选择 .enc 文件"}
          hint={decFile() ? formatBytes(decFile()!.size) : "选中后显示文件头信息"}
          onFiles={pickDec}
        />

        <Show when={!decMeta() && decFile()}>
          <Empty>正在读取文件头…</Empty>
        </Show>

        <Show when={decMeta()}>
          <div class="mt-4 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] p-4">
            <div class="flex gap-3">
              <Show
                when={decMeta()!.thumbnailBase64}
                fallback={
                  <div class="w-16 h-16 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-muted-light)] text-xs">
                    无图
                  </div>
                }
              >
                <img
                  src={`data:image/jpeg;base64,${decMeta()!.thumbnailBase64}`}
                  class="w-16 h-16 rounded-lg object-cover border border-[var(--color-border)]"
                  alt=""
                />
              </Show>
              <div class="flex-1 grid grid-cols-2 gap-1.5">
                <div class="stat"><span class="stat-k">文件名</span><span class="stat-v">{decMeta()!.meta.originalName}</span></div>
                <div class="stat"><span class="stat-k">大小</span><span class="stat-v">{formatBytes(decMeta()!.meta.originalSize)}</span></div>
                <div class="stat"><span class="stat-k">类型</span><span class="stat-v">{decMeta()!.meta.mimeType}</span></div>
                <div class="stat"><span class="stat-k">加密时间</span><span class="stat-v">{formatDate(decMeta()!.meta.encryptedAt)}</span></div>
              </div>
            </div>
            <Show when={decMeta()!.meta.note}>
              <div class="mt-2 text-[12px] text-[var(--color-muted)]">
                <span class="text-[var(--color-muted-light)]">备注：</span>
                {decMeta()!.meta.note}
              </div>
            </Show>
            <div class="mt-2 text-[11px] text-[var(--color-success)]">↑ 免密读取，无需解密完整文件</div>
          </div>
        </Show>

        <Show when={decFile()}>
          <div class="mt-4 space-y-3">
            <div>
              <label class="label">解密密码</label>
              <input class="input" type="password" placeholder="输入密码" value={decPw()} onInput={(e) => setDecPw(e.target.value)} />
            </div>
            <div class="flex gap-2">
              <button class="btn btn-primary flex-1" disabled={decBusy()} onClick={doDec}>
                {decBusy() ? "解密中…" : "解密文件"}
              </button>
              <Show when={decBlob()}>
                <button class="btn btn-ghost" onClick={() => downloadBlob(decBlob()!, decMeta()?.meta.originalName || "decrypted")}>
                  下载原文件
                </button>
              </Show>
            </div>
            <div class="text-[11px] text-[var(--color-muted)]">{modeLabel()}</div>
          </div>
        </Show>
      </div>
    </div>
  );
}
