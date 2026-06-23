import { createSignal, Show, For, onMount } from "solid-js";
import { ShieldCheck, Cpu, Server, Lock, Type, ScanSearch, Github, Zap, Eye, FileBox } from "lucide-solid";
import { mode, setMode, toast } from "./store";
import { backendApi } from "./lib/api";
import { FileTab } from "./components/FileTab";
import { TextTab } from "./components/TextTab";
import { InspectTab } from "./components/InspectTab";
import { Toasts } from "./components/ui";

type Tab = "file" | "text" | "inspect";

const TABS: { id: Tab; label: string; icon: any }[] = [
  { id: "file", label: "文件加密", icon: FileBox },
  { id: "text", label: "文本加密", icon: Type },
  { id: "inspect", label: "密文预览", icon: ScanSearch },
];

export default function App() {
  const [tab, setTab] = createSignal<Tab>("file");
  const [backendUp, setBackendUp] = createSignal<boolean | null>(null);

  onMount(async () => {
    try {
      await backendApi.health();
      setBackendUp(true);
    } catch {
      setBackendUp(false);
    }
  });

  return (
    <div class="min-h-screen flex flex-col bg-[#060a12] text-slate-200">
      <Toasts />

      {/* Background glow */}
      <div class="fixed inset-0 pointer-events-none overflow-hidden">
        <div class="absolute -top-40 -left-40 w-[40rem] h-[40rem] rounded-full bg-brand-500/10 blur-[120px]" />
        <div class="absolute top-1/3 -right-40 w-[35rem] h-[35rem] rounded-full bg-emerald-500/5 blur-[120px]" />
      </div>

      {/* Header */}
      <header class="sticky top-0 z-40 border-b border-white/5 bg-[#060a12]/80 backdrop-blur-xl">
        <div class="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <div class="flex items-center gap-2.5 min-w-0">
            <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center shadow-lg shadow-brand-500/30 flex-shrink-0">
              <ShieldCheck size={18} class="text-white" />
            </div>
            <div class="min-w-0">
              <div class="font-semibold text-slate-100 text-sm sm:text-base truncate">统一加密核心</div>
              <div class="text-[10px] sm:text-[11px] text-slate-500 -mt-0.5 truncate">AES-256-CBC · 双端流式 · 一套源码</div>
            </div>
          </div>

          {/* Mode toggle */}
          <div class="flex items-center gap-1 p-1 rounded-xl bg-black/40 border border-white/5">
            <button
              class={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all ${
                mode() === "local" ? "bg-brand-500 text-white shadow" : "text-slate-400 hover:text-slate-200"
              }`}
              onClick={() => {
                setMode("local");
                toast("info", "已切换：前端本地加密（隐私优先）");
              }}
            >
              <Cpu size={13} /> 前端本地
            </button>
            <button
              class={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all ${
                mode() === "backend" ? "bg-brand-500 text-white shadow" : "text-slate-400 hover:text-slate-200"
              }`}
              onClick={() => {
                setMode("backend");
                toast("info", "已切换：后端服务加密（可控优先）");
              }}
            >
              <Server size={13} /> 后端服务
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main class="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-5 relative">
        {/* Hero */}
        <div class="card p-5 mb-5 overflow-hidden relative">
          <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div class="flex-1">
              <h1 class="text-lg sm:text-xl font-bold text-slate-50">
                一套源码 · 双端复用 · 流式加密
              </h1>
              <p class="text-xs sm:text-sm text-slate-400 mt-1.5 leading-relaxed">
                统一 AES-256-CBC + PKCS7 + PBKDF2-HMAC-SHA256（10 万次迭代）加密核心，同时支持
                <span class="text-brand-300">超大文件流式加密</span> 与
                <span class="text-brand-300">文本加密</span>。加密文件自带结构化元信息与内嵌缩略图，可免密预览。
                前端 Wasm/Worker 与 Bun 后端动态库共用同一份核心代码，格式 100% 互通。
              </p>
              <div class="flex flex-wrap gap-1.5 mt-3">
                {[
                  { icon: Lock, t: "AES-256-CBC + PKCS7" },
                  { icon: Zap, t: "PBKDF2 100k 迭代" },
                  { icon: Eye, t: "免密缩略图预览" },
                  { icon: FileBox, t: "结构化文件头" },
                ].map((c) => (
                  <span class="chip bg-white/5 border border-white/10 text-slate-300">
                    <c.icon size={11} class="text-brand-400" /> {c.t}
                  </span>
                ))}
              </div>
            </div>
            <div class="flex-shrink-0 grid grid-cols-2 gap-2 lg:w-56">
              <div class="rounded-xl bg-black/30 border border-white/5 p-3">
                <div class="text-[10px] uppercase text-slate-500">当前模式</div>
                <div class="text-sm font-semibold text-brand-300 mt-0.5 flex items-center gap-1.5">
                  <Show when={mode() === "local"} fallback={<><Server size={13} /> 后端服务</>}>
                    <Cpu size={13} /> 前端本地
                  </Show>
                </div>
              </div>
              <div class="rounded-xl bg-black/30 border border-white/5 p-3">
                <div class="text-[10px] uppercase text-slate-500">后端服务</div>
                <div class={`text-sm font-semibold mt-0.5 flex items-center gap-1.5 ${backendUp() ? "text-emerald-400" : backendUp() === false ? "text-rose-400" : "text-slate-400"}`}>
                  <Show when={backendUp()} fallback={<Show when={backendUp() === false} fallback="检测中…"><span>离线</span></Show>}>
                    <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> 在线
                  </Show>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div class="flex items-center gap-1 p-1 rounded-xl bg-black/40 border border-white/5 w-full sm:w-auto sm:inline-flex mb-5 overflow-x-auto">
          <For each={TABS}>
            {(t) => (
              <button
                class={`flex-1 sm:flex-initial px-4 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-all whitespace-nowrap ${
                  tab() === t.id ? "bg-brand-500 text-white shadow" : "text-slate-400 hover:text-slate-200"
                }`}
                onClick={() => setTab(t.id)}
              >
                <t.icon size={15} /> {t.label}
              </button>
            )}
          </For>
        </div>

        {/* Tab content */}
        <Show when={tab() === "file"}><FileTab /></Show>
        <Show when={tab() === "text"}><TextTab /></Show>
        <Show when={tab() === "inspect"}><InspectTab /></Show>
      </main>

      {/* Footer */}
      <footer class="mt-auto border-t border-white/5 bg-[#060a12]/80 backdrop-blur-xl">
        <div class="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <div class="flex items-center gap-1.5">
            <ShieldCheck size={13} class="text-brand-500" />
            统一加密核心 · 同一份核心代码服务 Web 前端与 Bun 后端，双端格式完全互通
          </div>
          <div class="flex items-center gap-3">
            <span class="font-mono">ENC1 / ENT1 · v1</span>
            <span class="opacity-60">·</span>
            <span>跨平台 · 低内存流式</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
