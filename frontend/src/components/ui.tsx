import { For, type JSX, Show } from "solid-js";
import { toasts } from "../store";

export function ProgressBar(props: { done: number; total: number; phase?: string }) {
  const pct = () => (props.total > 0 ? Math.min(100, Math.round((props.done / props.total) * 100)) : 0);
  return (
    <div>
      <div class="flex justify-between text-[11px] text-[var(--color-muted)] mb-1">
        <span>{props.phase || "处理中"}</span><span class="font-mono">{pct()}%</span>
      </div>
      <div class="h-1.5 rounded-full bg-black/40 overflow-hidden">
        <div class="h-full rounded-full bg-[var(--color-accent)] transition-all duration-200" style={{ width: `${pct()}%` }} />
      </div>
    </div>
  );
}

export function Toasts() {
  return (
    <div class="fixed top-3 right-3 z-50 flex flex-col gap-1.5 max-w-xs">
      <For each={toasts()}>
        {(t) => (
          <div class={`px-3 py-2 rounded-md text-[12px] border ${
            t.type === "success" ? "bg-[var(--color-accent-dim)] border-[var(--color-accent)]/40 text-[var(--color-accent)]"
            : t.type === "error" ? "bg-rose-500/10 border-rose-500/40 text-rose-300"
            : "bg-sky-500/10 border-sky-500/40 text-sky-300"}`}>
            {t.message}
          </div>
        )}
      </For>
    </div>
  );
}

export function Empty(props: { children: JSX.Element }) {
  return <div class="text-[12px] text-[var(--color-muted)] py-6 text-center">{props.children}</div>;
}
