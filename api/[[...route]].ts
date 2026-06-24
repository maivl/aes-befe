// Vercel Edge Function (catch-all) — handles /api/encrypt/*, /api/decrypt/*, /api/inspect
// ALL crypto code is INLINED — no cross-directory imports (Vercel edge bundler requirement).
// Uses WebCrypto API (available in edge runtime). Produces byte-identical ciphertext
// to the Zig core (standard AES-256-GCM + PBKDF2-HMAC-SHA256).

const MAGIC_FILE = "ENC1";
const MAGIC_TEXT = "ENT1";
const VERSION = 2;
const FLAG_HAS_THUMB = 0x01;
const SALT_LEN = 16;
const NONCE_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
const PBKDF2_ITERS = 100_000;
const FILE_CHUNK_SIZE = 4 * 1024 * 1024;

const EMOJIS = ["😀","😃","😄","😁","😆","😅","😂","🤣","😊","😇","🙂","🙃","😉","😌","😍","🥰","😘","😗","😙","😚","😋","😛","😝","😜","🤪","🤨","🧐","🤓","😎","🤩","🥳","😏","😒","😞","😔","😟","😕","🙁","☹️","😣","😖","😫","😩","🥺","😢","😭","😤","😠","😡","🤬","🤯","😳","🥵","🥶","😱","😨","😰","😥","😓","🤗","🤔","🤭","🤫","🤥","😶","😐","😑","😬","🙄","😯","😦","😧","😮","😲","🥱","😴","🤤","😪","😵","🤐","🥴","🤢","🤮","🤧","😷","🤒","🤕","🤑","🤠","😈","👿","👹","👺","🤡","💩","👻"];

interface FileMeta { originalName: string; originalSize: number; mimeType: string; extension: string; createdAt: string; encryptedAt: string; note: string; thumbnailMime?: string; thumbnailW?: number; thumbnailH?: number; passwordEmoji?: string; }
interface TextMeta { createdAt: string; note: string; passwordEmoji?: string; }

const utf8E = (s: string) => new TextEncoder().encode(s);
const utf8D = (b: Uint8Array) => new TextDecoder().decode(b);
function concat(p: Uint8Array[]) { let t=0; for(const c of p)t+=c.length; const o=new Uint8Array(t); let i=0; for(const c of p){o.set(c,i);i+=c.length;} return o; }
function u32(n: number) { const b=new Uint8Array(4); b[0]=n&0xff;b[1]=(n>>>8)&0xff;b[2]=(n>>>16)&0xff;b[3]=(n>>>24)&0xff; return b; }
function r32(b: Uint8Array, o: number) { return (b[o]|(b[o+1]<<8)|(b[o+2]<<16)|(b[o+3]<<24))>>>0; }
function b64(bytes: Uint8Array) { let bin=""; for(let i=0;i<bytes.length;i+=0x8000) bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000) as any); return btoa(bin); }
function rb(n: number) { const o=new Uint8Array(n); crypto.getRandomValues(o); return o; }

async function pwEmoji(pw: Uint8Array) { const h=await crypto.subtle.digest("SHA-256",pw); const b=new Uint8Array(h); let s=0; for(const x of b)s+=x; return EMOJIS[s%EMOJIS.length]; }
async function deriveKey(pw: Uint8Array, salt: Uint8Array) { const k=await crypto.subtle.importKey("raw",pw,{name:"PBKDF2"},false,["deriveBits"]); return new Uint8Array(await crypto.subtle.deriveBits({name:"PBKDF2",salt,iterations:PBKDF2_ITERS,hash:"SHA-256"},k,256)); }
function chunkNonce(base: Uint8Array, idx: number) { const n=new Uint8Array(NONCE_LEN); n.set(base); n[8]^=idx&0xff;n[9]^=(idx>>>8)&0xff;n[10]^=(idx>>>16)&0xff;n[11]^=(idx>>>24)&0xff; return n; }
async function gcmEnc(key: Uint8Array, nonce: Uint8Array, pt: Uint8Array) { const k=await crypto.subtle.importKey("raw",key,{name:"AES-GCM"},false,["encrypt"]); const ct=await crypto.subtle.encrypt({name:"AES-GCM",iv:nonce,tagLength:128},k,pt); return new Uint8Array(ct); }
async function gcmDec(key: Uint8Array, nonce: Uint8Array, ct: Uint8Array) { const k=await crypto.subtle.importKey("raw",key,{name:"AES-GCM"},false,["decrypt"]); const pt=await crypto.subtle.decrypt({name:"AES-GCM",iv:nonce,tagLength:128},k,ct); return new Uint8Array(pt); }

