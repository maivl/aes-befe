import { createSignal, Show } from "solid-js";
import { ScanSearch, Image as ImageIcon, FileQuestion, Sparkles } from "lucide-solid";
import { mode, toast } from "../store";
import { workerApi, type InspectResult } from "../lib/worker";
import { backendApi } from "../lib/api";
import { formatBytes, formatDate } from "../lib/format";
import { Card, SectionTitle, Stat } from "./ui";
import { FileDrop } from "./FileDrop";

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
      const r = mode() === "local" ? await workerApi.inspectFile(f) : await backendApi.inspect(f);
      setResult(r);
      toast("success", "文件头读取成功（免密）");
    } catch (e: any) {
      toast("error", "读取失败：" + (e?.message || "非 ENC1 文件"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <SectionTitle
        icon={<ScanSearch size={18} />}
        title="密文预览 · 免密文件头检测"
        desc="无需密码、无需加载完整文件，直接读取加密文件头元信息与内嵌缩略图"
      />
      <FileDrop
        zone="inspect"
        label={fileName() || "点击或拖入 .enc 加密文件"}
        hint={fileName() ? `${formatBytes(fileSize())}` : "用于加密文件列表预览、碎片文件识别"}
        onFiles={inspect}
        icon={<ScanSearch size={28} />}
      />

      <Show when={loading()}>
        <div class="mt-6 text-center text-sm text-slate-400 animate-pulse">正在解析文件头…</div>
      </Show>

      <Show when={result()}>
        <div class="mt-5 space-y-4">
          <div class="flex flex-col sm:flex-row gap-5 rounded-2xl bg-black/30 border border-white/5 p-5">
            <Show when={result()!.thumbnailBase64}>
              <div class="flex flex-col items-center gap-2">
                <img
                  src={`data:image/jpeg;base64,${result()!.thumbnailBase64}`}
                  class="w-36 h-36 rounded-xl object-cover border border-white/10 shadow-lg"
                  alt="缩略图"
                />
                <span class="chip bg-brand-500/15 text-brand-300">
                  <Sparkles size={11} /> 内嵌缩略图
                </span>
              </div>
            </Show>
            <Show when={!result()!.thumbnailBase64}>
              <div class="w-36 h-36 rounded-xl border border-white/10 bg-white/5 flex flex-col items-center justify-center gap-2">
                <FileQuestion size={30} class="text-slate-600" />
                <span class="text-[11px] text-slate-500">无缩略图</span>
              </div>
            </Show>
            <div class="flex-1 grid grid-cols-2 gap-2">
              <Stat label="原始文件名" value={result()!.meta.originalName} />
              <Stat label="原始大小" value={formatBytes(result()!.meta.originalSize)} mono />
              <Stat label="MIME 类型" value={result()!.meta.mimeType} />
              <Stat label="扩展名" value={result()!.meta.extension || "—"} />
              <Stat label="原文件创建时间" value={formatDate(result()!.meta.createdAt)} />
              <Stat label="加密时间" value={formatDate(result()!.meta.encryptedAt)} />
              <Stat label="密文数据偏移" value={`${result()!.dataOffset} 字节`} mono />
              <Stat label="含缩略图" value={result()!.hasThumbnail ? "是" : "否"} />
            </div>
          </div>

          <Show when={result()!.meta.note}>
            <div class="rounded-xl bg-brand-500/5 border border-brand-500/15 p-3.5 text-sm text-slate-200">
              <span class="text-xs text-brand-400 font-medium">备注</span>
              <div class="mt-1">{result()!.meta.note}</div>
            </div>
          </Show>

          <div class="rounded-xl bg-white/[0.02] border border-white/5 p-3.5 text-xs text-slate-400 leading-relaxed">
            <div class="flex items-center gap-1.5 text-slate-300 mb-1.5">
              <ImageIcon size={13} class="text-brand-400" /> 密文可视化预览
            </div>
            该加密文件携带完整的结构化元信息与缩略图。即便文件未下载完成、或仅有碎片密文，
            也可直接识别其内容类型与预览图——传统加密文件完全黑盒，本方案支持「密文可视化预览」。
          </div>
        </div>
      </Show>
    </Card>
  );
}
