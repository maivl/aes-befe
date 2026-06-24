import { createSignal, Show, For, onMount } from "solid-js";
import { listOPFSFiles, deleteOPFSFile, clearOPFS, getOPFSUsage, isOPFSAvailable, type OPFSFile } from "../lib/opfs-manager";
import { shareOrDownload } from "../lib/share";
import { formatBytes, formatDate } from "../lib/format";
import { toast } from "../store";
import { X, Download, Trash2, HardDrive } from "lucide-solid";

export function SettingsDialog(props: { open: boolean; onClose: () => void }) {
  const [files, setFiles] = createSignal<OPFSFile[]>([]);
  const [usage, setUsage] = createSignal(0);

  async function refresh() {
    if (!isOPFSAvailable()) return;
    setFiles(await listOPFSFiles());
    setUsage(await getOPFSUsage());
  }

  onMount(() => { if (props.open) refresh(); });

  async function handleDelete(name: string) {
    await deleteOPFSFile(name);
    toast("success", `已删除 ${name}`);
    refresh();
  }

  async function handleClear() {
    await clearOPFS();
    toast("success", "已清空 OPFS");
    refresh();
  }

  async function handleDownload(name: string) {
    const file = await import("../lib/opfs-manager").then(m => m.getOPFSFile(name));
    if (file) await shareOrDownload(file, name);
  }

  return (
    <Show when={props.open}>
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={props.onClose}>
        <div class="bg-[var(--color-bg)] rounded-2xl border border-[var(--color-border)] shadow-xl w-full max-w-md max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <div class="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
            <div class="flex items-center gap-2">
              <HardDrive size={18} class="text-[var(--color-accent)]" />
              <h2 class="text-[15px] font-semibold text-[var(--color-fg)]">OPFS 文件管理</h2>
            </div>
            <button class="text-[var(--color-muted)] hover:text-[var(--color-fg)] transition-colors" onClick={props.onClose}>
              <X size={20} />
            </button>
          </div>

          {/* Body */}
          <div class="flex-1 overflow-y-auto px-5 py-4 min-h-0">
            <Show when={!isOPFSAvailable()}>
              <div class="text-center text-[13px] text-[var(--color-muted)] py-8">
                当前浏览器不支持 OPFS
              </div>
            </Show>

            <Show when={isOPFSAvailable()}>
              <div class="flex items-center justify-between mb-3 text-[12px] text-[var(--color-muted)]">
                <span>存储用量：{formatBytes(usage())}</span>
                <span>{files().length} 个文件</span>
              </div>

              <Show when={files().length === 0}>
                <div class="text-center text-[13px] text-[var(--color-muted)] py-8">
                  OPFS 为空
                </div>
              </Show>

              <div class="space-y-2">
                <For each={files()}>
                  {(f) => (
                    <div class="flex items-center gap-2 rounded-xl border border-[var(--color-border)] p-3 bg-[var(--color-surface)]">
                      <div class="flex-1 min-w-0">
                        <div class="text-[13px] font-medium text-[var(--color-fg)] truncate">{f.name}</div>
                        <div class="text-[11px] text-[var(--color-muted)]">{formatBytes(f.size)} · {formatDate(new Date(f.lastModified).toISOString())}</div>
                      </div>
                      <button class="p-2 rounded-lg hover:bg-[var(--color-surface-2)] transition-colors text-[var(--color-accent)]" onClick={() => handleDownload(f.name)} title="分享/下载">
                        <Download size={16} />
                      </button>
                      <button class="p-2 rounded-lg hover:bg-[var(--color-surface-2)] transition-colors text-[var(--color-danger)]" onClick={() => handleDelete(f.name)} title="删除">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>

          {/* Footer */}
          <Show when={isOPFSAvailable() && files().length > 0}>
            <div class="px-5 py-3 border-t border-[var(--color-border)]">
              <button class="btn btn-ghost w-full text-[var(--color-danger)]" onClick={handleClear}>
                <Trash2 size={15} /> 清空全部
              </button>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  );
}
