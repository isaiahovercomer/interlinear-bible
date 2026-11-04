// Pronunciation engine worker (module worker): Kitten TTS nano (ONNX, app/tts/) on onnxruntime-web
// (WebAssembly, one thread, no proxy worker) → Float32 PCM at 24 kHz.
// Message in:  {id, ipa}   (English-style IPA from speech-text.js)
// Message out: {id, pcm: Float32Array, rate} | {id, error}
// The model, voice table and .wasm come from Cache Storage when present (the app stores them there on download),
// otherwise from the network. The two .mjs files are imported by URL; the service worker answers those from the
// same cache (cache-first for tts/), so everything works offline after the download.
import { TTS_SPEED } from './tts-info.js';
import { SAMPLE_RATE, tokenIds, styleRow, trimSilence } from './tts-model.js';

const BASE = new URL('../tts/', import.meta.url);
const url = (f) => new URL(f, BASE).href;

async function bytes(f) {
  const res = (self.caches && await caches.match(url(f))) || await fetch(url(f));
  if (!res.ok) throw new Error(`${f}: HTTP ${res.status}`);
  return res.arrayBuffer();
}

let engine = null;
async function load() {
  const [ort, model, voice, wasm] = await Promise.all([
    import(url('ort.wasm.min.mjs')), bytes('kitten_tts_nano_v0_8.onnx'), bytes('voice.f32'), bytes('ort-wasm-simd-threaded.wasm')]);
  Object.assign(ort.env.wasm, { numThreads: 1, proxy: false, wasmBinary: wasm, wasmPaths: { mjs: url('ort-wasm-simd-threaded.mjs') } });
  ort.env.logLevel = 'error';
  const session = await ort.InferenceSession.create(new Uint8Array(model), { executionProviders: ['wasm'] });
  return { ort, session, voice: new Float32Array(voice) };
}

self.onmessage = async ({ data: { id, ipa } }) => {
  try {
    engine ??= load().catch((e) => { engine = null; throw e; });
    const { ort, session, voice } = await engine;
    const ids = tokenIds(ipa);
    const out = await session.run({
      input_ids: new ort.Tensor('int64', ids, [1, ids.length]),
      style: new ort.Tensor('float32', styleRow(voice, ipa).slice(), [1, 256]),
      speed: new ort.Tensor('float32', new Float32Array([TTS_SPEED]), [1]),
    });
    const pcm = trimSilence(out[session.outputNames[0]].data);
    self.postMessage({ id, pcm, rate: SAMPLE_RATE }, [pcm.buffer]);
  } catch (e) {
    self.postMessage({ id, error: String(e?.message || e) });
  }
};
