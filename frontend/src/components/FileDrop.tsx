import { createSignal, type JSX } from "solid-js";

export function FileDrop(props: {
  accept?: string;
  label: string;
  hint?: string;
  multiple?: boolean;
  zone?: string;
  onFiles: (files: File[]) => void;
  icon?: JSX.Element;
}) {
  const [drag, setDrag] = createSignal(false);
  let input: HTMLInputElement | undefined;

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDrag(false);
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length) props.onFiles(files);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={handleDrop}
      onClick={() => input?.click()}
      class={`relative cursor-pointer rounded-2xl border-2 border-dashed p-6 text-center transition-all ${
        drag() ? "border-brand-400 bg-brand-500/10" : "border-white/10 hover:border-white/20 hover:bg-white/[0.02]"
      }`}
    >
      <input
        ref={input}
        type="file"
        accept={props.accept}
        multiple={props.multiple}
        data-zone={props.zone}
        class="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (files.length) props.onFiles(files);
          e.target.value = "";
        }}
      />
      <div class="flex flex-col items-center gap-2">
        <div class={`text-3xl ${drag() ? "scale-110" : ""} transition-transform`}>
          {props.icon || <span class="opacity-60">📁</span>}
        </div>
        <div class="text-sm font-medium text-slate-200">{props.label}</div>
        {props.hint && <div class="text-xs text-slate-500">{props.hint}</div>}
      </div>
    </div>
  );
}
