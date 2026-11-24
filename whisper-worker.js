// Roda o Whisper (transcrição de voz) dentro do celular, separado da tela para não travar o app.
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/dist/transformers.min.js';

env.allowLocalModels = false; // o modelo vem da internet na 1ª vez e fica guardado no celular
let asr = null, atual = '';

self.onmessage = async ({ data: m }) => {
  try {
    if (m.tipo === 'carregar') {
      if (!asr || atual !== m.modelo) {
        asr = null;
        asr = await pipeline('automatic-speech-recognition', m.modelo, {
          dtype: 'q8', device: 'wasm',
          progress_callback: p => self.postMessage({ tipo: 'progresso', p: { status: p.status, file: p.file, loaded: p.loaded, total: p.total } })
        });
        atual = m.modelo;
      }
      self.postMessage({ id: m.id, ok: true });
    } else if (m.tipo === 'parte') {
      const r = await asr(m.audio, { language: 'portuguese', task: 'transcribe' });
      self.postMessage({ id: m.id, texto: (r && r.text) || '' });
    }
  } catch (e) {
    self.postMessage({ id: m.id, erro: String((e && e.message) || e) });
  }
};
