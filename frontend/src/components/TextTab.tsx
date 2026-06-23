import { createSignal, Show, createMemo } from "solid-js";
import { Type, Copy, ClipboardPaste, ArrowRightLeft, FileText, Cpu, Server } from "lucide-solid";
import { mode, toast } from "../store";
import { workerApi } from "../lib/worker";
import { backendApi } from "../lib/api";
import { formatDate } from "../lib/format";
import { Card, SectionTitle, Stat } from "./ui";

export function TextTab() {
  // encrypt
  const [text, setText] = createSignal("");
  const [tPw, setTPw] = createSignal("");
  const [tNote, setTNote] = createSignal("");
  const [enc, setEnc] = createSignal("");
  const [tBusy, setTBusy] = createSignal(false);

  // decrypt
  const [cipher, setCipher] = createSignal("");
  const [dPw, setDPw] = createSignal("");
  const [dec, setDec] = createSignal("");
  const [decMeta, setDecMeta] = createSignal<{ createdAt: string; note: string } | null>(null);
  const [dBusy, setDBusy] = createSignal(false);

  const modeLabel = createMemo(() => (mode() === "local" ? "前端本地加密" : "后端服务加密"));

  async function doEncryptText() {
    if (!text()) return toast("error", "请输入要加密的文本");
    if (!tPw()) return toast("error", "请输入密码");
    setTBusy(true);
    setEnc("");
    try {
      const data =
        mode() === "local"
          ? (await workerApi.encryptText(text(), tPw(), tNote())).data
          : (await backendApi.encryptText(text(), tPw(), tNote())).data;
      setEnc(data);
      toast("success", "文本加密完成");
    } catch (e: any) {
      toast("error", e?.message || "加密失败");
    } finally {
      setTBusy(false);
    }
  }

  async function doDecryptText() {
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
      toast("success", "文本解密完成");
    } catch (e: any) {
      toast("error", "解密失败：" + (e?.message || "密码错误"));
    } finally {
      setDBusy(false);
    }
  }

  async function copy(s: string) {
    try {
      await navigator.clipboard.writeText(s);
      toast("success", "已复制到剪贴板");
    } catch {
      toast("error", "复制失败");
    }
  }

  return (
    <div class="grid lg:grid-cols-2 gap-5">
      <Card>
        <SectionTitle icon={<Type size={18} />} title="文本加密" desc="ENT1 格式 · AES-256-CBC + PBKDF2" />
        <div class="space-y-3">
          <div>
            <label class="label">明文内容</label>
            <textarea
              class="input min-h-[120px] resize-y font-mono text-xs"
              placeholder="输入要加密的文本、备注、配置、密钥…"
              value={text()}
              onInput={(e) => setText(e.target.value)}
            />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="label">密码</label>
              <input class="input" type="password" placeholder="加密密码" value={tPw()} onInput={(e) => setTPw(e.target.value)} />
            </div>
            <div>
              <label class="label">备注 (可选)</label>
              <input class="input" placeholder="写入文件头" value={tNote()} onInput={(e) => setTNote(e.target.value)} />
            </div>
          </div>
          <button class="btn-primary w-full" disabled={tBusy()} onClick={doEncryptText}>
            <Show when={!tBusy()} fallback={<span class="animate-pulse">加密中…</span>}>
              <Type size={15} /> 加密文本
            </Show>
          </button>
          <Show when={enc()}>
            <div>
              <div class="flex items-center justify-between mb-1.5">
                <label class="label !mb-0">密文 (Base64)</label>
                <button class="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => copy(enc())}>
                  <Copy size={12} /> 复制
                </button>
              </div>
              <textarea class="input min-h-[100px] resize-y font-mono text-[11px] text-brand-300" readonly value={enc()} />
            </div>
          </Show>
          <div class="flex items-center gap-1.5 text-[11px] text-slate-500">
            {mode() === "local" ? <Cpu size={12} class="text-brand-500" /> : <Server size={12} class="text-brand-500" />}
            {modeLabel()}
          </div>
        </div>
      </Card>

      <Card>
        <SectionTitle icon={<ClipboardPaste size={18} />} title="文本解密" desc="粘贴 ENT1 密文，输入密码还原" />
        <div class="space-y-3">
          <div>
            <label class="label">密文 (Base64)</label>
            <textarea
              class="input min-h-[120px] resize-y font-mono text-[11px] text-brand-300"
              placeholder="粘贴 ENC… 或 ENT1… 开头的 Base64 密文"
              value={cipher()}
              onInput={(e) => setCipher(e.target.value)}
            />
          </div>
          <div>
            <label class="label">密码</label>
            <input class="input" type="password" placeholder="解密密码" value={dPw()} onInput={(e) => setDPw(e.target.value)} />
          </div>
          <button class="btn-primary w-full" disabled={dBusy()} onClick={doDecryptText}>
            <Show when={!dBusy()} fallback={<span class="animate-pulse">解密中…</span>}>
              <ArrowRightLeft size={15} /> 解密文本
            </Show>
          </button>
          <Show when={dec()}>
            <div>
              <div class="flex items-center justify-between mb-1.5">
                <label class="label !mb-0">明文结果</label>
                <button class="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => copy(dec())}>
                  <Copy size={12} /> 复制
                </button>
              </div>
              <textarea class="input min-h-[100px] resize-y font-mono text-xs" readonly value={dec()} />
            </div>
          </Show>
          <Show when={decMeta()}>
            <div class="grid grid-cols-2 gap-2">
              <Stat label="加密时间" value={formatDate(decMeta()!.createdAt)} />
              <Stat label="备注" value={decMeta()!.note || "—"} />
            </div>
          </Show>
          <div class="flex items-center gap-1.5 text-[11px] text-slate-500">
            <FileText size={12} class="text-brand-500" />
            双端格式完全互通，前端加密的文本可被后端解密，反之亦然
          </div>
        </div>
      </Card>
    </div>
  );
}
