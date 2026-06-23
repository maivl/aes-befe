import { For, type JSX, Show } from "solid-js";
import { toasts } from "../store";

export function Card(props: { class?: string; children: JSX.Element }) {
  return <div class={`card p-5 ${props.class || ""}`}>{props.children}</div>;
}

export function SectionTitle(props: { icon?: JSX.Element; title: string; desc?: string }) {
  return (
    <div class="mb-4">
      <div class="flex items-center gap-2 text-slate-100 font-semibold text-base">
        <Show when={props.icon}>
          <span class="text-brand-400">{props.icon}</span>
        </Show>
        {props.title}
      </div>
      <Show when={props.desc}>
        <p class="text-xs text-slate-500 mt-1">{props.desc}</p>
      </Show>
    </div>
  );
}

export function ProgressBar(props: { done: number; total: number; phase?: string }) {
  const pct = () => (props.total > 0 ? Math.min(100, Math.round((props.done / props.total) * 100)) : 0);
  return (
    <div>
      <div class="flex justify-between text-xs text-slate-400 mb-1.5">
        <span>{props.phase || "处理中"}</span>
        <span class="font-mono">{pct()}%</span>
      </div>
      <div class="h-2 rounded-full bg-white/5 overflow-hidden">
        <div
          class="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-400 transition-all duration-200"
          style={{ width: `${pct()}%` }}
        />
      </div>
    </div>
  );
}

export function Stat(props: { label: string; value: JSX.Element; mono?: boolean }) {
  return (
    <div class="rounded-xl bg-black/20 border border-white/5 px-3.5 py-2.5">
      <div class="text-[11px] uppercase tracking-wide text-slate-500">{props.label}</div>
      <div class={`text-sm text-slate-100 mt-0.5 ${props.mono ? "font-mono" : ""}`}>{props.value}</div>
    </div>
  );
}

export function Toasts() {
  return (
    <div class="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      <For each={toasts()}>
        {(t) => (
          <div
            class={`px-4 py-3 rounded-xl text-sm shadow-lg border backdrop-blur-xl animate-[slidein_.2s_ease] ${
              t.type === "success"
                ? "bg-brand-500/15 border-brand-500/30 text-brand-200"
                : t.type === "error"
                ? "bg-rose-500/15 border-rose-500/30 text-rose-200"
                : "bg-sky-500/15 border-sky-500/30 text-sky-200"
            }`}
          >
            {t.message}
          </div>
        )}
      </For>
    </div>
  );
}
