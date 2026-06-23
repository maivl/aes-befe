import { createSignal, type JSX } from "solid-js";

export function FileDrop(props: {
  zone?: string;
  label: string;
  hint?: string;
  onFiles: (files: File[]) => void;
  icon?: JSX.Element;
}) {
  const [drag, setDrag] = createSignal(false);
  let input: HTMLInputElement | undefined;
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); const f = Array.from(e.dataTransfer?.files || []); if (f.length) props.onFiles(f); }}
      onClick={() => input?.click()}
      class={`relative cursor-pointer rounded-md border border-dashed p-5 text-center transition-colors ${
        drag() ? "border-[var(--color-accent)] bg-[var(--color-accent-dim)]" : "border-[var(--color-border)] hover:border-[var(--color-muted)] hover:bg-white/[0.02]"
      }`}
    >
      <input ref={input} type="file" data-zone={props.zone} class="hidden" onChange={(e) => { const f = Array.from(e.target.files || []); if (f.length) props.onFiles(f); e.target.value = ""; }} />
      <div class="text-[var(--color-muted)] text-2xl mb-1">{props.icon ?? "⬆"}</div>
      <div class="text-[13px] text-[var(--color-fg)]">{props.label}</div>
      {props.hint && <div class="text-[11px] text-[var(--color-muted)] mt-0.5">{props.hint}</div>}
    </div>
  );
}
