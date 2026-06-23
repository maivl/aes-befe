import { createSignal, Show, createMemo } from "solid-js";
import { Lock, Unlock, FileDown, Image as ImageIcon, Sparkles, ShieldCheck, Server, Cpu } from "lucide-solid";
import type { FileMeta } from "@crypto-core";
import { mode, toast } from "../store";
import { workerApi, type Progress, type InspectResult } from "../lib/worker";
import { backendApi } from "../lib/api";
import { generateThumbnail, type ThumbResult } from "../lib/thumbnail";
import { formatBytes, formatDate, downloadBlob, guessMime, getExtension } from "../lib/format";
import { Card, SectionTitle, ProgressBar, Stat } from "./ui";
import { FileDrop } from "./FileDrop";

export function FileTab() {
  // ---- encrypt state ----
  const [encFile, setEncFile] = createSignal<File | null>(null);
  const [encPw, setEncPw] = createSignal("");
  const [encNote, setEncNote] = createSignal("");
  const [embedThumb, setEmbedThumb] = createSignal(true);
  const [thumb, setThumb] = createSignal<ThumbResult | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [progress, setProgress] = createSignal<Progress | null>(null);
  const [resultBlob, setResultBlob] = createSignal<Blob | null>(null);
  const [resultSize, setResultSize] = createSignal(0);

  // ---- decrypt state ----
  const [decFile, setDecFile] = createSignal<File | null>(null);
  const [decPw, setDecPw] = createSignal("");
  const [decMeta, setDecMeta] = createSignal<InspectResult | null>(null);
  const [decBusy, setDecBusy] = createSignal(false);
  const [decProgress, setDecProgress] = createSignal<Progress | null>(null);
  const [decBlob, setDecBlob] = createSignal<Blob | null>(null);

  async function pickEncryptFile(files: File[]) {
    const f = files[0];
    setEncFile(f);
    setResultBlob(null);
    setThumb(null);
    if (f && embedThumb() && /image|video/.test(f.type)) {
      const t = await generateThumbnail(f);
      setThumb(t);
    }
  }

  async function toggleThumb(v: boolean) {
    setEmbedThumb(v);
    if (v && encFile() && !thumb() && /image|video/.test(encFile()!.type)) {
      const t = await generateThumbnail(encFile()!);
      setThumb(t);
    }
    if (!v) setThumb(null);
  }

  async function doEncrypt() {
    const f = encFile();
    const pw = encPw();
    if (!f) return toast("error", "请先选择文件");
    if (!pw) return toast("error", "请输入加密密码");
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
        ...(thumb()
          ? { thumbnailMime: thumb()!.mime, thumbnailW: thumb()!.width, thumbnailH: thumb()!.height }
          : {}),
      };
      let blob: Blob;
      if (mode() === "local") {
        blob = (
          await workerApi.encryptFile(f, pw, meta, thumb()?.bytes, (p) => setProgress(p))
        ).blob;
      } else {
        toast("info", "已上传至后端服务加密…");
        blob = await backendApi.encryptFile(f, pw, meta, thumb()?.bytes);
      }
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

  async function pickDecryptFile(files: File[]) {
    const f = files[0];
    setDecFile(f);
    setDecMeta(null);
    setDecBlob(null);
    setDecPw("");
    if (!f) return;
    // Inspect WITHOUT password — show metadata + thumbnail immediately
    try {
      const r = mode() === "local" ? await workerApi.inspectFile(f) : await backendApi.inspect(f);
      setDecMeta(r);
    } catch (e: any) {
      toast("error", "无法读取文件头：" + (e?.message || "未知错误"));
    }
  }

  async function doDecrypt() {
    const f = decFile();
    const pw = decPw();
    if (!f) return toast("error", "请先选择加密文件");
    if (!pw) return toast("error", "请输入解密密码");
    setDecBusy(true);
    setDecProgress({ done: 0, total: f.size, phase: "解密中" });
    setDecBlob(null);
    try {
      let blob: Blob;
      if (mode() === "local") {
        const res = await workerApi.decryptFile(f, pw, (p) => setDecProgress(p));
        blob = res.blob;
        if (!res.meta) {
          // recovered meta from worker
        }
      } else {
        blob = await backendApi.decryptFile(f, pw);
      }
      setDecBlob(blob);
      toast("success", `解密完成 · ${formatBytes(blob.size)}`);
    } catch (e: any) {
      toast("error", "解密失败：" + (e?.message || "密码错误或文件损坏"));
    } finally {
      setDecBusy(false);
      setDecProgress(null);
    }
  }

  const modeLabel = createMemo(() => (mode() === "local" ? "前端本地加密" : "后端服务加密"));

  return (
    <div class="grid lg:grid-cols-2 gap-5">
      {/* ENCRYPT */}
      <Card>
        <SectionTitle
          icon={<Lock size={18} />}
          title="文件加密"
          desc="分片流式 AES-256-CBC，自动写入文件头元信息与缩略图"
        />
        <FileDrop
          zone="encrypt"
          label={encFile() ? encFile()!.name : "点击或拖入文件"}
          hint={encFile() ? `${formatBytes(encFile()!.size)} · ${guessMime(encFile()!)}` : "支持任意类型，超大文件流式处理"}
          onFiles={pickEncryptFile}
          icon={<FileDown size={28} />}
        />

        <Show when={encFile()}>
          <div class="mt-4 space-y-3">
            <div>
              <label class="label">加密密码</label>
              <input class="input" type="password" placeholder="输入密码" value={encPw()} onInput={(e) => setEncPw(e.target.value)} />
            </div>
            <div>
              <label class="label">备注 (可选，写入文件头)</label>
              <input class="input" placeholder="例如：项目设计稿 v2" value={encNote()} onInput={(e) => setEncNote(e.target.value)} />
            </div>
            <label class="flex items-center gap-2.5 text-sm text-slate-300 cursor-pointer select-none">
              <input type="checkbox" class="accent-brand-500 w-4 h-4" checked={embedThumb()} onChange={(e) => toggleThumb(e.target.checked)} />
              <Sparkles size={15} class="text-brand-400" />
              嵌入缩略图预览（图片/视频自动生成）
            </label>
            <Show when={thumb()}>
              <div class="flex items-center gap-3 rounded-xl bg-black/30 border border-white/5 p-3">
                <img src={`data:${thumb()!.mime};base64,${btoa(String.fromCharCode(...thumb()!.bytes))}`} class="w-16 h-16 rounded-lg object-cover border border-white/10" alt="缩略图" />
                <div class="text-xs text-slate-400">
                  <div class="text-slate-200 font-medium">缩略图已生成</div>
                  <div>{thumb()!.width}×{thumb()!.height} · {formatBytes(thumb()!.bytes.length)}</div>
                  <div class="text-brand-400/80">将嵌入加密文件头，可免密预览</div>
                </div>
              </div>
            </Show>

            <Show when={progress()}>
              <ProgressBar done={progress()!.done} total={progress()!.total} phase={progress()!.phase} />
            </Show>

            <div class="flex gap-2">
              <button class="btn-primary flex-1" disabled={busy()} onClick={doEncrypt}>
                <Show when={!busy()} fallback={<span class="animate-pulse">加密中…</span>}>
                  <Lock size={15} /> 加密文件
                </Show>
              </button>
              <Show when={resultBlob()}>
                <button class="btn-ghost" onClick={() => downloadBlob(resultBlob()!, (encFile()!.name) + ".enc")}>
                  <FileDown size={15} /> 下载 .enc
                </button>
              </Show>
            </div>

            <Show when={resultBlob()}>
              <div class="grid grid-cols-2 gap-2">
                <Stat label="原始大小" value={formatBytes(encFile()!.size)} mono />
                <Stat label="密文大小" value={formatBytes(resultSize())} mono />
              </div>
            </Show>

            <div class="flex items-center gap-1.5 text-[11px] text-slate-500">
              <ShieldCheck size={12} class="text-brand-500" />
              {modeLabel()} · 明文{mode() === "local" ? "不离开浏览器" : "上传至 Bun 后端加密"}
            </div>
          </div>
        </Show>
      </Card>

      {/* DECRYPT */}
      <Card>
        <SectionTitle
          icon={<Unlock size={18} />}
          title="文件解密 / 预览"
          desc="选择 .enc 文件，免密读取文件头元信息与缩略图"
        />
        <FileDrop
          zone="decrypt"
          label={decFile() ? decFile()!.name : "点击或拖入 .enc 加密文件"}
          hint={decFile() ? formatBytes(decFile()!.size) : "选中后立即显示文件头信息"}
          onFiles={pickDecryptFile}
          icon={<Unlock size={28} />}
        />

        <Show when={decMeta()}>
          <div class="mt-4 rounded-xl bg-black/30 border border-white/5 p-4">
            <div class="flex gap-4">
              <Show when={decMeta()!.thumbnailBase64}>
                <img
                  src={`data:image/jpeg;base64,${decMeta()!.thumbnailBase64}`}
                  class="w-24 h-24 rounded-lg object-cover border border-white/10 flex-shrink-0"
                  alt="缩略图"
                />
              </Show>
              <Show when={!decMeta()!.thumbnailBase64}>
                <div class="w-24 h-24 rounded-lg border border-white/10 bg-white/5 flex items-center justify-center flex-shrink-0">
                  <ImageIcon size={26} class="text-slate-600" />
                </div>
              </Show>
              <div class="flex-1 grid grid-cols-2 gap-1.5 text-xs">
                <Stat label="原文件名" value={decMeta()!.meta.originalName} />
                <Stat label="原始大小" value={formatBytes(decMeta()!.meta.originalSize)} mono />
                <Stat label="MIME 类型" value={decMeta()!.meta.mimeType} />
                <Stat label="扩展名" value={decMeta()!.meta.extension || "—"} />
                <Stat label="创建时间" value={formatDate(decMeta()!.meta.createdAt)} />
                <Stat label="加密时间" value={formatDate(decMeta()!.meta.encryptedAt)} />
              </div>
            </div>
            <Show when={decMeta()!.meta.note}>
              <div class="mt-3 text-xs text-slate-400">
                <span class="text-slate-500">备注：</span>{decMeta()!.meta.note}
              </div>
            </Show>
            <div class="mt-2 text-[11px] text-brand-400/80 flex items-center gap-1">
              <Sparkles size={11} /> 以上信息免密读取，无需解密完整文件
            </div>
          </div>
        </Show>

        <Show when={decFile()}>
          <div class="mt-4 space-y-3">
            <div>
              <label class="label">解密密码</label>
              <input class="input" type="password" placeholder="输入密码" value={decPw()} onInput={(e) => setDecPw(e.target.value)} />
            </div>
            <Show when={decProgress()}>
              <ProgressBar done={decProgress()!.done} total={decProgress()!.total} phase={decProgress()!.phase} />
            </Show>
            <div class="flex gap-2">
              <button class="btn-primary flex-1" disabled={decBusy()} onClick={doDecrypt}>
                <Show when={!decBusy()} fallback={<span class="animate-pulse">解密中…</span>}>
                  <Unlock size={15} /> 解密文件
                </Show>
              </button>
              <Show when={decBlob()}>
                <button class="btn-ghost" onClick={() => downloadBlob(decBlob()!, decMeta()?.meta.originalName || "decrypted")}>
                  <FileDown size={15} /> 下载原文件
                </button>
              </Show>
            </div>
            <Show when={decBlob()}>
              <Stat label="解密输出" value={`${decMeta()?.meta.originalName || "file"} · ${formatBytes(decBlob()!.size)}`} mono />
            </Show>
            <div class="flex items-center gap-1.5 text-[11px] text-slate-500">
              {mode() === "local" ? <Cpu size={12} class="text-brand-500" /> : <Server size={12} class="text-brand-500" />}
              {modeLabel()}
            </div>
          </div>
        </Show>
      </Card>
    </div>
  );
}
