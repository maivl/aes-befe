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
    <div class="min-h-screen flex flex-col bg-[var(--color-bg)]">
      <Toasts />

      <header class="sticky top-0 z-40 border-b border-[var(--color-border)] bg-[var(--color-bg)]/80 backdrop-blur-lg">
        <div class="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div class="flex items-center gap-2.5">
            <img src="/favicon.svg" class="w-8 h-8 rounded-lg" alt="logo" />
            <div>
              <div class="text-[15px] font-semibold text-[var(--color-fg)] leading-tight">加密核心</div>
              <div class="text-[11px] text-[var(--color-muted)] leading-tight">AES-256-GCM · Zig Wasm + .so</div>
            </div>
          </div>
          <div class="flex items-center gap-0.5 p-0.5 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)]">
            <button
              class={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all ${mode() === "local" ? "bg-[var(--color-accent)] text-white shadow-sm" : "text-[var(--color-muted)] hover:text-[var(--color-fg)]"}`}
              onClick={() => { setMode("local"); toast("info", "前端本地加密（隐私优先）"); }}
            >前端本地</button>
            <button
              class={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all ${mode() === "backend" ? "bg-[var(--color-accent)] text-white shadow-sm" : "text-[var(--color-muted)] hover:text-[var(--color-fg)]"}`}
              onClick={() => { setMode("backend"); toast("info", "后端服务加密（可控优先）"); }}
            >后端服务</button>
          </div>
        </div>
      </header>

      <main class="flex-1 max-w-3xl w-full mx-auto px-4 py-6">
        <div class="mb-6">
          <h1 class="text-2xl font-bold text-[var(--color-fg)] tracking-tight">一套 Zig 源码，双端 GCM 加密</h1>
          <p class="text-[13px] text-[var(--color-muted)] mt-1.5 leading-relaxed">
            统一 AES-256-GCM + PBKDF2-HMAC-SHA256 加密核心，AEAD 认证加密无需填充，支持大文件流式加密与文本加密。加密文件自带结构化元信息与内嵌缩略图，可免密预览。
          </p>
          <div class="flex flex-wrap items-center gap-2 mt-3">
            <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-[var(--color-surface-2)] text-[var(--color-fg-secondary)] border border-[var(--color-border)]">AES-256-GCM</span>
            <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-[var(--color-surface-2)] text-[var(--color-fg-secondary)] border border-[var(--color-border)]">PBKDF2 10万次</span>
            <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-[var(--color-surface-2)] text-[var(--color-fg-secondary)] border border-[var(--color-border)]">AEAD 认证加密</span>
            <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-[var(--color-surface-2)] text-[var(--color-fg-secondary)] border border-[var(--color-border)]">免密缩略图预览</span>
            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-[var(--color-surface-2)] text-[var(--color-fg-secondary)] border border-[var(--color-border)]">
              <span class={`w-1.5 h-1.5 rounded-full ${backendUp() ? "bg-[var(--color-success)]" : backendUp() === false ? "bg-[var(--color-danger)]" : "bg-[var(--color-muted-light)]"}`} />
              后端{backendUp() ? "在线" : backendUp() === false ? "离线" : "检测中"}
            </span>
          </div>
        </div>

        <div class="flex items-center gap-1 mb-5 p-1 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] w-full sm:w-auto sm:inline-flex">
          <For each={TABS}>
            {(t) => (
              <button class={`tab flex-1 sm:flex-initial ${tab() === t.id ? "tab-active" : ""}`} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            )}
          </For>
        </div>

        <Show when={tab() === "file"}><FileTab /></Show>
        <Show when={tab() === "text"}><TextTab /></Show>
        <Show when={tab() === "inspect"}><InspectTab /></Show>
      </main>

      <footer class="mt-auto border-t border-[var(--color-border)]">
        <div class="max-w-3xl mx-auto px-4 py-4 flex flex-col sm:flex-row items-center justify-between gap-1.5 text-[11px] text-[var(--color-muted)]">
          <span>同一份 Zig 核心 · 前端 Wasm / 后端动态库 · 格式 100% 互通</span>
          <span class="font-mono">ENC1 / ENT1 · v2 GCM</span>
        </div>
      </footer>
    </div>
  );
}
