import { createSignal } from "solid-js";
import { UploadCloud } from "lucide-solid";

export function FileDrop(props: {
  zone?: string;
  label: string;
  hint?: string;
  onFiles: (files: File[]) => void;
}) {
  const [drag, setDrag] = createSignal(false);
  let input: HTMLInputElement | undefined;
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = Array.from(e.dataTransfer?.files || []);
        if (f.length) props.onFiles(f);
      }}
      onClick={() => input?.click()}
      class={`dropzone ${drag() ? "dropzone-drag" : ""}`}
    >
      <input
        ref={input}
        type="file"
        data-zone={props.zone}
        class="hidden"
        onChange={(e) => {
          const f = Array.from(e.target.files || []);
          if (f.length) props.onFiles(f);
          e.target.value = "";
        }}
      />
      <UploadCloud size={32} class="text-[var(--color-muted-light)] mx-auto mb-2" />
      <div class="text-[14px] font-medium text-[var(--color-fg)]">{props.label}</div>
      {props.hint && <div class="text-[12px] text-[var(--color-muted)] mt-0.5">{props.hint}</div>}
    </div>
  );
}
