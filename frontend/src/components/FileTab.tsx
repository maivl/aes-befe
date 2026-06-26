import { createSignal, Show, createMemo, onCleanup } from "solid-js";
import type { FileMeta } from "@crypto-core/src/format";
import { mode, toast } from "../store";
import { workerApi, enableFilePicker, type Progress, type InspectResult } from "../lib/worker";
import { generateThumbnail, type ThumbResult } from "../lib/thumbnail";
import { formatBytes, formatDate, guessMime, getExtension } from "../lib/format";
import { shareFile, downloadFile } from "../lib/share";
import { getOPFSFile } from "../lib/opfs-manager";
import { ProgressBar, Empty } from "./ui";
import { FileDrop } from "./FileDrop";
import { PasswordEmojiPreview } from "./PasswordEmojiPreview";

export function FileTab() {
  const [encFile, setEncFile] = createSignal<File | null>(null);
  const [encPw, setEncPw] = createSignal("");
  const [encNote, setEncNote] = createSignal("");
  const [embedThumb, setEmbedThumb] = createSignal(true);
  const [thumb, setThumb] = createSignal<ThumbResult | null>(null);
  const [customThumbFile, setCustomThumbFile] = createSignal<File | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [progress, setProgress] = createSignal<Progress | null>(null);
  const [resultSize, setResultSize] = createSignal(0);
  const [encResultFile, setEncResultFile] = createSignal<File | null>(null);

  const [decFile, setDecFile] = createSignal<File | null>(null);
  const [decPw, setDecPw] = createSignal("");
  const [decMeta, setDecMeta] = createSignal<InspectResult | null>(null);
  const [decBusy, setDecBusy] = createSignal(false);
  const [decProgress, setDecProgress] = createSignal<Progress | null>(null);
  const [decPreviewUrl, setDecPreviewUrl] = createSignal<string | null>(null);
  const [decResultFile, setDecResultFile] = createSignal<File | null>(null);
  let previewCleanup: (() => Promise<void>) | null = null;
  onCleanup(() => { previewCleanup?.(); });

  async function pickEnc(files: File[]) {
    const f = files[0]; setEncFile(f); setEncResultFile(null); setThumb(null); setCustomThumbFile(null);
    if (f && embedThumb() && /image|video/.test(f.type)) setThumb(await generateThumbnail(f));
  }
  async function toggleThumb(v: boolean) {
    setEmbedThumb(v);
    if (v && encFile() && !thumb() && !customThumbFile() && /image|video/.test(encFile()!.type)) setThumb(await generateThumbnail(encFile()!));
    if (!v) { setThumb(null); setCustomThumbFile(null); }
  }
  async function pickCustomThumb(files: File[]) {
    const f = files[0]; if (!f) return;
    if (!f.type.startsWith("image/")) { toast("error", "请选择图片文件"); return; }
    setCustomThumbFile(f); const t = await generateThumbnail(f);
    if (t) { setThumb(t); toast("success", "自定义缩略图已设置"); } else toast("error", "缩略图生成失败");
  }

  // Share encrypted file — SYNCHRONOUS (pre-fetched File in signal)
  function shareEncrypted() {
    const file = encResultFile();
    if (!file) return;
    shareFile(file);
  }

  async function doEnc() {
    const f = encFile(); if (!f) return toast("error", "请先选择文件");
    if (!encPw()) return toast("error", "请输入密码");
    enableFilePicker();
    setBusy(true); setProgress({ done: 0, total: f.size, phase: "准备中" });
    setEncResultFile(null);
    try {
      const meta: FileMeta = {
        originalName: f.name, originalSize: f.size, mimeType: guessMime(f), extension: getExtension(f.name),
        createdAt: f.lastModified ? new Date(f.lastModified).toISOString() : new Date().toISOString(),
        encryptedAt: "", note: encNote(),
        ...(thumb() ? { thumbnailMime: thumb()!.mime, thumbnailW: thumb()!.width, thumbnailH: thumb()!.height } : {}),
      };
      const result = await workerApi.encryptFile(f, encPw(), meta, thumb()?.bytes, setProgress);
      const encName = (f.name || "file") + ".enc";
      if (result.opfsName) {
        // Pre-fetch File from OPFS for synchronous share
        const file = await getOPFSFile(result.opfsName);
        if (file) {
          const renamed = new File([file], encName, { type: "application/octet-stream" });
          setEncResultFile(renamed);
        }
        setResultSize(result.size);
        toast("success", `加密完成 · ${formatBytes(result.size)}`);
      } else if (result.blob) {
        const file = new File([result.blob], encName, { type: "application/octet-stream" });
        setEncResultFile(file);
        setResultSize(result.blob.size);
        toast("success", `加密完成 · ${formatBytes(result.blob.size)}`);
      }
    } catch (e: any) {
      if (e?.name === "AbortError") { toast("info", "已取消"); }
      else toast("error", e?.message || "加密失败");
    } finally { setBusy(false); setProgress(null); }
  }

  async function pickDec(files: File[]) {
    const f = files[0]; setDecFile(f); setDecMeta(null); setDecPreviewUrl(null); setDecPw(""); setDecProgress(null); setDecResultFile(null);
    if (!f) return;
    try { setDecMeta(await workerApi.inspectFile(f)); }
    catch (e: any) { toast("error", "无法读取文件头：" + (e?.message || "")); }
  }

  // Share decrypted file — SYNCHRONOUS (pre-fetched File in signal)
  function shareDecrypted() {
    const file = decResultFile();
    if (!file) return;
    shareFile(file);
  }

  async function doDec() {
    const f = decFile(); if (!f) return toast("error", "请选择加密文件");
    if (!decPw()) return toast("error", "请输入密码");
    enableFilePicker();
    setDecBusy(true); setDecPreviewUrl(null); setDecResultFile(null);
    if (previewCleanup) { try { await previewCleanup(); } catch {} previewCleanup = null; }
    setDecProgress({ done: 0, total: f.size, phase: "解密中" });
    try {
      const result = await workerApi.decryptFile(f, decPw(), (p) => setDecProgress(p));
      const mime = result.meta?.mimeType || "";
      const name = result.meta?.originalName || "decrypted";
      if (result.url) {
        setDecPreviewUrl(result.url);
        // Pre-fetch File from OPFS for synchronous share
        if (result.opfsName) {
          const file = await getOPFSFile(result.opfsName);
          if (file) {
            const renamed = new File([file], name, { type: mime || "application/octet-stream" });
            setDecResultFile(renamed);
          }
        }
        previewCleanup = async () => {
          URL.revokeObjectURL(result.url!);
          if (result.opfsName) {
            try { const root = await (navigator as any).storage.getDirectory(); await root.removeEntry(result.opfsName); } catch {}
          }
        };
        toast("success", `解密完成 · ${formatBytes(result.size)}`);
        if (/^image\/|^video\//.test(mime)) toast("info", mime.startsWith("video/") ? "视频预览已加载" : "图片预览已加载");
      } else if (result.blob) {
        const file = new File([result.blob], name, { type: mime || "application/octet-stream" });
        setDecResultFile(file);
        const url = URL.createObjectURL(result.blob);
        setDecPreviewUrl(url);
        previewCleanup = async () => URL.revokeObjectURL(url);
        toast("success", `解密完成 · ${formatBytes(result.blob.size)}`);
      }
    } catch (e: any) {
      if (e?.name === "AbortError") { toast("info", "已取消"); }
      else toast("error", "解密失败：" + (e?.message || "密码错误"));
    } finally { setDecBusy(false); setDecProgress(null); }
  }

  const modeLabel = createMemo(() => (mode() === "local" ? "前端本地" : "后端服务"));

  return (
    <div class="grid lg:grid-cols-2 gap-4">
      {/* ENCRYPT */}
      <div class="surface p-5" style="box-shadow: 0 20px 63px var(--color-teal-50);border: 1px solid var(--color-border);">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-[15px] font-semibold text-[var(--color-fg)]">文件加密</h2>
          <span class="text-[11px] text-[var(--color-muted)]">GCM · OPFS</span>
        </div>
        <FileDrop zone="encrypt" label={encFile() ? encFile()!.name : "选择文件"} hint={encFile() ? `${formatBytes(encFile()!.size)} · ${guessMime(encFile()!)}` : "任意类型 · OPFS 流式"} onFiles={pickEnc} />
        <Show when={encFile()}>
          <div class="mt-4 space-y-3">
            <div>
              <label class="label">加密密码</label>
              <div class="flex gap-2 items-center">
                <input class="input" type="password" placeholder="输入密码" value={encPw()} onInput={(e) => setEncPw(e.target.value)} />
                <PasswordEmojiPreview password={encPw()} />
              </div>
            </div>
            <div>
              <label class="label">备注（可选，写入文件头）</label>
              <input class="input" placeholder="例如：项目设计稿 v2" value={encNote()} onInput={(e) => setEncNote(e.target.value)} />
            </div>
            <label class="flex items-center gap-2 text-[13px] text-[var(--color-fg-secondary)] cursor-pointer">
              <input type="checkbox" class="w-4 h-4 accent-[var(--color-accent)]" checked={embedThumb()} onChange={(e) => toggleThumb(e.target.checked)} />
              嵌入缩略图（图片/视频自动生成或自定义上传）
            </label>
            <Show when={embedThumb()}>
              <div class="flex items-center gap-2">
                <button class="btn btn-ghost !py-1.5 !px-3 text-[12px]" onClick={() => {
                  const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*";
                  inp.onchange = () => { if (inp.files?.[0]) pickCustomThumb([inp.files[0]]); }; inp.click();
                }}>📎 上传自定义缩略图</button>
                <Show when={customThumbFile()}><span class="text-[11px] text-[var(--color-muted)] truncate max-w-[150px]">{customThumbFile()!.name}</span></Show>
              </div>
            </Show>
            <Show when={thumb()}>
              <div class="flex items-center gap-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] p-3">
                <img src={`data:${thumb()!.mime};base64,${btoa(String.fromCharCode(...thumb()!.bytes))}`} class="w-14 h-14 rounded-lg object-cover border border-[var(--color-border)]" alt="" />
                <div class="text-[12px] text-[var(--color-muted)]">
                  <div class="text-[var(--color-fg)] font-medium">{thumb()!.width}×{thumb()!.height}<Show when={customThumbFile()}><span class="text-[var(--color-accent)] ml-1">· 自定义</span></Show></div>
                  <div>{formatBytes(thumb()!.bytes.length)}</div>
                  <div class="text-[var(--color-success)] mt-0.5">将嵌入文件头，可免密预览</div>
                </div>
              </div>
            </Show>
            <Show when={progress()}><ProgressBar done={progress()!.done} total={progress()!.total} phase={progress()!.phase} /></Show>
            <div class="flex gap-2">
              <button class="btn btn-primary flex-1" disabled={busy()} onClick={doEnc}>{busy() ? "加密中…" : "加密文件"}</button>
              <Show when={encResultFile()}>
                <button class="btn btn-ghost" onClick={shareEncrypted}>分享</button>
              </Show>
            </div>
            <Show when={resultSize() > 0}>
              <div class="grid grid-cols-2 gap-2">
                <div class="stat"><span class="stat-k">原始</span><span class="stat-v">{formatBytes(encFile()!.size)}</span></div>
                <div class="stat"><span class="stat-k">密文</span><span class="stat-v">{formatBytes(resultSize())}</span></div>
              </div>
            </Show>
            <div class="text-[11px] text-[var(--color-muted)]">{modeLabel()} · OPFS 流式</div>
          </div>
        </Show>
      </div>

      {/* DECRYPT */}
      <div class="surface p-5">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-[15px] font-semibold text-[var(--color-fg)]">文件解密 / 预览</h2>
          <span class="text-[11px] text-[var(--color-muted)]">免密读取文件头</span>
        </div>
        <FileDrop zone="decrypt" label={decFile() ? decFile()!.name : "选择 .enc 文件"} hint={decFile() ? formatBytes(decFile()!.size) : "OPFS 流式解密"} onFiles={pickDec} />
        <Show when={!decMeta() && decFile()}><Empty>正在读取文件头…</Empty></Show>
        <Show when={decMeta()}>
          <div class="mt-4 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] p-4">
            <div class="flex gap-3 mb-3">
              <Show when={decMeta()!.thumbnailBase64} fallback={<div class="w-16 h-16 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-muted-light)] text-xs">无图</div>}>
                <img src={`data:image/jpeg;base64,${decMeta()!.thumbnailBase64}`} class="w-16 h-16 rounded-lg object-cover border border-[var(--color-border)]" alt="" />
              </Show>
              <div class="flex-1 min-w-0">
                <div class="text-[14px] font-medium text-[var(--color-fg)] truncate">{decMeta()!.meta.originalName}</div>
                <div class="text-[12px] text-[var(--color-muted)] mt-0.5">{formatBytes(decMeta()!.meta.originalSize)} · {decMeta()!.meta.mimeType}</div>
                <div class="flex items-center gap-2 mt-1.5">
                  <Show when={decMeta()!.meta.passwordEmoji}>
                    <span class="inline-flex items-center gap-1 text-[12px] text-[var(--color-muted)]">密码指纹 <span class="text-base">{decMeta()!.meta.passwordEmoji}</span></span>
                  </Show>
                  <span class="text-[11px] text-[var(--color-success)]">免密读取</span>
                </div>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-1.5">
              <div class="stat"><span class="stat-k">扩展名</span><span class="stat-v">{decMeta()!.meta.extension || "—"}</span></div>
              <div class="stat"><span class="stat-k">MIME</span><span class="stat-v">{decMeta()!.meta.mimeType}</span></div>
              <div class="stat"><span class="stat-k">创建时间</span><span class="stat-v">{formatDate(decMeta()!.meta.createdAt)}</span></div>
              <div class="stat"><span class="stat-k">加密时间</span><span class="stat-v">{formatDate(decMeta()!.meta.encryptedAt)}</span></div>
            </div>
            <Show when={decMeta()!.meta.note}>
              <div class="mt-2 text-[12px] text-[var(--color-muted)]"><span class="text-[var(--color-muted-light)]">备注：</span>{decMeta()!.meta.note}</div>
            </Show>
          </div>
        </Show>
        <Show when={decFile()}>
          <div class="mt-4 space-y-3">
            <div>
              <label class="label">解密密码</label>
              <div class="flex gap-2 items-center">
                <input class="input" type="password" placeholder="输入密码" value={decPw()} onInput={(e) => setDecPw(e.target.value)} />
                <PasswordEmojiPreview password={decPw()} />
              </div>
            </div>
            <Show when={decProgress()}><ProgressBar done={decProgress()!.done} total={decProgress()!.total} phase={decProgress()!.phase} /></Show>
            <div class="flex gap-2">
              <button class="btn btn-primary flex-1" disabled={decBusy()} onClick={doDec}>{decBusy() ? "解密中…" : "解密文件"}</button>
              <Show when={decResultFile()}>
                <button class="btn btn-ghost" onClick={shareDecrypted}>分享</button>
              </Show>
            </div>
            <Show when={decPreviewUrl()}>
              <div class="rounded-xl border border-[var(--color-border)] overflow-hidden bg-[var(--color-surface)]">
                <div class="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)]">
                  <span class="text-[12px] font-medium text-[var(--color-fg)]">解密预览</span>
                  <Show when={decResultFile()}>
                    <button class="text-[11px] text-[var(--color-accent)] hover:underline" onClick={shareDecrypted}>分享</button>
                  </Show>
                </div>
                <Show when={decMeta()?.meta.mimeType?.startsWith("image/")}>
                  <img src={decPreviewUrl()!} class="w-full max-h-[60vh] object-contain" alt="解密预览" />
                </Show>
                <Show when={decMeta()?.meta.mimeType?.startsWith("video/")}>
                  <video src={decPreviewUrl()!} class="w-full max-h-[60vh]" controls playsinline preload="auto" />
                </Show>
                <Show when={!decMeta()?.meta.mimeType?.startsWith("image/") && !decMeta()?.meta.mimeType?.startsWith("video/")}>
                  <div class="p-4 text-[12px] text-[var(--color-muted)]">非媒体文件，点击「分享」保存</div>
                </Show>
              </div>
            </Show>
            <div class="text-[11px] text-[var(--color-muted)]">{modeLabel()} · OPFS 流式</div>
          </div>
        </Show>
      </div>
    </div>
  );
}