async function* bytesGen(b: Uint8Array) { yield b; }

async function* encFile(meta: FileMeta, thumb: Uint8Array|undefined, pw: Uint8Array, pt: Uint8Array) {
  const salt=rb(SALT_LEN), baseNonce=rb(NONCE_LEN), key=await deriveKey(pw,salt);
  const emoji=await pwEmoji(pw);
  const m={...meta,encryptedAt:new Date().toISOString(),passwordEmoji:emoji};
  const hasThumb=!!thumb&&thumb.length>0; const json=utf8E(JSON.stringify(m));
  const pfx=new Uint8Array(8); pfx.set(utf8E(MAGIC_FILE),0); pfx[4]=VERSION; pfx[5]=hasThumb?FLAG_HAS_THUMB:0;
  yield pfx; yield u32(json.length); yield json; yield u32(hasThumb?thumb!.length:0);
  if(hasThumb) yield thumb!; yield salt; yield baseNonce; yield u32(FILE_CHUNK_SIZE);
  let off=0, idx=0;
  while(off<pt.length){ const len=Math.min(FILE_CHUNK_SIZE,pt.length-off); const ct=await gcmEnc(key,chunkNonce(baseNonce,idx),pt.subarray(off,off+len)); yield ct; off+=len; idx++; }
}

async function* decFile(pw: Uint8Array, ct: Uint8Array) {
  if(utf8D(ct.subarray(0,4))!==MAGIC_FILE) throw new Error("Not ENC1");
  if(ct[4]!==VERSION) throw new Error("Unsupported version");
  let o=8; const jl=r32(ct,o); o+=4; const meta=JSON.parse(utf8D(ct.subarray(o,o+jl))); o+=jl;
  const tl=r32(ct,o); o+=4; const thumb=tl>0?ct.subarray(o,o+tl):undefined; o+=tl;
  const salt=ct.subarray(o,o+SALT_LEN); o+=SALT_LEN; const baseNonce=ct.subarray(o,o+NONCE_LEN); o+=NONCE_LEN;
  const cs=r32(ct,o); o+=4; const key=await deriveKey(pw,salt);
  let rem=meta.originalSize, idx=0;
  while(rem>0){ const pl=Math.min(cs,rem); const cl=pl+TAG_LEN; if(o+cl>ct.length) throw new Error("EOF"); const pt=await gcmDec(key,chunkNonce(baseNonce,idx),ct.subarray(o,o+cl)); yield pt; o+=cl; rem-=pl; idx++; }
  (decFile as any).__meta=meta; (decFile as any).__thumb=thumb;
}

async function inspect(ct: Uint8Array) {
  if(utf8D(ct.subarray(0,4))!==MAGIC_FILE) throw new Error("Not ENC1");
  if(ct[4]!==VERSION) throw new Error("Unsupported version");
  let o=8; const jl=r32(ct,o); o+=4; const meta=JSON.parse(utf8D(ct.subarray(o,o+jl))); o+=jl;
  const tl=r32(ct,o); o+=4; const thumb=tl>0?ct.subarray(o,o+tl):undefined; o+=tl;
  o+=SALT_LEN+NONCE_LEN+4; return {meta,thumbnail:thumb,dataOffset:o};
}

async function encText(text: string, pw: Uint8Array, note: string) {
  const salt=rb(SALT_LEN), nonce=rb(NONCE_LEN), key=await deriveKey(pw,salt);
  const emoji=await pwEmoji(pw); const meta={createdAt:new Date().toISOString(),note,passwordEmoji:emoji};
  const json=utf8E(JSON.stringify(meta)); const ct=await gcmEnc(key,nonce,utf8E(text));
  const pfx=new Uint8Array(8); pfx.set(utf8E(MAGIC_TEXT),0); pfx[4]=VERSION;
  return concat([pfx,u32(json.length),json,salt,nonce,ct]);
}

async function decText(blob: Uint8Array, pw: Uint8Array) {
  if(utf8D(blob.subarray(0,4))!==MAGIC_TEXT) throw new Error("Not ENT1");
  if(blob[4]!==VERSION) throw new Error("Unsupported version");
  let o=8; const jl=r32(blob,o); o+=4; const meta=JSON.parse(utf8D(blob.subarray(o,o+jl))); o+=jl;
  const salt=blob.subarray(o,o+SALT_LEN); o+=SALT_LEN; const nonce=blob.subarray(o,o+NONCE_LEN); o+=NONCE_LEN;
  const key=await deriveKey(pw,salt); const pt=await gcmDec(key,nonce,blob.subarray(o));
  return {text:utf8D(pt),meta};
}

