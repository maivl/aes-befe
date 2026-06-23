// Live password → emoji preview. Computes SHA-256(password) → emoji async.
// Content-independent: same password always shows the same emoji, matching the
// emoji stored in the encrypted file header.
import { createSignal, createEffect } from "solid-js";
import { passwordToEmoji, utf8Encode } from "@crypto-core/src/format";

export function PasswordEmojiPreview(props: { password: string }) {
  const [emoji, setEmoji] = createSignal("");

  createEffect(() => {
    const pw = props.password;
    if (!pw) { setEmoji(""); return; }
    // debounced async compute
    let cancelled = false;
    const timer = setTimeout(async () => {
      const e = await passwordToEmoji(utf8Encode(pw));
      if (!cancelled) setEmoji(e);
    }, 150);
    // cleanup: if effect re-runs before timeout, clear it
    return () => { cancelled = true; clearTimeout(timer); };
  });

  return (
    <Show when={emoji()}>
      <span
        class="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] text-lg select-none"
        title="密码指纹（基于密码单向哈希，不可反向推导）"
      >
        {emoji()}
      </span>
    </Show>
  );
}

import { Show } from "solid-js";
