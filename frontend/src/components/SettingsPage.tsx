import { createSignal, For, onMount, Show } from "solid-js";
import { listOPFSFiles, deleteOPFSFile, clearOPFS, getOPFSUsage, getOPFSFile, isOPFSAvailable, type OPFSFile } from "../lib/opfs-manager";
import { shareFile } from "../lib/share";
import { formatBytes, formatDate } from "../lib/format";
import { toast } from "../store";
import { ArrowLeft, Share2, Trash2, HardDrive, RefreshCw } from "lucide-solid";

export function SettingsPage(props: { onBack: () => void }) {
  const [files, setFiles] = createSignal<OPFSFile[]>([]);
  const [usage, setUsage] = createSignal(0);
  const [loading, setLoading] = createSignal(true);

  async function refresh() {
    setLoading(true);
    if (isOPFSAvailable()) {
      setFiles(await listOPFSFiles());
      setUsage(await getOPFSUsage());
    }
    setLoading(false);
  }

  onMount(refresh);

  async function handleShare(f: OPFSFile) {
    const file = await getOPFSFile(f.name);
    if (file) await shareFile(file);
  }

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

  return (
    <div class="min-h-screen flex flex-col">
      {/* Header */}
      <header class="fixed top-0 left-0 right-0 z-40 border-b border-[var(--color-border)] bg-[var(--color-bg)]/90 backdrop-blur-lg">
        <div class="max-w-3xl mx-auto px-4 flex items-center justify-between gap-3" style={{ "padding-top": "max(0.75rem, env(safe-area-inset-top))", "padding-bottom": "0.75rem" }}>
          <div class="flex items-center gap-2.5">
            <button class="p-1.5 rounded-lg hover:bg-[var(--color-surface-2)] transition-colors text-[var(--color-muted)]" onClick={props.onBack}>
              <ArrowLeft size={20} />
            </button>
            <div class="flex items-center gap-2">
              <HardDrive size={18} class="text-[var(--color-accent)]" />
              <span class="text-[15px] font-semibold text-[var(--color-fg)]">OPFS 文件管理</span>
            </div>
          </div>
          <button class="p-2 rounded-lg hover:bg-[var(--color-surface-2)] transition-colors text-[var(--color-muted)]" onClick={refresh} title="刷新">
            <RefreshCw size={18} />
          </button>
        </div>
      </header>
      <div style={{ height: "calc(3.5rem + env(safe-area-inset-top))" }} />

      {/* Content */}
      <main class="flex-1 max-w-3xl w-full mx-auto px-4 py-6">
        <Show when={!isOPFSAvailable()}>
          <div class="text-center text-[14px] text-[var(--color-muted)] py-12">
            当前浏览器不支持 OPFS（需要 iOS Safari 15.2+ 或 Chrome 102+）
          </div>
        </Show>

        <Show when={isOPFSAvailable()}>
          {/* Usage summary */}
          <div class="surface p-4 mb-4">
            <div class="flex items-center justify-between">
              <div>
                <div class="text-[12px] text-[var(--color-muted)]">存储用量</div>
                <div class="text-[20px] font-bold text-[var(--color-fg)] mt-0.5">{formatBytes(usage())}</div>
              </div>
              <div class="text-right">
                <div class="text-[12px] text-[var(--color-muted)]">文件数</div>
                <div class="text-[20px] font-bold text-[var(--color-fg)] mt-0.5">{files().length}</div>
              </div>
            </div>
          </div>

          <Show when={loading()}>
            <div class="text-center text-[13px] text-[var(--color-muted)] py-8">加载中…</div>
          </Show>

          <Show when={!loading() && files().length === 0}>
            <div class="text-center text-[14px] text-[var(--color-muted)] py-12">
              OPFS 为空
              <div class="text-[12px] mt-1">加密或解密文件后，文件会自动保存到此处</div>
            </div>
          </Show>

          {/* File list */}
          <div class="space-y-2">
            <For each={files()}>
              {(f) => (
                <div class="surface p-3 flex items-center gap-3">
                  <div class="flex-1 min-w-0">
                    <div class="text-[13px] font-medium text-[var(--color-fg)] truncate">{f.name}</div>
                    <div class="text-[11px] text-[var(--color-muted)] mt-0.5">{formatBytes(f.size)} · {formatDate(new Date(f.lastModified).toISOString())}</div>
                  </div>
                  <button class="p-2.5 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-white transition-all" onClick={() => handleShare(f)} title="分享/下载">
                    <Share2 size={16} />
                  </button>
                  <button class="p-2.5 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-danger)] hover:bg-[var(--color-danger)] hover:text-white transition-all" onClick={() => handleDelete(f.name)} title="删除">
                    <Trash2 size={16} />
                  </button>
                </div>
              )}
            </For>
          </div>

          <Show when={files().length > 0}>
            <button class="btn btn-ghost w-full mt-4 text-[var(--color-danger)]" onClick={handleClear}>
              <Trash2 size={15} /> 清空全部
            </button>
          </Show>
        </Show>
      </main>
    </div>
  );
}