async function encTextB64(text: string, pw: Uint8Array, note: string) { return b64(await encText(text,pw,note)); }
async function decTextB64(d: string, pw: Uint8Array) { const bin=atob(d); const out=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i); return decText(out,pw); }

const CORS = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type"};
function json(d: unknown, s=200) { return new Response(JSON.stringify(d),{status:s,headers:{"Content-Type":"application/json",...CORS}}); }
const CORE_INFO = {algorithm:"AES-256-GCM (AEAD)",kdf:"PBKDF2-HMAC-SHA256",iterations:PBKDF2_ITERS,backend:"vercel-edge"};

export const config = { runtime: "edge" };
export default async function handler(req: Request): Promise<Response> {
  if(req.method==="OPTIONS") return new Response(null,{status:204,headers:CORS});
  const url=new URL(req.url); const path=url.pathname;
  try {
    if(path==="/api/health") return json({ok:true,core:CORE_INFO});
    if(path==="/api/encrypt/text"&&req.method==="POST"){const{text,password,note}=await req.json();if(typeof text!=="string"||typeof password!=="string")return json({error:"text and password required"},400);return json({data:await encTextB64(text,utf8E(password),note||"")});}
    if(path==="/api/decrypt/text"&&req.method==="POST"){const{data,password}=await req.json();if(typeof data!=="string"||typeof password!=="string")return json({error:"data and password required"},400);const{text,meta}=await decTextB64(data,utf8E(password));return json({text,meta});}
    if(path==="/api/inspect"&&req.method==="POST"){const form=await req.formData();const file=form.get("file") as File;if(!file)return json({error:"file required"},400);const bytes=new Uint8Array(await file.arrayBuffer());const{meta,thumbnail,dataOffset}=await inspect(bytes);const ht=!!thumbnail&&thumbnail.length>0;return json({meta,hasThumbnail:ht,thumbnailBase64:ht?b64(thumbnail!):undefined,dataOffset});}
    if(path==="/api/encrypt/file"&&req.method==="POST"){const form=await req.formData();const file=form.get("file") as File;const password=String(form.get("password")||"");const meta=JSON.parse(String(form.get("meta")||"{}")) as FileMeta;if(!file)return json({error:"file required"},400);if(!password)return json({error:"password required"},400);const fb=new Uint8Array(await file.arrayBuffer());let th:Uint8Array|undefined;const tf=form.get("thumbnail");if(tf instanceof File)th=new Uint8Array(await tf.arrayBuffer());const parts:Uint8Array[]=[];for await(const c of encFile(meta,th,utf8E(password),fb))parts.push(c);let t=0;for(const c of parts)t+=c.length;const out=new Uint8Array(t);let i=0;for(const c of parts){out.set(c,i);i+=c.length;}return new Response(out,{headers:{"Content-Type":"application/octet-stream","Content-Disposition":`attachment; filename="${encodeURIComponent((meta.originalName||"file")+".enc")}"","Content-Length":String(t),...CORS}});}
    if(path==="/api/decrypt/file"&&req.method==="POST"){const form=await req.formData();const file=form.get("file") as File;const password=String(form.get("password")||"");if(!file)return json({error:"file required"},400);if(!password)return json({error:"password required"},400);const bytes=new Uint8Array(await file.arrayBuffer());let meta:FileMeta;try{meta=(await inspect(bytes)).meta;}catch{meta={originalName:"decrypted.bin",originalSize:0,mimeType:"application/octet-stream",extension:"bin",createdAt:"",encryptedAt:"",note:""};}const parts:Uint8Array[]=[];for await(const c of decFile(utf8E(password),bytes))parts.push(c);let t=0;for(const c of parts)t+=c.length;const out=new Uint8Array(t);let i=0;for(const c of parts){out.set(c,i);i+=c.length;}return new Response(out,{headers:{"Content-Type":meta.mimeType||"application/octet-stream","Content-Disposition":`attachment; filename="${encodeURIComponent(meta.originalName||"decrypted.bin")}"`,"Content-Length":String(t),...CORS}});}
    return json({error:"Not found",path},404);
  } catch(e:any){return json({error:e?.message||String(e)},400);}
}
