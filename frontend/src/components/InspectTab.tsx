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
    const f = files[0];
    if (!f) return;
    setFileName(f.name);
    setFileSize(f.size);
    setResult(null);
    setLoading(true);
    try {
      setResult(mode() === "local" ? await workerApi.inspectFile(f) : await backendApi.inspect(f));
      toast("success", "文件头读取成功");
    } catch (e: any) {
      toast("error", "读取失败：" + (e?.message || ""));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div class="surface p-5">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-[15px] font-semibold text-[var(--color-fg)]">密文预览</h2>
        <span class="text-[11px] text-[var(--color-muted)]">免密文件头检测</span>
      </div>
      <p class="text-[12px] text-[var(--color-muted)] mb-4 leading-relaxed">
        无需密码、无需加载完整文件，直接读取加密文件头元信息与内嵌缩略图。
      </p>
      <FileDrop
        zone="inspect"
        icon="🔍"
        label={fileName() || "选择 .enc 文件"}
        hint={fileName() ? formatBytes(fileSize()) : "用于列表预览、碎片文件识别"}
        onFiles={inspect}
      />

      <Show when={loading()}>
        <Empty>正在解析文件头…</Empty>
      </Show>

      <Show when={result()}>
        <div class="mt-4 space-y-3">
          <div class="flex flex-col sm:flex-row gap-4 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] p-4">
            <Show
              when={result()!.thumbnailBase64}
              fallback={
                <div class="w-24 h-24 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-muted-light)] text-xs">
                  无缩略图
                </div>
              }
            >
              <div class="flex flex-col items-center gap-1.5">
                <img
                  src={`data:image/jpeg;base64,${result()!.thumbnailBase64}`}
                  class="w-24 h-24 rounded-xl object-cover border border-[var(--color-border)]"
                  alt=""
                />
                <span class="text-[10px] font-medium text-[var(--color-success)]">内嵌缩略图</span>
              </div>
            </Show>
            <div class="flex-1 grid grid-cols-2 gap-1.5">
              <div class="stat"><span class="stat-k">文件名</span><span class="stat-v">{result()!.meta.originalName}</span></div>
              <div class="stat"><span class="stat-k">大小</span><span class="stat-v">{formatBytes(result()!.meta.originalSize)}</span></div>
              <div class="stat"><span class="stat-k">MIME</span><span class="stat-v">{result()!.meta.mimeType}</span></div>
              <div class="stat"><span class="stat-k">扩展名</span><span class="stat-v">{result()!.meta.extension || "—"}</span></div>
              <div class="stat"><span class="stat-k">密码指纹</span><span class="stat-v text-base">{result()!.meta.passwordEmoji || "—"}</span></div>
              <div class="stat"><span class="stat-k">加密时间</span><span class="stat-v">{formatDate(result()!.meta.encryptedAt)}</span></div>
              <div class="stat"><span class="stat-k">创建时间</span><span class="stat-v">{formatDate(result()!.meta.createdAt)}</span></div>
              <div class="stat"><span class="stat-k">数据偏移</span><span class="stat-v">{result()!.dataOffset} B</span></div>
            </div>
          </div>

          <Show when={result()!.meta.note}>
            <div class="rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] p-3 text-[13px]">
              <span class="text-[11px] text-[var(--color-muted)] font-medium">备注</span>
              <div class="mt-0.5 text-[var(--color-fg)]">{result()!.meta.note}</div>
            </div>
          </Show>

          <div class="text-[12px] text-[var(--color-muted)] leading-relaxed">
            加密文件携带结构化元信息与缩略图。即便文件未下载完成或仅有碎片密文，也可识别内容类型与预览图。
          </div>
        </div>
      </Show>
    </div>
  );
}
