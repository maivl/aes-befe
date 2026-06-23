import { createSignal, Show } from "solid-js";
import { mode, toast } from "../store";
import { workerApi, type InspectResult } from "../lib/worker";
import { backendApi } from "../lib/api";
import { formatBytes, formatDate } from "../lib/format";
import { FileDrop } from "./FileDrop";
import { Empty } from "./ui";

export function InspectTab() {
  const [result, setResult] = createSignal<InspectResult | null>(null);
  const [fileName, setFileName] = createSignal("");
  const [fileSize, setFileSize] = createSignal(0);
  const [loading, setLoading] = createSignal(false);

  async function inspect(files: File[]) {
    const f = files[0]; if (!f) return;
    setFileName(f.name); setFileSize(f.size); setResult(null); setLoading(true);
    try { setResult(mode() === "local" ? await workerApi.inspectFile(f) : await backendApi.inspect(f)); toast("success", "文件头读取成功"); }
    catch (e: any) { toast("error", "读取失败：" + (e?.message || "")); }
    finally { setLoading(false); }
  }

  return (
    <div class="surface p-4">
      <div class="text-[13px] font-semibold mb-1">密文预览 · 免密文件头检测</div>
      <div class="text-[11px] text-[var(--color-muted)] mb-3">无需密码、无需加载完整文件，直接读取元信息与缩略图</div>
      <FileDrop zone="inspect" label={fileName() || "选择 .enc 文件"} hint={fileName() ? formatBytes(fileSize()) : "用于列表预览、碎片文件识别"} onFiles={inspect} icon="🔍" />
      <Show when={loading()}><Empty>正在解析文件头…</Empty></Show>
      <Show when={result()}>
        <div class="mt-3 space-y-3">
          <div class="flex flex-col sm:flex-row gap-3 rounded-md bg-black/30 border border-[var(--color-border)] p-3">
            <Show when={result()!.thumbnailBase64} fallback={<div class="w-24 h-24 rounded border border-[var(--color-border)] bg-white/5 flex items-center justify-center text-[var(--color-muted)] text-xs">无缩略图</div>}>
              <div class="flex flex-col items-center gap-1">
                <img src={`data:image/jpeg;base64,${result()!.thumbnailBase64}`} class="w-24 h-24 rounded object-cover border border-[var(--color-border)]" alt="" />
                <span class="text-[10px] text-[var(--color-accent)]">内嵌缩略图</span>
              </div>
            </Show>
            <div class="flex-1 grid grid-cols-2 gap-1">
              <div class="stat"><span class="stat-k">文件名</span><span class="stat-v">{result()!.meta.originalName}</span></div>
              <div class="stat"><span class="stat-k">大小</span><span class="stat-v">{formatBytes(result()!.meta.originalSize)}</span></div>
              <div class="stat"><span class="stat-k">MIME</span><span class="stat-v">{result()!.meta.mimeType}</span></div>
              <div class="stat"><span class="stat-k">扩展名</span><span class="stat-v">{result()!.meta.extension || "—"}</span></div>
              <div class="stat"><span class="stat-k">创建时间</span><span class="stat-v">{formatDate(result()!.meta.createdAt)}</span></div>
              <div class="stat"><span class="stat-k">加密时间</span><span class="stat-v">{formatDate(result()!.meta.encryptedAt)}</span></div>
              <div class="stat"><span class="stat-k">数据偏移</span><span class="stat-v">{result()!.dataOffset} B</span></div>
              <div class="stat"><span class="stat-k">含缩略图</span><span class="stat-v">{result()!.hasThumbnail ? "是" : "否"}</span></div>
            </div>
          </div>
          <Show when={result()!.meta.note}>
            <div class="rounded-md bg-[var(--color-accent-dim)] border border-[var(--color-accent)]/20 p-2.5 text-[12px]">
              <span class="text-[var(--color-accent)] text-[11px]">备注</span><div class="mt-0.5">{result()!.meta.note}</div>
            </div>
          </Show>
          <div class="text-[11px] text-[var(--color-muted)] leading-relaxed">加密文件携带结构化元信息与缩略图。即便文件未下载完成或仅有碎片密文，也可识别内容类型与预览图——传统加密文件完全黑盒，本方案支持密文可视化预览。</div>
        </div>
      </Show>
    </div>
  );
}
