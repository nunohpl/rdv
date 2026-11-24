/* RDV – Transcrição grátis no próprio celular (Whisper, projeto aberto). */
'use strict';

const MODELOS = {
  base: { id: 'onnx-community/whisper-base', nome: 'Rápido', mb: 80 },
  small: { id: 'onnx-community/whisper-small', nome: 'Melhor qualidade', mb: 250 }
};
let wk = null, seq = 0;
const pend = {};
let trAtual = null; // { audioId, fase, pct, t0 }
let baixando = null; // { arquivos: {nome: {loaded,total}}, onUpd }

function trWorker() {
  if (!wk) {
    wk = new Worker('whisper-worker.js', { type: 'module' });
    wk.onmessage = ({ data }) => {
      if (data.tipo === 'progresso') return progressoDownload(data.p);
      const p = pend[data.id]; if (!p) return;
      delete pend[data.id];
      data.erro ? p.rej(new Error(data.erro)) : p.res(data);
    };
    wk.onerror = ev => { for (const k in pend) { pend[k].rej(new Error(ev.message || 'Erro no Whisper')); delete pend[k]; } wk = null; };
  }
  return wk;
}
function rpc(msg, transfer = []) {
  return new Promise((res, rej) => { const id = ++seq; pend[id] = { res, rej }; trWorker().postMessage({ ...msg, id }, transfer); });
}
function progressoDownload(p) {
  if (!baixando || p.status !== 'progress' || !p.file || !p.total) return;
  baixando.arquivos[p.file] = { loaded: p.loaded, total: p.total };
  const fs = Object.values(baixando.arquivos);
  const tot = fs.reduce((a, f) => a + f.total, 0), ok = fs.reduce((a, f) => a + f.loaded, 0);
  baixando.onUpd(`Baixando o Whisper (só na 1ª vez): ${Math.round(ok / 1048576)} de ~${Math.round(tot / 1048576)} MB`);
}
async function carregarModelo(chave, onUpd) {
  baixando = { arquivos: {}, onUpd };
  try { await rpc({ tipo: 'carregar', modelo: MODELOS[chave].id }); }
  finally { baixando = null; }
}
async function modeloBaixado(chave) {
  try {
    const c = await caches.open('transformers-cache');
    const ks = (await c.keys()).map(r => r.url);
    return ks.some(u => u.includes(MODELOS[chave].id) && u.includes('decoder'));
  } catch { return false; }
}
async function decodificar(blob) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC({ sampleRate: 16000 });
  try { const buf = await ac.decodeAudioData(await blob.arrayBuffer()); return buf.getChannelData(0).slice(); }
  finally { ac.close(); }
}
// O Whisper ouve até 30 s por vez. Corta o áudio em pedaços de 18 a 28 s, sempre na pausa mais silenciosa,
// para não partir uma palavra no meio.
function cortesNoSilencio(pcm) {
  const SR = 16000, MIN = 18 * SR, MAX = 28 * SR, JAN = Math.round(0.2 * SR);
  const cortes = [0];
  let ini = 0;
  while (pcm.length - ini > MAX) {
    let melhor = ini + MAX, menor = Infinity;
    for (let p = ini + MIN; p + JAN <= ini + MAX; p += JAN / 2) {
      let e = 0; for (let k = p; k < p + JAN; k += 4) e += pcm[k] * pcm[k];
      if (e < menor) { menor = e; melhor = p + JAN / 2; }
    }
    cortes.push(melhor); ini = melhor;
  }
  cortes.push(pcm.length);
  return cortes;
}
function atualizaTr() {
  if (!trAtual) return;
  const el = document.getElementById('tr-' + trAtual.audioId);
  if (el) el.textContent = `⏳ ${trAtual.fase} · ${fmtDur((Date.now() - trAtual.t0) / 1000)}`;
}
setInterval(atualizaTr, 1000);

async function transcreverAudio(audioId) {
  if (trAtual) return toast('Já tem uma transcrição em andamento.');
  const a = await tx('audios', 'readonly', s => req(s.get(audioId)));
  if (!a?.blob) return;
  const chave = S.settings.modeloTr || 'base';
  trAtual = { audioId, fase: 'Preparando o áudio…', t0: Date.now() };
  let wake; try { wake = await navigator.wakeLock?.request('screen'); } catch { }
  try {
    atualizaTr();
    const pcm = await decodificar(a.blob);
    trAtual.fase = 'Abrindo o Whisper…'; atualizaTr();
    await carregarModelo(chave, t => { trAtual.fase = t; atualizaTr(); });
    const cortes = cortesNoSilencio(pcm);
    const partes = cortes.length - 1;
    const textos = [];
    for (let i = 0; i < partes; i++) {
      trAtual.fase = `Transcrevendo parte ${i + 1} de ${partes}`; atualizaTr();
      const pedaco = pcm.slice(cortes[i], cortes[i + 1]);
      const r = await rpc({ tipo: 'parte', audio: pedaco }, [pedaco.buffer]);
      if (clean(r.texto)) textos.push(clean(r.texto));
    }
    const texto = textos.join(' ');
    const atual = await tx('audios', 'readonly', s => req(s.get(audioId)));
    if (atual) {
      atual.transcricao = clean(atual.transcricao) ? atual.transcricao + '\n' + texto : texto;
      atual.trEm = Date.now(); atual.trModelo = chave;
      await put('audios', atual);
    }
    toast(`Transcrição pronta em ${fmtDur((Date.now() - trAtual.t0) / 1000)}`);
  } catch (err) {
    alert('Não consegui transcrever.\n' + err.message + (navigator.onLine ? '' : '\n\nSe for a primeira vez, conecte à internet (de preferência Wi-Fi) para baixar o Whisper.'));
  } finally {
    trAtual = null;
    try { await wake?.release(); } catch { }
    if (view?.name === 'form' && cur) rerenderForm();
  }
}

// Cartão em Mais › Ajustes
async function cartaoTranscricao() {
  const ch = S.settings.modeloTr || 'base';
  const ok = await modeloBaixado(ch);
  return `<h2>Transcrição de áudio (grátis)</h2><div class="card">
    <p class="muted">Usa o Whisper dentro do celular: não paga nada e, depois de baixado, funciona sem internet.</p>
    <div class="chips">${Object.entries(MODELOS).map(([k, m]) => `<button class="chip ${k === ch ? 'on' : ''}" data-mdl="${k}">${m.nome} (~${m.mb} MB)</button>`).join('')}</div>
    <p class="muted" style="margin-top:8px">${ok ? '✓ Já está baixado neste celular.' : 'Ainda não baixado. Baixe com Wi-Fi antes de ir a campo.'}</p>
    <button class="btn full" id="mdlbaixar" ${ok ? 'disabled' : ''}>⬇️ Baixar agora</button>
    <p class="muted" id="mdlprog"></p></div>`;
}
function ligaCartaoTranscricao() {
  $$('[data-mdl]').forEach(b => b.onclick = async () => { S.settings.modeloTr = b.dataset.mdl; await setMeta('settings', S.settings); render(); });
  const bb = $('#mdlbaixar');
  if (bb) bb.onclick = async () => {
    bb.disabled = true;
    const pr = $('#mdlprog'); pr.textContent = 'Começando…';
    try { await carregarModelo(S.settings.modeloTr || 'base', t => { const x = $('#mdlprog'); if (x) x.textContent = t; }); toast('Whisper baixado!'); render(); }
    catch (err) { pr.textContent = 'Não consegui baixar: ' + err.message; bb.disabled = false; }
  };
}
