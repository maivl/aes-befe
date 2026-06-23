import { createSignal, Show, createMemo } from "solid-js";
import { mode, toast } from "../store";
import { workerApi } from "../lib/worker";
import { backendApi } from "../lib/api";
import { formatDate } from "../lib/format";

export function TextTab() {
  const [text, setText] = createSignal("");
  const [tPw, setTPw] = createSignal("");
  const [tNote, setTNote] = createSignal("");
  const [enc, setEnc] = createSignal("");
  const [tBusy, setTBusy] = createSignal(false);

  const [cipher, setCipher] = createSignal("");
  const [dPw, setDPw] = createSignal("");
  const [dec, setDec] = createSignal("");
  const [decMeta, setDecMeta] = createSignal<{ createdAt: string; note: string } | null>(null);
  const [dBusy, setDBusy] = createSignal(false);

  const modeLabel = createMemo(() => (mode() === "local" ? "前端本地" : "后端服务"));

  async function doEnc() {
    if (!text()) return toast("error", "请输入文本");
    if (!tPw()) return toast("error", "请输入密码");
    setTBusy(true);
    setEnc("");
    try {
      const data =
        mode() === "local"
          ? (await workerApi.encryptText(text(), tPw(), tNote())).data
          : (await backendApi.encryptText(text(), tPw(), tNote())).data;
      setEnc(data);
      toast("success", "加密完成");
    } catch (e: any) {
      toast("error", e?.message || "加密失败");
    } finally {
      setTBusy(false);
    }
  }

  async function doDec() {
    if (!cipher()) return toast("error", "请粘贴密文");
    if (!dPw()) return toast("error", "请输入密码");
    setDBusy(true);
    setDec("");
    setDecMeta(null);
    try {
      const r =
        mode() === "local"
          ? await workerApi.decryptText(cipher().trim(), dPw())
          : await backendApi.decryptText(cipher().trim(), dPw());
      setDec(r.text);
      setDecMeta(r.meta);
      toast("success", "解密完成");
    } catch (e: any) {
      toast("error", "解密失败：" + (e?.message || "密码错误"));
    } finally {
      setDBusy(false);
    }
  }

  async function copy(s: string) {
    try {
      await navigator.clipboard.writeText(s);
      toast("success", "已复制");
    } catch {
      toast("error", "复制失败");
    }
  }

  return (
    <div class="grid lg:grid-cols-2 gap-4">
      <div class="surface p-5">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-[15px] font-semibold text-[var(--color-fg)]">文本加密</h2>
          <span class="text-[11px] text-[var(--color-muted)]">ENT1 格式</span>
        </div>
        <div class="space-y-3">
          <div>
            <label class="label">明文</label>
            <textarea class="input min-h-[110px]" placeholder="输入要加密的文本…" value={text()} onInput={(e) => setText(e.target.value)} />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="label">密码</label>
              <input class="input" type="password" placeholder="密码" value={tPw()} onInput={(e) => setTPw(e.target.value)} />
            </div>
            <div>
              <label class="label">备注</label>
              <input class="input" placeholder="可选" value={tNote()} onInput={(e) => setTNote(e.target.value)} />
            </div>
          </div>
          <button class="btn btn-primary w-full" disabled={tBusy()} onClick={doEnc}>
            {tBusy() ? "加密中…" : "加密文本"}
          </button>
          <Show when={enc()}>
            <div>
              <div class="flex justify-between items-center mb-1.5">
                <label class="label !mb-0">密文 (Base64)</label>
                <button class="btn btn-ghost !px-2.5 !py-1 text-[11px]" onClick={() => copy(enc())}>复制</button>
              </div>
              <textarea class="input min-h-[90px]" readonly value={enc()} />
            </div>
          </Show>
          <div class="text-[11px] text-[var(--color-muted)]">{modeLabel()}</div>
        </div>
      </div>

      <div class="surface p-5">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-[15px] font-semibold text-[var(--color-fg)]">文本解密</h2>
          <span class="text-[11px] text-[var(--color-muted)]">双端互通</span>
        </div>
        <div class="space-y-3">
          <div>
            <label class="label">密文</label>
            <textarea class="input min-h-[110px]" placeholder="粘贴 ENT1… Base64 密文" value={cipher()} onInput={(e) => setCipher(e.target.value)} />
          </div>
          <div>
            <label class="label">密码</label>
            <input class="input" type="password" placeholder="密码" value={dPw()} onInput={(e) => setDPw(e.target.value)} />
          </div>
          <button class="btn btn-primary w-full" disabled={dBusy()} onClick={doDec}>
            {dBusy() ? "解密中…" : "解密文本"}
          </button>
          <Show when={dec()}>
            <div>
              <div class="flex justify-between items-center mb-1.5">
                <label class="label !mb-0">明文</label>
                <button class="btn btn-ghost !px-2.5 !py-1 text-[11px]" onClick={() => copy(dec())}>复制</button>
              </div>
              <textarea class="input min-h-[90px]" readonly value={dec()} />
            </div>
          </Show>
          <Show when={decMeta()}>
            <div class="grid grid-cols-2 gap-2">
              <div class="stat"><span class="stat-k">加密时间</span><span class="stat-v">{formatDate(decMeta()!.createdAt)}</span></div>
              <div class="stat"><span class="stat-k">备注</span><span class="stat-v">{decMeta()!.note || "—"}</span></div>
            </div>
          </Show>
          <div class="text-[11px] text-[var(--color-muted)]">前端加密可被后端解密，反之亦然</div>
        </div>
      </div>
    </div>
  );
}
