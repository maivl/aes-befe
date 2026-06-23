import { For } from "solid-js";
import { toasts } from "../store";

export function ProgressBar(props: { done: number; total: number; phase?: string }) {
  const pct = () => (props.total > 0 ? Math.min(100, Math.round((props.done / props.total) * 100)) : 0);
  return (
    <div>
      <div class="flex justify-between text-[11px] text-[var(--color-muted)] mb-1">
        <span>{props.phase || "处理中"}</span>
        <span class="font-mono">{pct()}%</span>
      </div>
      <div class="h-1.5 rounded-full bg-[var(--color-surface-2)] overflow-hidden">
        <div
          class="h-full rounded-full bg-[var(--color-accent)] transition-all duration-200"
          style={{ width: `${pct()}%` }}
        />
      </div>
    </div>
  );
}

export function Toasts() {
  return (
    <div class="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      <For each={toasts()}>
        {(t) => (
          <div
            class={`px-3.5 py-2.5 rounded-xl text-[13px] border shadow-sm font-medium ${
              t.type === "success"
                ? "bg-[var(--color-bg)] border-[var(--color-success)]/30 text-[var(--color-success)]"
                : t.type === "error"
                ? "bg-[var(--color-bg)] border-[var(--color-danger)]/30 text-[var(--color-danger)]"
                : "bg-[var(--color-bg)] border-[var(--color-border-strong)] text-[var(--color-fg)]"
            }`}
          >
            {t.message}
          </div>
        )}
      </For>
    </div>
  );
}

export function Empty(props: { children: any }) {
  return <div class="text-[13px] text-[var(--color-muted)] py-6 text-center">{props.children}</div>;
}
