import { createSignal } from "solid-js";

export type Mode = "local" | "backend";

const [mode, setMode] = createSignal<Mode>("local");
export { mode, setMode };

export interface Toast {
  id: number;
  type: "success" | "error" | "info";
  message: string;
}
const [toasts, setToasts] = createSignal<Toast[]>([]);
export { toasts };

let toastId = 1;
export function toast(type: Toast["type"], message: string) {
  const id = toastId++;
  setToasts((t) => [...t, { id, type, message }]);
  setTimeout(() => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, 3800);
}
