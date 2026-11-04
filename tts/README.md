# 發音引擎（Kitten TTS nano 0.8 + onnxruntime-web）

這個目錄是字卡 🔊 用的語音引擎。**不在 app shell 預先快取裡**：使用者第一次按 🔊 並同意下載後才抓，
存在 Cache Storage `il-tts-v2`（見 docs/DESIGN.md §7）。由 `npm run build:tts`（tools/build-tts.mjs）產生，不要手改。

| 檔案 | 位元組 | sha256 |
|---|---|---|
| kitten_tts_nano_v0_8.onnx | 24369971 | f7b0afcbee92870b32b8e0276d855b954dc25470c9f051b376ac7eee537c76fc |
| voice.f32 | 409600 | 5e0b649453ac74ca91dfc6730fb318567fc34a24bca9e910cdb39f07e611a83f |
| ort.wasm.min.mjs | 49856 | d27154a28588534b4343f9f935c1a555a1f84784e5677d9d356fcb732a815757 |
| ort-wasm-simd-threaded.mjs | 20321 | c0bc2244e2c95fbf39a5eccb595bca31defb9eefdffa6f9ce0325a1c47524461 |
| ort-wasm-simd-threaded.wasm | 11815498 | 3260fcdb33b4fc4ec33e89caf392e13625823e01049d3bf32c38464f9dbfe14c |
| 合計（下載量） | 36665246 | |

另附授權檔（不下載到裝置）：LICENSE-KittenTTS（Apache-2.0）、LICENSE-onnxruntime（MIT）、ThirdPartyNotices-onnxruntime.txt。

## 來源
- **語音模型**：Kitten TTS nano 0.8 int8（StyleTTS 2 架構的 ONNX 模型，約 15M 參數）
  - https://huggingface.co/KittenML/kitten-tts-nano-0.8-int8（revision `84781d74e29ee25217551556398b42f80593a813`）：`kitten_tts_nano_v0_8.onnx` 原檔，沒有修改；
    `voice.f32` 是同一 revision 的 `voices.npz` 裡 `expr-voice-2-m` 這一個聲音（400×256 float32，little-endian，原值照抄）。
  - 程式碼與推論方式：https://github.com/KittenML/KittenTTS（commit `b9517e3050adced306219f8bea5f117d87ecfaa7`）。我們**不用**它的文字前處理與 phonemizer，
    直接輸入自己產生的 IPA（app/js/speech-text.js）。速度輸入用 config.json 對這個聲音的 speed prior（0.8）。
  - 授權：模型權重與程式碼都是 Apache-2.0（LICENSE-KittenTTS）。訓練資料 KittenML 沒有公開。
- **推論引擎**：onnxruntime-web 1.23.0（https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.23.0.tgz 的 `dist/`；原始碼 https://github.com/microsoft/onnxruntime，tag v1.23.0），
  `ort.wasm.min.mjs`、`ort-wasm-simd-threaded.mjs`、`ort-wasm-simd-threaded.wasm` 原檔，沒有修改。
  授權 MIT（LICENSE-onnxruntime），第三方元件聲明見 ThirdPartyNotices-onnxruntime.txt。
