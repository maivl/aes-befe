import { createSignal, Show, For, onMount } from "solid-js";
import { mode, setMode, toast } from "./store";
import { backendApi } from "./lib/api";
import { FileTab } from "./components/FileTab";
import { TextTab } from "./components/TextTab";
import { InspectTab } from "./components/InspectTab";
import { Toasts } from "./components/ui";

type Tab = "file" | "text" | "inspect";
const TABS: { id: Tab; label: string }[] = [
  { id: "file", label: "文件加密" },
  { id: "text", label: "文本加密" },
  { id: "inspect", label: "密文预览" },
];

export default function App() {
  const [tab, setTab] = createSignal<Tab>("file");
  const [backendUp, setBackendUp] = createSignal<boolean | null>(null);

  onMount(async () => {
    try { await backendApi.health(); setBackendUp(true); } catch { setBackendUp(false); }
  });

  return (
    <div class="min-h-screen flex flex-col">
      <Toasts />

      {/* Header — slim, single row */}
      <header class="sticky top-0 z-40 border-b border-[var(--color-border)] bg-[var(--color-bg)]/90 backdrop-blur">
        <div class="max-w-5xl mx-auto px-4 py-2.5 flex items-center justify-between gap-3">
          <div class="flex items-center gap-2 min-w-0">
            <div class="w-6 h-6 rounded bg-[var(--color-accent)] flex items-center justify-center text-black text-[11px] font-bold">Z</div>
            <div class="min-w-0">
              <div class="text-[13px] font-semibold text-[var(--color-fg)] truncate">加密核心 · Zig</div>
              <div class="text-[10px] text-[var(--color-muted)] -mt-0.5 truncate">AES-256-CBC · Wasm + .so · 双端复用</div>
            </div>
          </div>
          <div class="flex items-center gap-1 p-0.5 rounded-md bg-black/40 border border-[var(--color-border)]">
            <button class={`px-2.5 py-1 rounded text-[12px] transition-colors ${mode() === "local" ? "bg-[var(--color-accent)] text-black font-medium" : "text-[var(--color-muted)] hover:text-[var(--color-fg)]"}`}
              onClick={() => { setMode("local"); toast("info", "前端本地加密（隐私优先）"); }}>前端本地</button>
            <button class={`px-2.5 py-1 rounded text-[12px] transition-colors ${mode() === "backend" ? "bg-[var(--color-accent)] text-black font-medium" : "text-[var(--color-muted)] hover:text-[var(--color-fg)]"}`}
              onClick={() => { setMode("backend"); toast("info", "后端服务加密（可控优先）"); }}>后端服务</button>
          </div>
        </div>
      </header>

      <main class="flex-1 max-w-5xl w-full mx-auto px-4 py-4">
        {/* Compact info strip */}
        <div class="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3 text-[11px] text-[var(--color-muted)]">
          <span class="text-[var(--color-fg)] font-medium">一套 Zig 源码 → Wasm + 动态库</span>
          <span>·</span><span>AES-256-CBC + PKCS7</span>
          <span>·</span><span>PBKDF2-HMAC-SHA256（10万次）</span>
          <span>·</span><span>流式分片 · 低内存</span>
          <span>·</span>
          <span>后端：<Show when={backendUp()} fallback={<Show when={backendUp() === false} fallback="检测中…"><span class="text-rose-400">离线</span></Show>}><span class="text-[var(--color-accent)]">在线</span></Show></span>
        </div>

        {/* Tabs */}
        <div class="flex items-center gap-1 mb-4">
          <For each={TABS}>
            {(t) => <button class={`tab ${tab() === t.id ? "tab-active" : "tab-idle"}`} onClick={() => setTab(t.id)}>{t.label}</button>}
          </For>
        </div>

        <Show when={tab() === "file"}><FileTab /></Show>
        <Show when={tab() === "text"}><TextTab /></Show>
        <Show when={tab() === "inspect"}><InspectTab /></Show>
      </main>

      <footer class="mt-auto border-t border-[var(--color-border)]">
        <div class="max-w-5xl mx-auto px-4 py-2.5 flex flex-col sm:flex-row items-center justify-between gap-1 text-[11px] text-[var(--color-muted)]">
          <span>同一份 Zig 核心代码 · 前端 Wasm / 后端动态库 · 格式 100% 互通</span>
          <span class="font-mono">ENC1 / ENT1 · v1</span>
        </div>
      </footer>
    </div>
  );
}
