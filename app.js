/* RDV – Relatório de Viagem (mini CRM de campo). Sem dependências externas. */
'use strict';

const APP_VERSION = '1.6.0';

// ---------- Listas fixas ----------
const TEMAS = ['Exposição', 'Participação de gôndola', 'Organização', 'Mix', 'Precificação', 'Promoções', 'Expositores', 'Ruptura', 'Conversa com o cliente'];
const INDUSTRIAS = ['Piracanjuba', 'M. Dias (Vitarella)', 'Colgate', 'Cargill', 'Rayovac', 'Bestway', 'Líder'];
const CONTATOS = ['Proprietário', 'Gerente', 'Comprador', 'Repositor', 'Outro', 'Ninguém'];
const COMBO_TIPOS = ['Combo Cargill', 'Combo Rayovac', 'Negociação Cargill', 'Negociação Piracanjuba', 'Verba Gerente', 'Verba Gerente Colgate'];
const ADMIN_TITULOS = ['TÍTULOS VENCIDOS', 'ADNS + CAMPANHAS', 'GESTÃO DE CARTEIRA', 'HOME OFFICE', 'REUNIÃO RAYOVAC', 'REUNIÃO COLGATE', 'PAGAMENTO CAMPANHAS – CONSOLIDADO', 'VALIDADE GERAL - M DIAS BRANCO'];
const TOPICOS_RAPIDOS = ['ENVIADO AOS RCAs PARA CONHECIMENTO', 'ENVIADO AOS RCAs PARA ACOMPANHAMENTO', 'ENVIO AOS RCAs PARA COBRANÇA'];
// A lista de RCAs não fica no código (o endereço do app é público). É colada no app em Mais > RCAs.
const RCAS_INICIAIS = [];
const DIAS_SEMANA = ['DOMINGO', 'SEGUNDA-FEIRA', 'TERÇA-FEIRA', 'QUARTA-FEIRA', 'QUINTA-FEIRA', 'SEXTA-FEIRA', 'SÁBADO'];
const TIPO_NOME = { visita: 'Visita', admin: 'Administrativo', combo: 'Combo / Verba', cadastro: 'Cadastro', email: 'Do e-mail' };

// ---------- Utilidades ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const up = s => String(s ?? '').toLocaleUpperCase('pt-BR');
const pad2 = n => String(n).padStart(2, '0');
const isoDate = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const today = () => isoDate(new Date());
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const ddmm = s => { const d = parseISO(s); return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`; };
const ddmmyyyy = s => { const d = parseISO(s); return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`; };
const hhmm = t => { const d = new Date(t); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
function mondayOf(s) { const d = parseISO(s); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return isoDate(d); }
function addDays(s, n) { const d = parseISO(s); d.setDate(d.getDate() + n); return isoDate(d); }
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), 2200); }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
const clean = s => String(s ?? '').trim();

// ---------- Banco de dados (IndexedDB) ----------
let dbp;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open('rdv', 2);
    r.onupgradeneeded = ev => {
      const d = r.result;
      if (ev.oldVersion < 1) {
        d.createObjectStore('entries', { keyPath: 'id' });
        const p = d.createObjectStore('photos', { keyPath: 'id' });
        p.createIndex('entryId', 'entryId');
        d.createObjectStore('clients', { keyPath: 'codigo' });
        d.createObjectStore('meta', { keyPath: 'key' });
      }
      if (ev.oldVersion < 2) {
        const a = d.createObjectStore('audios', { keyPath: 'id' });
        a.createIndex('entryId', 'entryId');
      }
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then(v => { out = v; });
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
  });
}
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const getAll = store => tx(store, 'readonly', s => req(s.getAll()));
const put = (store, v) => tx(store, 'readwrite', s => { s.put(v); });
const del = (store, k) => tx(store, 'readwrite', s => { s.delete(k); });
async function getMeta(key, def) { const v = await tx('meta', 'readonly', s => req(s.get(key))); return v ? v.value : def; }
const setMeta = (key, value) => put('meta', { key, value });
async function photosOf(entryId) { return tx('photos', 'readonly', s => req(s.index('entryId').getAll(entryId))); }
async function audiosOf(entryId) { return (await tx('audios', 'readonly', s => req(s.index('entryId').getAll(entryId)))).sort((a, b) => a.createdAt - b.createdAt); }

// ---------- Estado em memória ----------
const S = { entries: [], clients: [], rcas: [], settings: {}, tab: 'hoje', weekStart: mondayOf(today()) };
async function loadAll() {
  S.entries = await getAll('entries');
  S.clients = await getAll('clients');
  S.rcas = await getMeta('rcas', null);
  if (!S.rcas) { S.rcas = RCAS_INICIAIS; await setMeta('rcas', S.rcas); }
  S.settings = Object.assign({ maiusculas: true, visitaA: true }, await getMeta('settings', {}));
}
const rcaByCode = c => S.rcas.find(r => r.codigo === c);
const rcaLabel = c => { const r = rcaByCode(c); return r ? `${r.codigo} ${r.nome}` : (c || ''); };
// Contatos da visita: lista [{tipo, nome}]. Registros antigos tinham um só (contatoTipo/contatoNome).
function contatosOf(e) {
  if (Array.isArray(e.contatos)) return e.contatos;
  if (e.contatoTipo) return [{ tipo: e.contatoTipo, nome: e.contatoNome || '' }];
  if (clean(e.contatoNome)) return [{ tipo: 'Outro', nome: e.contatoNome }];
  return [];
}
function contatosTxt(e) { return contatosOf(e).map(c => clean(c.nome) ? `${c.tipo} (${clean(c.nome)})` : c.tipo).join(', '); }
function entriesOfDay(day) { return S.entries.filter(e => e.date === day).sort((a, b) => a.order - b.order); }

// ---------- Texto do RDV ----------
// Maiúsculas, mas mantém siglas no plural como no RDV: RCAs, ADNs, SKUs.
function fmt(s) { return S.settings.maiusculas ? clean(s).split(/(\s+)/).map(w => /^[A-ZÀ-Ú]{2,}s[.,;:)]*$/.test(w) ? w : up(w)).join('') : clean(s); }
function topic(s) { const t = fmt(s).replace(/^[-–•]\s*/, ''); return t ? '- ' + t : ''; }
function entryTitle(e) {
  switch (e.tipo) {
    case 'visita': {
      let t = clean(e.clienteNome) || 'CLIENTE';
      const nomes = contatosOf(e).map(c => clean(c.nome)).filter(Boolean);
      if (nomes.length) t += ` (${nomes.join(' / ')})`;
      return fmt((e.visitaA ?? S.settings.visitaA) ? 'VISITA A ' + t : t);
    }
    case 'cadastro': return fmt(e.cadTipo === 'reativacao' ? 'REATIVAÇÃO DE CLIENTE' : 'NOVO CADASTRO CLIENTE');
    case 'combo': return comboLine(e);
    default: return fmt(e.titulo) || '(SEM TÍTULO)';
  }
}
function comboLine(e) {
  let t = `${clean(e.comboTipo) || 'Combo'} - ${[clean(e.clienteCodigo), clean(e.clienteNome)].filter(Boolean).join(' ')}`;
  if (clean(e.obs)) t += ` ${/^\(.*\)$/.test(clean(e.obs)) ? clean(e.obs) : '(' + clean(e.obs) + ')'}`;
  return t;
}
function entryLines(e) {
  const L = [];
  if (e.tipo === 'visita') {
    for (const tema of TEMAS) for (const n of (e.notas || [])) if (n.tema === tema && clean(n.texto)) L.push(topic(n.texto));
    for (const o of (e.obsRca || [])) if (clean(o.texto)) L.push(topic(o.texto));
    for (const d of (e.demandas || [])) if (clean(d.texto)) L.push(topic(d.texto));
  } else if (e.tipo === 'cadastro') {
    const nome = [clean(e.razao), clean(e.fantasia) ? `(${clean(e.fantasia)})` : ''].filter(Boolean).join(' ');
    if (nome) L.push(topic((clean(e.clienteCodigo) ? clean(e.clienteCodigo) + ' ' : '') + nome));
    if (e.rca) L.push(topic(`RCA ${rcaLabel(e.rca)} SOLICITOU ${e.cadTipo === 'reativacao' ? 'A REATIVAÇÃO' : 'O CADASTRO'} DO CLIENTE`));
    if (clean(e.obs)) L.push(topic(e.obs));
  } else if (e.tipo === 'admin' || e.tipo === 'email') {
    for (const t of (e.topicos || [])) if (clean(t.texto)) L.push(topic(t.texto));
  }
  return L.filter(Boolean);
}
function dayText(day, { comData = true, lista = null } = {}) {
  const list = lista ? lista.filter(e => e.date === day).sort((a, b) => a.order - b.order) : entriesOfDay(day);
  const normal = list.filter(e => e.tipo !== 'combo');
  const combos = list.filter(e => e.tipo === 'combo');
  const cidades = new Set(normal.filter(e => e.tipo === 'visita' && clean(e.cidade)).map(e => up(clean(e.cidade))));
  const blocks = [];
  let cidadeAtual = null;
  for (const e of normal) {
    if (cidades.size > 1 && e.tipo === 'visita' && clean(e.cidade) && up(clean(e.cidade)) !== cidadeAtual) {
      cidadeAtual = up(clean(e.cidade));
      blocks.push(cidadeAtual);
    }
    blocks.push([entryTitle(e), ...entryLines(e)].join('\n'));
  }
  if (combos.length) blocks.push(['COMBOS SOLICITADOS', ...combos.map(c => '- ' + comboLine(c))].join('\n'));
  if (!blocks.length) return '';
  return (comData ? ddmm(day) + '\n\n' : '') + blocks.join('\n\n');
}
function weekDays(start) { return [0, 1, 2, 3, 4, 5, 6].map(i => addDays(start, i)); }
function weekText(start) { return weekDays(start).map(d => dayText(d)).filter(Boolean).join('\n\n\n'); }
function weekHeader(start) {
  const list = S.entries.filter(e => e.date >= start && e.date <= addDays(start, 6));
  const cidades = [...new Set(list.filter(e => e.tipo === 'visita' && clean(e.cidade)).map(e => up(clean(e.cidade))))];
  const rcas = [...new Set(list.filter(e => e.rca).map(e => e.rca))].sort((a, b) => a - b).map(c => up(rcaLabel(c)));
  return { cidades: cidades.join(', '), rcas: rcas.join(', ') };
}

// ---------- Copiar ----------
async function copyPlain(text) {
  try { await navigator.clipboard.writeText(text); }
  catch { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
  toast('Copiado!');
}
// Para o Excel: tudo numa célula só, mantendo as quebras de linha.
async function copyExcel(text) {
  const html = '<table><tr><td style="white-space:normal">' + text.split('\n').map(esc).join('<br style="mso-data-placement:same-cell">') + '</td></tr></table>';
  const plain = '"' + text.replace(/"/g, '""') + '"';
  try {
    if (window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([plain], { type: 'text/plain' }) })]);
    } else await navigator.clipboard.writeText(plain);
    toast('Copiado para o Excel! Clique na célula do dia e cole.');
  } catch { copyPlain(plain); }
}

// ---------- Salvar ----------
async function saveEntry(e) {
  e.updatedAt = Date.now();
  await put('entries', e);
  const i = S.entries.findIndex(x => x.id === e.id);
  if (i >= 0) S.entries[i] = e; else S.entries.push(e);
}
async function removeEntry(id) {
  for (const p of await photosOf(id)) await del('photos', p.id);
  for (const a of await audiosOf(id)) await del('audios', a.id);
  await del('entries', id);
  S.entries = S.entries.filter(e => e.id !== id);
}
async function rememberClient(codigo, nome) {
  codigo = clean(codigo); nome = clean(nome);
  if (!codigo || !nome) return;
  const ex = S.clients.find(c => c.codigo === codigo);
  if (ex && ex.nome === nome) return;
  const c = { ...(ex || {}), codigo, nome, cidade: ex?.cidade || '' };
  await put('clients', c);
  S.clients = S.clients.filter(x => x.codigo !== codigo).concat(c);
}
function isEmpty(e) {
  if (e.tipo === 'visita') return !clean(e.clienteNome) && !clean(e.clienteCodigo) && !(e.notas || []).some(n => clean(n.texto)) && !(e.obsRca || []).some(n => clean(n.texto)) && !(e.demandas || []).some(n => clean(n.texto)) && !e._fotos && !e._audios;
  if (e.tipo === 'combo') return !clean(e.clienteNome) && !clean(e.clienteCodigo);
  if (e.tipo === 'cadastro') return !clean(e.razao) && !clean(e.fantasia);
  return !clean(e.titulo) && !(e.topicos || []).some(t => clean(t.texto)) && !e._audios;
}

// ---------- Fotos ----------
function compressImage(file, max = 1280, q = 0.7) {
  return new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let { width: w, height: h } = img;
      const k = Math.min(1, max / Math.max(w, h)); w = Math.round(w * k); h = Math.round(h * k);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      c.toBlob(b => b ? res(b) : rej(new Error('foto')), 'image/jpeg', q);
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('foto')); };
    img.src = url;
  });
}
function pickPhoto() {
  return new Promise(res => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = 'image/*'; i.capture = 'environment';
    i.onchange = () => res(i.files[0] || null);
    i.click();
  });
}
const objUrls = [];
function blobUrl(b) { const u = URL.createObjectURL(b); objUrls.push(u); return u; }
function freeUrls() { while (objUrls.length) URL.revokeObjectURL(objUrls.pop()); }

// ---------- Gravador de voz ----------
// Grava em pedaços de 5 s e salva a cada pedaço: se o celular fechar o app, o que foi gravado fica guardado.
let rec = null; // { mr, stream, chunks, audio, entry, start, timer, wake }
function fmtDur(s) { s = Math.round(s || 0); return `${Math.floor(s / 60)}:${pad2(s % 60)}`; }
async function startRec(entry) {
  if (rec) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return alert('Este aparelho não permite gravar áudio pelo navegador.');
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch { return alert('Não consegui usar o microfone. Libere a permissão do microfone para o RDV e tente de novo.'); }
  const tipos = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'];
  const mimeType = tipos.find(t => MediaRecorder.isTypeSupported?.(t)) || '';
  const mr = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 32000 } : {});
  const audio = { id: uid(), entryId: entry.id, mime: mr.mimeType || mimeType || 'audio/webm', createdAt: Date.now(), dur: 0, transcricao: '' };
  rec = { mr, stream, chunks: [], audio, entry, start: Date.now() };
  entry._audios = true;
  await saveEntry(entry);
  mr.ondataavailable = async ev => {
    if (!ev.data || !ev.data.size) return;
    rec.chunks.push(ev.data);
    audio.blob = new Blob(rec.chunks, { type: audio.mime });
    audio.dur = (Date.now() - rec.start) / 1000;
    await put('audios', audio);
  };
  mr.start(5000);
  try { rec.wake = await navigator.wakeLock?.request('screen'); } catch { }
  rec.timer = setInterval(() => { const t = $('#rectime'); if (t && rec) t.textContent = fmtDur((Date.now() - rec.start) / 1000); }, 500);
  if (navigator.vibrate) navigator.vibrate(80);
}
function stopRec() {
  return new Promise(res => {
    if (!rec) return res();
    const r = rec;
    r.mr.onstop = async () => {
      await new Promise(ok => setTimeout(ok, 50)); // espera o último pedaço
      if (r.chunks.length) { r.audio.blob = new Blob(r.chunks, { type: r.audio.mime }); r.audio.dur = (Date.now() - r.start) / 1000; await put('audios', r.audio); }
      r.stream.getTracks().forEach(t => t.stop());
      clearInterval(r.timer);
      try { await r.wake?.release(); } catch { }
      rec = null;
      if (navigator.vibrate) navigator.vibrate([60, 60, 60]);
      res(r.audio);
    };
    r.mr.stop();
  });
}
async function shareAudio(a) {
  const ext = a.mime.includes('mp4') ? 'm4a' : a.mime.includes('ogg') ? 'ogg' : 'webm';
  const d = new Date(a.createdAt);
  const nome = `RDV-audio-${isoDate(d)}-${pad2(d.getHours())}h${pad2(d.getMinutes())}.${ext}`;
  const file = new File([a.blob], nome, { type: a.mime.split(';')[0] });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: nome }); return; } catch (err) { if (err.name === 'AbortError') return; } }
  const l = document.createElement('a'); l.href = URL.createObjectURL(file); l.download = nome; l.click(); setTimeout(() => URL.revokeObjectURL(l.href), 5000);
}

// ---------- Navegação ----------
let view = null; // {name, params}
function go(name, params = {}, push = true) {
  if (push) history.pushState({ name, params }, '');
  view = { name, params };
  render();
}
window.addEventListener('popstate', async ev => {
  const nv = ev.state || { name: S.tab, params: {} };
  if (view?.name === 'form' && (nv.name !== 'form' || nv.params.id !== cur?.id)) await closeCur();
  view = nv; render();
});
$('#tabs').addEventListener('click', ev => {
  const b = ev.target.closest('button[data-tab]'); if (!b) return;
  S.tab = b.dataset.tab; history.replaceState({ name: S.tab, params: {} }, ''); view = { name: S.tab, params: {} }; render();
});

async function render() {
  freeUrls();
  const name = view?.name || S.tab;
  if (['hoje', 'semana', 'pendencias', 'mais'].includes(name)) S.tab = name;
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === S.tab));
  $('#topinfo').innerHTML = `${esc(DIAS_SEMANA[new Date().getDay()].toLowerCase())}<br>${ddmmyyyy(today())}`;
  await renderBanner();
  const m = $('#main');
  m.oninput = m.onchange = m.onclick = null;
  const fn = { hoje: vHoje, semana: vSemana, pendencias: vPendencias, mais: vMais, form: vForm, rcas: vRcas, clientes: vClientes, texto: vTexto, exportar: vExportar, historico: vHistorico }[name] || vHoje;
  await fn(m, view?.params || {});
  window.scrollTo(0, view?.params?.scroll || 0);
}
async function renderBanner() {
  const last = await getMeta('lastBackup', 0);
  const n = S.entries.length;
  const dias = last ? Math.floor((Date.now() - last) / 864e5) : null;
  const b = $('#banner');
  if (n && (dias === null || dias >= 7)) {
    b.innerHTML = `<div class="banner">⚠️ ${dias === null ? 'Você ainda não fez nenhum backup.' : `Último backup há ${dias} dias.`} <a href="#" id="bkgo">Fazer backup agora</a></div>`;
    $('#bkgo').onclick = ev => { ev.preventDefault(); go('mais'); };
  } else b.innerHTML = '';
}

// ---------- Tela: Hoje ----------
function entryCard(e, { ordem = false } = {}) {
  const linhas = entryLines(e);
  const abertas = (e.demandas || []).filter(d => clean(d.texto) && !d.resolvida).length;
  let sub = [];
  if (e.tipo === 'visita') sub.push([clean(e.cidade), e.rca ? 'RCA ' + rcaLabel(e.rca) : '', contatosOf(e).map(c => c.tipo).join(', ')].filter(Boolean).join(' · '));
  if (e.tipo === 'combo') sub.push(rcaLabel(e.rca));
  sub.push(linhas.length ? `${linhas.length} tópico(s)` : '');
  return `<div class="card entry" data-id="${e.id}">
    ${ordem ? `<div class="ord"><button class="btn sm" data-up="${e.id}" aria-label="Subir">▲</button><button class="btn sm" data-dn="${e.id}" aria-label="Descer">▼</button></div>` : ''}
    <div class="body" data-open="${e.id}">
      <div><span class="badge">${TIPO_NOME[e.tipo]}</span>${abertas ? `<span class="badge warn">${abertas} pendente(s)</span>` : ''}<span class="muted">${hhmm(e.createdAt)}</span></div>
      <div class="tt">${esc(e.tipo === 'combo' ? comboLine(e) : entryTitle(e))}</div>
      <div class="sub">${esc(sub.filter(Boolean).join(' · '))}</div>
    </div>
  </div>`;
}
function bindCards(el) {
  $$('[data-open]', el).forEach(x => x.onclick = () => go('form', { id: x.dataset.open }));
  $$('[data-up]', el).forEach(x => x.onclick = () => moveEntry(x.dataset.up, -1));
  $$('[data-dn]', el).forEach(x => x.onclick = () => moveEntry(x.dataset.dn, 1));
}
async function moveEntry(id, dir) {
  const e = S.entries.find(x => x.id === id); if (!e) return;
  const list = entriesOfDay(e.date); const i = list.findIndex(x => x.id === id); const j = i + dir;
  if (j < 0 || j >= list.length) return;
  const o = list[j]; [e.order, o.order] = [o.order, e.order];
  if (e.order === o.order) e.order += dir;
  await saveEntry(e); await saveEntry(o);
  view.params.scroll = window.scrollY; render();
}
function newEntry(tipo, extra = {}) {
  const now = Date.now();
  const base = { id: uid(), tipo, date: today(), createdAt: now, order: now };
  if (tipo === 'visita') Object.assign(base, { cidade: S.settings.ultimaCidade || '', rca: S.settings.ultimoRca || '', clienteCodigo: '', clienteNome: '', contatos: [], notas: [], obsRca: [], demandas: [] });
  if (tipo === 'admin' || tipo === 'email') Object.assign(base, { titulo: '', topicos: [{ texto: '' }] });
  if (tipo === 'combo') Object.assign(base, { comboTipo: S.settings.ultimoCombo || 'Combo Cargill', clienteCodigo: '', clienteNome: '', obs: '', rca: '' });
  if (tipo === 'cadastro') Object.assign(base, { cadTipo: 'novo', razao: '', fantasia: '', rca: '', obs: '', clienteCodigo: '' });
  return Object.assign(base, extra);
}
async function vHoje(m) {
  const d = today();
  const list = entriesOfDay(d);
  m.innerHTML = `
    <h2>Registrar</h2>
    <button class="bigbtn" data-new="visita"><span class="ic">🏪</span><span>Visita a cliente<small>Exposição, ruptura, mix, fotos…</small></span></button>
    <div class="grid2" style="margin-top:10px">
      <button class="bigbtn" data-new="admin"><span class="ic">🗂️</span><span>Administrativo</span></button>
      <button class="bigbtn" data-new="combo"><span class="ic">🎁</span><span>Combo / Verba</span></button>
      <button class="bigbtn" data-new="cadastro"><span class="ic">🆕</span><span>Cadastro / Reativação</span></button>
      <button class="bigbtn" data-new="email"><span class="ic">✉️</span><span>Do e-mail</span></button>
    </div>
    ${S.rcas.length ? '' : '<div class="card" id="semrca">👥 <b>Cadastre seus RCAs</b> em Mais › RCAs para escolher nas visitas. <a href="#">Ir agora</a></div>'}
    <h2>Hoje · ${ddmm(d)} <span class="muted">(${list.length})</span></h2>
    <div id="lst">${list.map(e => entryCard(e)).join('') || '<p class="muted">Nada registrado hoje ainda.</p>'}</div>
    ${list.length ? `<button class="btn full" id="vertexto">Ver texto do RDV de hoje</button>` : ''}`;
  $$('[data-new]', m).forEach(b => b.onclick = () => go('form', { novo: b.dataset.new }));
  bindCards(m);
  const sr = $('#semrca'); if (sr) sr.onclick = ev => { ev.preventDefault(); go('rcas'); };
  const vt = $('#vertexto'); if (vt) vt.onclick = () => go('texto', { day: d });
}

// ---------- Formulários ----------
let cur = null, curPhotos = [], curAudios = [];
const saveTrans = debounce(a => put('audios', a), 600);
const autosave = debounce(async () => { if (cur && !isEmpty(cur)) { await saveEntry(cur); markSaved(); } }, 500);
function markSaved() { const s = $('#svst'); if (s) s.textContent = '✓ salvo'; }

async function vForm(m, p) {
  if (p.novo) {
    // cria o registro e troca a URL para editar (assim "voltar" não cria outro)
    cur = newEntry(p.novo, Object.assign(p.dia ? { date: p.dia } : {}, p.pre || {}));
    view.params = { id: cur.id, novoTemp: true };
    history.replaceState({ name: 'form', params: view.params }, '');
  } else if (!cur || cur.id !== p.id) {
    cur = structuredClone(S.entries.find(e => e.id === p.id) || null);
    if (!cur) { go(S.tab, {}, false); return; }
  }
  if (cur.tipo === 'visita' && !Array.isArray(cur.contatos)) { cur.contatos = contatosOf(cur); delete cur.contatoTipo; delete cur.contatoNome; }
  curPhotos = await photosOf(cur.id);
  curAudios = await audiosOf(cur.id);
  const e = cur;
  const fotos = tema => `<div class="thumbs">${curPhotos.filter(f => f.tema === tema).map(f => `<div class="ph"><img src="${blobUrl(f.blob)}" data-ver="${f.id}" alt="foto"><button data-delfoto="${f.id}" aria-label="Apagar foto">✕</button></div>`).join('')}</div>`;
  const indSel = (v, attrs) => `<select ${attrs}><option value="">Indústria…</option>${INDUSTRIAS.map(i => `<option ${i === v ? 'selected' : ''}>${esc(i)}</option>`).join('')}</select>`;
  const rcaSel = (v, f = 'rca') => `<select data-f="${f}"><option value="">— sem RCA —</option>${S.rcas.map(r => `<option value="${esc(r.codigo)}" ${r.codigo === v ? 'selected' : ''}>${esc(r.codigo + ' ' + r.nome)}</option>`).join('')}</select>`;
  const linesEd = (list, key, ph, extra = () => '') => (e[list] || []).map((n, i) => n[key] === undefined ? '' : `
    <div class="line"><div class="row"><textarea class="grow" rows="1" data-l="${list}" data-i="${i}" data-k="${key}" placeholder="${esc(ph)}">${esc(n[key])}</textarea><button class="x" data-rm="${list}" data-i="${i}" aria-label="Remover">✕</button></div>${extra(n, i)}</div>`).join('');
  const audios = () => `<h2>Áudios</h2><div class="card">
      ${rec && rec.entry.id === e.id
        ? `<div class="row"><span style="color:var(--del);font-weight:700">● Gravando <span id="rectime">${fmtDur((Date.now() - rec.start) / 1000)}</span></span><button class="btn pri grow" id="recstop">⏹ Parar e salvar</button></div><p class="muted">Deixe a tela ligada enquanto grava.</p>`
        : `<button class="btn pri full" id="recstart" ${rec ? 'disabled' : ''}>🎙️ Gravar conversa</button>`}
      ${curAudios.filter(a => a.blob && !(rec && rec.audio.id === a.id)).map(a => `<div class="line">
        <div class="muted">${hhmm(a.createdAt)} · ${fmtDur(a.dur)}</div>
        <audio controls preload="metadata" src="${blobUrl(a.blob)}" style="width:100%;margin:4px 0"></audio>
        <textarea rows="1" data-trans="${a.id}" placeholder="Transcrição (cole aqui quando tiver)">${esc(a.transcricao || '')}</textarea>
        <div class="row" style="margin-top:6px">${trAtual && trAtual.audioId === a.id ? `<span class="muted" id="tr-${a.id}" style="color:var(--pri);font-weight:600">⏳ ${esc(trAtual.fase)}</span>` : `<button class="btn sm pri" data-trgo="${a.id}">📝 Transcrever (grátis)</button>`}<button class="btn sm" data-shaud="${a.id}">📤 Enviar</button><button class="btn sm del" data-delaud="${a.id}">🗑</button></div>
      </div>`).join('')}
      <p class="muted">Para escrever falando, use o microfone do teclado nas anotações.</p></div>`;
  const dataHora = `<div class="row"><div class="grow"><label class="f">Data</label><input type="date" data-f="date" value="${esc(e.date)}"></div><div><label class="f">Criado às</label><input value="${hhmm(e.createdAt)}" disabled style="width:90px"></div></div>`;
  const cliente = (lbl = 'Cliente') => `<label class="f">${lbl} (código e nome)</label><div class="row"><input style="width:110px" inputmode="numeric" data-f="clienteCodigo" list="dlcod" placeholder="Código" value="${esc(e.clienteCodigo)}"><input class="grow" data-f="clienteNome" list="dlcli" placeholder="Nome do cliente" value="${esc(e.clienteNome)}"></div>`;
  let h = `<div class="row"><button class="btn sm" id="voltar">← Voltar</button><h2 class="grow" style="margin:0">${TIPO_NOME[e.tipo]}</h2><span class="muted" id="svst"></span></div><div class="card">${dataHora}`;

  if (e.tipo === 'visita') {
    h += `<label class="f">Cidade</label><input data-f="cidade" list="dlcid" value="${esc(e.cidade)}" placeholder="Ex.: Brumado">
      ${cliente()}
      <label class="f">RCA que me acompanhou</label>${rcaSel(e.rca)}
      <label class="f">Com quem falei</label>
      <div class="chips">${CONTATOS.map(c => `<button class="chip ${e.contatos.some(x => x.tipo === c) ? 'on' : ''}" data-contato="${c}">${c}</button>`).join('')}</div>
      ${e.contatos.map((c, i) => c.tipo === 'Ninguém' ? '' : `<label class="f">${c.tipo === 'Outro' ? 'Quem? (nome e função)' : 'Nome do(a) ' + c.tipo.toLowerCase()}</label><input data-ct="${i}" value="${esc(c.nome)}" placeholder="${c.tipo === 'Outro' ? 'Ex.: Paulo, encarregado do depósito' : 'Ex.: Carla'}">`).join('')}
      ${e.contatos.some(c => clean(c.nome)) ? '<p class="muted">Os nomes saem no título do RDV: CLIENTE (NOME).</p>' : ''}
      <label class="row" style="margin-top:10px;font-size:14px"><input type="checkbox" data-f="visitaA" ${(e.visitaA ?? S.settings.visitaA) ? 'checked' : ''} style="width:22px;min-height:22px"> Título começa com "VISITA A"</label>
    </div>
    <h2>Anotações</h2>`;
    for (const tema of TEMAS) {
      const n = (e.notas || []).filter(x => x.tema === tema).length;
      const nf = curPhotos.filter(f => f.tema === tema).length;
      const aberto = p.aberto === tema;
      h += `<div class="tema"><button class="th" data-tema="${esc(tema)}">${aberto ? '▾' : '▸'} ${esc(tema)}<span class="n">${n ? n + ' nota(s)' : ''}${nf ? ' · ' + nf + ' 📷' : ''}</span></button>
        <div class="tb ${aberto ? '' : 'hidden'}">
          ${(e.notas || []).map((x, i) => x.tema !== tema ? '' : `<div class="line"><div class="row"><textarea class="grow" rows="1" data-l="notas" data-i="${i}" data-k="texto" placeholder="Escreva ou use o microfone do teclado">${esc(x.texto)}</textarea><button class="x" data-rm="notas" data-i="${i}" aria-label="Remover">✕</button></div><div class="row">${indSel(x.industria, `data-l="notas" data-i="${i}" data-k="industria"`)}</div></div>`).join('')}
          <div class="row" style="margin-top:6px"><button class="btn sm" data-addnota="${esc(tema)}">+ Anotação</button><button class="btn sm" data-foto="${esc(tema)}">📷 Foto</button></div>
          ${fotos(tema)}
        </div></div>`;
    }
    h += `<h2>Observações junto ao RCA</h2><div class="card">${linesEd('obsRca', 'texto', 'Observação feita ao RCA')}<button class="btn sm" data-add="obsRca">+ Observação</button></div>
      <h2>Demandas e pendências</h2><div class="card">${(e.demandas || []).map((d, i) => `
        <div class="line"><div class="row"><textarea class="grow ${d.resolvida ? 'done' : ''}" rows="1" data-l="demandas" data-i="${i}" data-k="texto" placeholder="Demanda do cliente / pendência">${esc(d.texto)}</textarea><button class="x" data-rm="demandas" data-i="${i}" aria-label="Remover">✕</button></div>
        <label class="row" style="font-size:14px"><input type="checkbox" data-res="${i}" ${d.resolvida ? 'checked' : ''} style="width:22px;min-height:22px"> Resolvida${d.resolvidaEm ? ' em ' + ddmm(d.resolvidaEm) : ''}</label></div>`).join('')}
        <button class="btn sm" data-add="demandas">+ Demanda / pendência</button></div>
      <h2>Fotos gerais</h2><div class="card"><button class="btn sm" data-foto="Geral">📷 Tirar foto</button>${fotos('Geral')}</div>
      ${audios()}`;
  }

  if (e.tipo === 'admin' || e.tipo === 'email') {
    h += `<label class="f">Título</label><input data-f="titulo" list="dltit" value="${esc(e.titulo)}" placeholder="Ex.: TÍTULOS VENCIDOS">
      <label class="f">Tópicos</label>${linesEd('topicos', 'texto', 'Tópico')}
      <button class="btn sm" data-add="topicos">+ Tópico</button>
      <label class="f">Tópicos prontos (toque para adicionar)</label>
      <div class="chips">${TOPICOS_RAPIDOS.map(t => `<button class="chip" data-rapido="${esc(t)}">${esc(t)}</button>`).join('')}</div>
      <label class="f">RCA envolvido (opcional)</label>${rcaSel(e.rca)}</div>
      ${audios()}`;
  }

  if (e.tipo === 'combo') {
    h += `<label class="f">Tipo</label><input data-f="comboTipo" list="dlcombo" value="${esc(e.comboTipo)}">
      <div class="chips" style="margin-top:6px">${COMBO_TIPOS.map(t => `<button class="chip ${e.comboTipo === t ? 'on' : ''}" data-combo="${esc(t)}">${esc(t)}</button>`).join('')}</div>
      ${cliente()}
      <label class="f">Observação (opcional)</label><input data-f="obs" value="${esc(e.obs)}" placeholder="Ex.: TOP VAREJISTA">
      <label class="f">RCA (opcional)</label>${rcaSel(e.rca)}
      <p class="muted">No RDV sai assim: <b id="prevcombo">${esc(comboLine(e))}</b></p></div>`;
  }

  if (e.tipo === 'cadastro') {
    h += `<div class="chips"><button class="chip ${e.cadTipo !== 'reativacao' ? 'on' : ''}" data-cad="novo">Novo cadastro</button><button class="chip ${e.cadTipo === 'reativacao' ? 'on' : ''}" data-cad="reativacao">Reativação</button></div>
      <label class="f">Razão social</label><input data-f="razao" value="${esc(e.razao)}">
      <label class="f">Nome fantasia</label><input data-f="fantasia" value="${esc(e.fantasia)}">
      <label class="f">Código (se já tiver)</label><input data-f="clienteCodigo" inputmode="numeric" value="${esc(e.clienteCodigo)}">
      <label class="f">RCA que pediu</label>${rcaSel(e.rca)}
      <label class="f">Observação</label><textarea data-f="obs" rows="2">${esc(e.obs)}</textarea></div>`;
  }

  h += `<div class="card"><label class="f">Prévia do texto</label><pre class="txt" id="prev"></pre></div>
    <div class="savebar"><button class="btn del" id="apagar">🗑 Apagar</button>${e.tipo === 'combo' ? '<button class="btn" id="outro">+ Outro combo</button>' : ''}<button class="btn pri" id="pronto">✓ Pronto</button></div>
    ${datalists()}`;
  m.innerHTML = h;
  bindForm(m, p);
  updatePreview();
}
function datalists() {
  const cidades = [...new Set(S.entries.map(e => clean(e.cidade)).filter(Boolean).concat(S.clients.map(c => c.cidade).filter(Boolean)))].sort();
  const titulos = [...new Set(ADMIN_TITULOS.concat(S.entries.filter(e => e.tipo === 'admin' || e.tipo === 'email').map(e => up(clean(e.titulo))).filter(Boolean)))];
  const combos = [...new Set(COMBO_TIPOS.concat(S.entries.filter(e => e.tipo === 'combo').map(e => clean(e.comboTipo)).filter(Boolean)))];
  const cl = [...S.clients].sort((a, b) => a.nome.localeCompare(b.nome));
  return `<datalist id="dlcid">${cidades.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
    <datalist id="dltit">${titulos.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
    <datalist id="dlcombo">${combos.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
    <datalist id="dlcli">${cl.map(c => `<option value="${esc(c.nome)}">${esc(c.codigo)}</option>`).join('')}</datalist>
    <datalist id="dlcod">${cl.map(c => `<option value="${esc(c.codigo)}">${esc(c.nome)}</option>`).join('')}</datalist>`;
}
function updatePreview() {
  const p = $('#prev'); if (!p || !cur) return;
  p.textContent = cur.tipo === 'combo' ? 'COMBOS SOLICITADOS\n- ' + comboLine(cur) : [entryTitle(cur), ...entryLines(cur)].join('\n');
  const pc = $('#prevcombo'); if (pc) pc.textContent = comboLine(cur);
}
function autoGrow(t) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }
function changed() { const s = $('#svst'); if (s) s.textContent = '…'; updatePreview(); autosave(); }
function rerenderForm(extra = {}) { view.params = Object.assign({}, view.params, extra, { scroll: window.scrollY }); delete view.params.novo; history.replaceState({ name: 'form', params: view.params }, ''); render(); }

function bindForm(m, p) {
  const e = cur;
  $$('textarea', m).forEach(autoGrow);
  m.oninput = ev => {
    const t = ev.target;
    if (t.tagName === 'TEXTAREA') autoGrow(t);
    if (t.dataset.f) {
      const f = t.dataset.f;
      e[f] = t.type === 'checkbox' ? t.checked : t.value;
      // Escolheu um cliente da lista: completa código, nome, cidade e RCA do cadastro do cliente
      // (espera parar de digitar o código, para não pegar um cliente com código parecido no meio da digitação)
      const preenche = () => {
        const c = f === 'clienteCodigo' ? S.clients.find(x => x.codigo === clean(t.value)) : S.clients.find(x => x.nome === t.value);
        if (!c || !cur || cur.id !== e.id) return;
        const setv = (k, v) => { e[k] = v; const el = $(`[data-f="${k}"]`, m); if (el && el !== t) el.value = v; };
        setv('clienteCodigo', c.codigo); setv('clienteNome', c.nome);
        if (c.cidade && 'cidade' in e) setv('cidade', c.cidade);
        if (c.rca && 'rca' in e && c.rca !== e.rca) {
          if (rcaByCode(c.rca)) setv('rca', c.rca);
          else toast(`O RCA ${c.rca} deste cliente não está na sua lista (Mais › RCAs).`);
        }
        changed();
      };
      if (f === 'clienteCodigo') { clearTimeout(bindForm._t); bindForm._t = setTimeout(preenche, 600); }
      else if (f === 'clienteNome') preenche();
      changed();
    } else if (t.dataset.l) {
      e[t.dataset.l][+t.dataset.i][t.dataset.k] = t.value;
      changed();
    } else if (t.dataset.ct !== undefined) {
      e.contatos[+t.dataset.ct].nome = t.value;
      changed();
    } else if (t.dataset.trans) {
      const a = curAudios.find(x => x.id === t.dataset.trans);
      if (a) { a.transcricao = t.value; saveTrans(a); }
    }
  };
  m.onchange = ev => {
    const t = ev.target;
    if (t.dataset.res !== undefined) {
      const d = e.demandas[+t.dataset.res]; d.resolvida = t.checked; d.resolvidaEm = t.checked ? today() : null;
      changed(); rerenderForm();
    }
    if (t.dataset.f === 'date') rerenderForm();
  };
  m.onclick = async ev => {
    const b = ev.target.closest('button, img'); if (!b) return;
    const ds = b.dataset;
    if (b.id === 'voltar' || b.id === 'pronto') return finishForm();
    if (b.id === 'apagar') {
      if (confirm('Apagar este registro? Não dá para desfazer.')) { if (rec) await stopRec(); await removeEntry(e.id); cur = null; history.back(); }
      return;
    }
    if (b.id === 'outro') { await finishForm(true); return; }
    if (b.id === 'recstart') { await startRec(e); rerenderForm(); return; }
    if (b.id === 'recstop') { const a = await stopRec(); toast(a ? `Áudio salvo (${fmtDur(a.dur)})` : 'Gravação parada'); rerenderForm(); return; }
    if (ds.shaud) { const a = curAudios.find(x => x.id === ds.shaud); if (a) shareAudio(a); return; }
    if (ds.trgo) { transcreverAudio(ds.trgo); setTimeout(() => rerenderForm(), 50); return; }
    if (ds.delaud) { if (confirm('Apagar este áudio? Não dá para desfazer.')) { await del('audios', ds.delaud); rerenderForm(); } return; }
    if (ds.tema) { rerenderForm({ aberto: p.aberto === ds.tema ? null : ds.tema }); return; }
    if (ds.addnota) {
      const ult = [...(e.notas || [])].reverse().find(n => n.industria);
      e.notas.push({ tema: ds.addnota, industria: ult?.industria || '', texto: '' });
      rerenderForm({ aberto: ds.addnota, foco: 'notas' }); return;
    }
    if (ds.add) { e[ds.add].push(ds.add === 'demandas' ? { id: uid(), texto: '', resolvida: false } : { texto: '' }); rerenderForm({ foco: ds.add }); return; }
    if (ds.rm) {
      const it = e[ds.rm][+ds.i];
      if (clean(it.texto) && !confirm('Remover este item?')) return;
      e[ds.rm].splice(+ds.i, 1); changed(); rerenderForm(); return;
    }
    if (ds.rapido) {
      const vazio = e.topicos.find(t => !clean(t.texto));
      if (vazio) vazio.texto = ds.rapido; else e.topicos.push({ texto: ds.rapido });
      changed(); rerenderForm(); return;
    }
    if (ds.contato) {
      const t = ds.contato, ja = e.contatos.findIndex(x => x.tipo === t);
      if (ja >= 0) e.contatos.splice(ja, 1);
      else if (t === 'Ninguém') e.contatos = [{ tipo: t, nome: '' }];
      else { e.contatos = e.contatos.filter(x => x.tipo !== 'Ninguém'); e.contatos.push({ tipo: t, nome: '' }); }
      changed(); rerenderForm({ focoCt: ja < 0 && t !== 'Ninguém' ? e.contatos.length - 1 : null }); return;
    }
    if (ds.combo) { e.comboTipo = ds.combo; changed(); rerenderForm(); return; }
    if (ds.cad) { e.cadTipo = ds.cad; changed(); rerenderForm(); return; }
    if (ds.foto) {
      const file = await pickPhoto(); if (!file) return;
      try {
        const blob = await compressImage(file);
        e._fotos = true;
        await saveEntry(e);
        await put('photos', { id: uid(), entryId: e.id, tema: ds.foto, blob, createdAt: Date.now() });
        toast(`Foto salva (${Math.round(blob.size / 1024)} KB)`);
        rerenderForm({ aberto: ds.foto === 'Geral' ? p.aberto : ds.foto });
      } catch { toast('Não consegui ler a foto.'); }
      return;
    }
    if (ds.delfoto) { if (confirm('Apagar esta foto?')) { await del('photos', ds.delfoto); rerenderForm(); } return; }
    if (ds.ver) { const f = curPhotos.find(x => x.id === ds.ver); if (f) window.open(URL.createObjectURL(f.blob), '_blank'); }
  };
  if (p.focoCt != null) { const ci = $(`[data-ct="${p.focoCt}"]`, m); if (ci) setTimeout(() => ci.focus(), 50); delete view.params.focoCt; }
  if (p.foco) {
    const all = $$(`textarea[data-l="${p.foco}"]`, m);
    const t = all[all.length - 1]; if (t) setTimeout(() => t.focus(), 50);
    delete view.params.foco;
  }
}
// Fecha o registro aberto: apaga se ficou vazio, senão salva e lembra cliente/cidade/RCA.
async function closeCur() {
  if (rec) { await stopRec(); toast('Gravação salva'); }
  const e = cur; cur = null;
  if (!e) return;
  if (isEmpty(e)) { if (S.entries.find(x => x.id === e.id)) await removeEntry(e.id); return; }
  await saveEntry(e);
  await rememberClient(e.clienteCodigo, e.clienteNome);
  if (e.tipo === 'visita') { S.settings.ultimaCidade = clean(e.cidade); S.settings.ultimoRca = e.rca; }
  if (e.tipo === 'combo') S.settings.ultimoCombo = e.comboTipo;
  await setMeta('settings', S.settings);
}
async function finishForm(outro = false) {
  if (outro) {
    const d = cur.date; await closeCur();
    view = { name: 'form', params: { novo: 'combo', dia: d } }; history.replaceState(view, ''); render();
    toast('Combo salvo. Pode digitar o próximo.');
    return;
  }
  history.back();
}

// ---------- Tela: texto de um dia ----------
async function vTexto(m, p) {
  const t = dayText(p.day);
  m.innerHTML = `<div class="row"><button class="btn sm" onclick="history.back()">← Voltar</button><h2 class="grow" style="margin:0">Texto do RDV · ${ddmm(p.day)}</h2></div>
    <pre class="txt">${esc(t) || 'Sem registros.'}</pre>
    <div class="row"><button class="btn pri grow" id="c1">📋 Copiar</button><button class="btn grow" id="c2">📊 Copiar p/ Excel</button></div>`;
  $('#c1').onclick = () => copyPlain(t);
  $('#c2').onclick = () => copyExcel(dayText(p.day, { comData: false }));
}

// ---------- Tela: Semana ----------
async function vSemana(m) {
  const ws = S.weekStart;
  const dias = weekDays(ws);
  const hd = weekHeader(ws);
  let h = `<div class="weeknav"><button class="btn sm" id="wprev">◀</button><div class="grow">Semana ${ddmm(ws)} a ${ddmm(addDays(ws, 4))}</div><button class="btn sm" id="wnext">▶</button></div>
    <div class="card"><h3>Cabeçalho do RDV (aba da semana)</h3>
      <label class="f">Área visitada</label><div class="row"><div class="grow">${esc(hd.cidades) || '<span class="muted">—</span>'}</div>${hd.cidades ? '<button class="btn sm" data-cp="cid">Copiar</button>' : ''}</div>
      <label class="f">RCA</label><div class="row"><div class="grow">${esc(hd.rcas) || '<span class="muted">—</span>'}</div>${hd.rcas ? '<button class="btn sm" data-cp="rca">Copiar</button>' : ''}</div>
    </div>
    <div class="row" style="margin-bottom:10px"><button class="btn pri grow" id="cpsem">📋 Copiar semana toda</button><button class="btn grow" id="orto">✏️ Corrigir ortografia</button></div>
    <button class="btn full" id="rptsem" style="margin-bottom:10px">📄 Relatório de visita desta semana (PDF / JPG)</button>`;
  for (const d of dias) {
    const list = entriesOfDay(d);
    const wd = parseISO(d).getDay();
    if (!list.length && (wd === 0 || wd === 6)) continue;
    h += `<div class="card"><div class="dayhead"><h3>${DIAS_SEMANA[wd]} · ${ddmm(d)}</h3>
      ${list.length ? `<button class="btn sm" data-cpd="${d}">📋 Copiar</button><button class="btn sm" data-cpx="${d}">📊 Excel</button>` : ''}</div>
      <div style="margin-top:8px">${list.map(e => entryCard(e, { ordem: true })).join('') || '<p class="muted">Sem registros.</p>'}</div>
      <div class="row"><button class="btn sm" data-add-dia="${d}">+ Registrar neste dia</button></div>
      ${list.length ? `<details><summary>Ver texto do dia</summary><pre class="txt">${esc(dayText(d))}</pre></details>` : ''}</div>`;
  }
  h += `<p class="muted">Para o Excel: no computador, use "📊 Excel" e cole na célula do dia (aba "Atividades Semana"). Se colar pelo celular/WhatsApp, dê dois cliques na célula antes de colar.</p>`;
  m.innerHTML = h;
  $('#wprev').onclick = () => { S.weekStart = addDays(ws, -7); render(); };
  $('#wnext').onclick = () => { S.weekStart = addDays(ws, 7); render(); };
  $$('[data-cp]', m).forEach(b => b.onclick = () => copyPlain(b.dataset.cp === 'cid' ? hd.cidades : hd.rcas));
  $('#rptsem').onclick = () => go('exportar', { de: ws, ate: addDays(ws, 6) });
  $('#cpsem').onclick = () => { const t = weekText(ws); t ? copyPlain(t) : toast('Semana vazia.'); };
  $('#orto').onclick = () => {
    const t = weekText(ws); if (!t) return toast('Semana vazia.');
    copyPlain('Corrija apenas a ortografia e a acentuação do texto abaixo, sem mudar o sentido, a ordem, as MAIÚSCULAS, os códigos e os números. Mantenha os tópicos começando com "- ". Devolva só o texto corrigido.\n\n' + t);
    alert('Copiei o texto da semana com um pedido de correção.\n\nCole numa IA (ChatGPT, Claude, Gemini). Depois corrija aqui o que ela apontar, ou cole o texto corrigido direto no Excel.');
  };
  $$('[data-cpd]', m).forEach(b => b.onclick = () => copyPlain(dayText(b.dataset.cpd)));
  $$('[data-cpx]', m).forEach(b => b.onclick = () => copyExcel(dayText(b.dataset.cpx, { comData: false })));
  $$('[data-add-dia]', m).forEach(b => b.onclick = () => escolherTipo(b.dataset.addDia));
  bindCards(m);
}
function escolherTipo(dia) {
  const tipos = Object.keys(TIPO_NOME);
  const r = prompt('O que registrar em ' + ddmm(dia) + '?\n' + tipos.map((t, i) => `${i + 1} = ${TIPO_NOME[t]}`).join('\n'), '1');
  const t = tipos[(+r || 0) - 1]; if (!t) return;
  go('form', { novo: t, dia });
}

// ---------- Tela: Pendências ----------
async function vPendencias(m) {
  const abertas = [], feitas = [];
  for (const e of S.entries) for (const [i, d] of (e.demandas || []).entries()) if (clean(d.texto)) (d.resolvida ? feitas : abertas).push({ e, d, i });
  abertas.sort((a, b) => a.e.date.localeCompare(b.e.date));
  feitas.sort((a, b) => (b.d.resolvidaEm || '').localeCompare(a.d.resolvidaEm || ''));
  const item = ({ e, d, i }) => `<div class="card"><div class="muted">${ddmm(e.date)} · ${esc(clean(e.clienteNome) || '—')}${e.rca ? ' · RCA ' + esc(rcaLabel(e.rca)) : ''}</div>
    <div class="${d.resolvida ? 'done' : ''}" style="margin:4px 0 8px">${esc(d.texto)}</div>
    <div class="row"><button class="btn sm ${d.resolvida ? '' : 'pri'}" data-tog="${e.id}|${i}">${d.resolvida ? 'Reabrir' : '✓ Resolvida'}</button><button class="btn sm" data-open="${e.id}">Abrir visita</button></div></div>`;
  m.innerHTML = `<h2>Pendências abertas (${abertas.length})</h2>${abertas.map(item).join('') || '<p class="muted">Nenhuma pendência aberta. 👍</p>'}
    ${feitas.length ? `<details><summary>Resolvidas (${feitas.length})</summary>${feitas.slice(0, 50).map(item).join('')}</details>` : ''}`;
  $$('[data-tog]', m).forEach(b => b.onclick = async () => {
    const [id, i] = b.dataset.tog.split('|'); const e = S.entries.find(x => x.id === id); const d = e.demandas[+i];
    d.resolvida = !d.resolvida; d.resolvidaEm = d.resolvida ? today() : null; await saveEntry(e); render();
  });
  $$('[data-open]', m).forEach(x => x.onclick = () => go('form', { id: x.dataset.open }));
}

// ---------- Tela: Mais ----------
async function vMais(m) {
  const last = await getMeta('lastBackup', 0);
  const pin = await getMeta('pin', null);
  let persist = null; try { persist = await navigator.storage?.persisted?.(); } catch { }
  let uso = ''; try { const est = await navigator.storage.estimate(); uso = `${(est.usage / 1048576).toFixed(1)} MB usados`; } catch { }
  m.innerHTML = `<h2>Relatórios</h2>
    <button class="bigbtn" id="gexp"><span class="ic">📄</span><span>Exportar / Relatório de visita<small>Por período e por RCA · PDF, JPG e planilha</small></span></button>
    <h2>Backup</h2><div class="card">
      <p class="muted">Último backup: ${last ? ddmmyyyy(isoDate(new Date(last))) : 'nunca'} · ${S.entries.length} registros · ${uso}</p>
      <div class="row"><button class="btn pri grow" id="bkexp">💾 Fazer backup (com fotos)</button></div>
      <div class="row" style="margin-top:8px"><button class="btn grow" id="bkimp">📂 Restaurar backup</button></div>
      <p class="muted">O arquivo pode ir para o WhatsApp, Drive ou e-mail. Para restaurar em outro aparelho, abra o RDV nele e toque em "Restaurar".</p>
      <p class="muted">Proteção contra limpeza automática do navegador: <b>${persist ? 'ativa ✓' : 'não confirmada'}</b>${persist ? '' : ' <button class="btn sm" id="persist">Ativar</button>'}</p>
    </div>
    ${await cartaoTranscricao()}
    <h2>Cadastros</h2>
    <button class="bigbtn" id="grcas"><span class="ic">👥</span><span>RCAs<small>${S.rcas.length} cadastrados</small></span></button>
    <button class="bigbtn" id="gcli" style="margin-top:10px"><span class="ic">🏪</span><span>Clientes<small>${S.clients.length} cadastrados · importar de planilha</small></span></button>
    <h2>Ajustes</h2><div class="card">
      <label class="row"><input type="checkbox" id="sMai" ${S.settings.maiusculas ? 'checked' : ''} style="width:22px;min-height:22px"> Títulos e tópicos em MAIÚSCULAS no texto do RDV</label>
      <label class="row" style="margin-top:8px"><input type="checkbox" id="sVis" ${S.settings.visitaA ? 'checked' : ''} style="width:22px;min-height:22px"> Visitas novas começam com "VISITA A"</label>
      <label class="f">Seu nome (sai no relatório)</label><input id="sSup" value="${esc(S.settings.supervisor || '')}" placeholder="Ex.: Seu nome – Supervisor de Vendas">
      <label class="f">Empresa (sai no relatório)</label><input id="sEmp" value="${esc(S.settings.empresa || '')}" placeholder="Nome da empresa">
      <div class="row" style="margin-top:12px"><button class="btn grow" id="pin">${pin ? '🔒 Trocar / tirar PIN' : '🔒 Criar PIN de abertura'}</button></div>
    </div>
    <p class="muted" style="text-align:center">RDV versão ${APP_VERSION}</p>`;
  $('#bkexp').onclick = exportBackup;
  $('#bkimp').onclick = importBackup;
  const pb = $('#persist'); if (pb) pb.onclick = async () => { const ok = await navigator.storage.persist(); toast(ok ? 'Proteção ativada.' : 'O navegador não liberou ainda. Instale o app na tela inicial e tente de novo.'); render(); };
  $('#grcas').onclick = () => go('rcas');
  $('#gcli').onclick = () => go('clientes');
  $('#sMai').onchange = async ev => { S.settings.maiusculas = ev.target.checked; await setMeta('settings', S.settings); toast('Ajuste salvo'); };
  $('#sVis').onchange = async ev => { S.settings.visitaA = ev.target.checked; await setMeta('settings', S.settings); toast('Ajuste salvo'); };
  $('#pin').onclick = configPin;
  $('#gexp').onclick = () => go('exportar');
  ligaCartaoTranscricao();
  const salvaTxt = debounce(async () => { S.settings.supervisor = clean($('#sSup').value); S.settings.empresa = clean($('#sEmp').value); await setMeta('settings', S.settings); toast('Ajuste salvo'); }, 700);
  $('#sSup').oninput = salvaTxt; $('#sEmp').oninput = salvaTxt;
}
async function vRcas(m, p) {
  if (!p.editar) {
    const st = {};
    for (const e of S.entries) if (e.rca) { const x = st[e.rca] || (st[e.rca] = { vis: 0, ult: '' }); if (e.tipo === 'visita') x.vis++; if (e.date > x.ult) x.ult = e.date; }
    const nCli = c => S.clients.filter(x => x.rca === c).length;
    m.innerHTML = `<div class="row"><button class="btn sm" onclick="history.back()">← Voltar</button><h2 class="grow" style="margin:0">RCAs</h2><button class="btn sm" id="editar">✏️ Editar lista</button></div>
      <p class="muted">Toque num RCA para ver o histórico de visitas.</p>
      ${S.rcas.map(r => { const x = st[r.codigo] || { vis: 0, ult: '' }; const nc = nCli(r.codigo); return `<div class="card entry" data-hist-rca="${esc(r.codigo)}" style="cursor:pointer"><div class="body"><div class="tt">${esc(r.codigo)} ${esc(r.nome)}</div>
        <div class="sub">${x.vis} visita(s)${x.ult ? ' · última em ' + ddmmyyyy(x.ult) : ''}${nc ? ' · ' + nc + ' clientes' : ''}</div></div><div style="font-size:22px;color:var(--mut)">›</div></div>`; }).join('') || '<p class="muted">Nenhum RCA cadastrado. Toque em "Editar lista".</p>'}`;
    $('#editar').onclick = () => go('rcas', { editar: true });
    $$('[data-hist-rca]', m).forEach(b => b.onclick = () => go('historico', { rca: b.dataset.histRca }));
    return;
  }
  m.innerHTML = `<div class="row"><button class="btn sm" onclick="history.back()">← Voltar</button><h2 class="grow" style="margin:0">Editar RCAs</h2></div>
    <div class="card">${S.rcas.map((r, i) => `<div class="row line"><input style="width:90px" inputmode="numeric" data-rc="${i}" data-k="codigo" value="${esc(r.codigo)}"><input class="grow" data-rc="${i}" data-k="nome" value="${esc(r.nome)}"><button class="x" data-rmrca="${i}">✕</button></div>`).join('')}
    <button class="btn sm" id="addrca" style="margin-top:8px">+ RCA</button></div>
    <div class="card"><h3>Colar lista de RCAs</h3><p class="muted">Um por linha: código e nome. Ex.: <b>100 Fulano</b></p>
    <textarea id="rcapaste" rows="4" placeholder="100 Fulano"></textarea><button class="btn pri full" id="rcaimp" style="margin-top:8px">Adicionar à lista</button></div>`;
  const salvar = debounce(async () => { await setMeta('rcas', S.rcas.filter(r => clean(r.codigo) || clean(r.nome))); toast('RCAs salvos'); }, 600);
  m.oninput = ev => { const t = ev.target; if (t.dataset.rc !== undefined) { S.rcas[+t.dataset.rc][t.dataset.k] = clean(t.value); salvar(); } };
  $$('[data-rmrca]', m).forEach(b => b.onclick = async () => { if (!confirm('Remover este RCA da lista?')) return; S.rcas.splice(+b.dataset.rmrca, 1); await setMeta('rcas', S.rcas); render(); });
  $('#addrca').onclick = () => { S.rcas.push({ codigo: '', nome: '' }); render(); };
  $('#rcaimp').onclick = async () => {
    let n = 0;
    for (const raw of $('#rcapaste').value.split(/\r?\n/)) {
      const mm = raw.trim().match(/^(\d+)[\s\t;,-]+(.+)$/); if (!mm) continue;
      const codigo = mm[1], nome = clean(mm[2]);
      const ex = S.rcas.find(r => r.codigo === codigo);
      if (ex) ex.nome = nome; else S.rcas.push({ codigo, nome });
      n++;
    }
    S.rcas = S.rcas.filter(r => clean(r.codigo) || clean(r.nome)).sort((a, b) => a.codigo - b.codigo);
    await setMeta('rcas', S.rcas); toast(`${n} RCA(s) adicionado(s)`); render();
  };
}
async function vClientes(m, p) {
  const q = clean(p.q || '').toLowerCase();
  const vis = {};
  for (const e of S.entries) if (e.tipo === 'visita' && clean(e.clienteCodigo)) { const x = vis[e.clienteCodigo] || (vis[e.clienteCodigo] = { n: 0, ult: '' }); x.n++; if (e.date > x.ult) x.ult = e.date; }
  const soVis = !!p.soVis;
  const todos = S.clients.filter(c => (!soVis || vis[c.codigo]) && (!q || c.nome.toLowerCase().includes(q) || (c.razao || '').toLowerCase().includes(q) || c.codigo.includes(q) || (c.cidade || '').toLowerCase().includes(q)))
    .sort((a, b) => (vis[b.codigo]?.ult || '').localeCompare(vis[a.codigo]?.ult || '') || a.nome.localeCompare(b.nome));
  const lista = todos.slice(0, 150);
  const semRca = S.clients.length && !S.clients.some(c => c.rca);
  m.innerHTML = `<div class="row"><button class="btn sm" onclick="history.back()">← Voltar</button><h2 class="grow" style="margin:0">Clientes (${S.clients.length})</h2></div>
    <div class="card"><h3>Importar de planilha</h3>
      <p class="muted">Abra a planilha de clientes (Excel .xlsx/.xls ou .csv) que está no celular — por exemplo, recebida pelo WhatsApp ou salva no Drive. O RDV acha sozinho as colunas de <b>código</b>, <b>nome</b> e <b>cidade</b>.</p>
      <button class="btn pri full" id="impxls">📂 Abrir planilha de clientes</button>
      <details><summary>Ou copiar e colar do Excel</summary>
      <p class="muted">Selecione as colunas Código, Nome e (opcional) Cidade, copie e cole aqui.</p>
      <textarea id="imptxt" rows="4" placeholder="82843	MD Supermercado	Brumado"></textarea>
      <button class="btn full" id="imp" style="margin-top:8px">Importar texto colado</button></details></div>
    ${semRca ? '<div class="banner" style="margin:0 0 10px">⚠️ Seus clientes foram importados sem o RCA. Importe a planilha de novo para o RDV preencher o RCA sozinho nas visitas.</div>' : ''}
    <input id="q" placeholder="🔎 Buscar por nome, código ou cidade" value="${esc(p.q || '')}">
    <div class="chips" style="margin-top:8px"><button class="chip ${soVis ? '' : 'on'}" data-sv="0">Todos</button><button class="chip ${soVis ? 'on' : ''}" data-sv="1">Só os visitados (${Object.keys(vis).length})</button></div>
    <p class="muted">Toque num cliente para ver o histórico. ${todos.length > lista.length ? `Mostrando ${lista.length} de ${todos.length} — use a busca.` : ''}</p>
    ${lista.map(c => { const x = vis[c.codigo]; return `<div class="card entry" data-hist-cli="${esc(c.codigo)}" style="cursor:pointer;padding:10px 12px"><div class="body"><div class="tt"><span class="badge">${esc(c.codigo)}</span>${esc(c.nome)}</div>
      <div class="sub">${esc([c.cidade, c.rca && 'RCA ' + rcaLabel(c.rca)].filter(Boolean).join(' · '))}${x ? ` · <b>${x.n} visita(s)</b>, última ${ddmm(x.ult)}` : ''}</div></div><div style="font-size:22px;color:var(--mut)">›</div></div>`; }).join('') || '<p class="muted">Nenhum cliente.</p>'}`;
  $$('[data-hist-cli]', m).forEach(b => b.onclick = () => go('historico', { cli: b.dataset.histCli }));
  $$('[data-sv]', m).forEach(b => b.onclick = () => { view.params.soVis = b.dataset.sv === '1'; history.replaceState(view, ''); render(); });
  const importar = async txt => {
    const rows = txt.split(/\r?\n/).map(raw => raw.split(raw.includes('\t') ? '\t' : ';').map(x => clean(x.replace(/^"|"$/g, ''))));
    await gravarClientes(lerClientes(rows));
  };
  $('#imp').onclick = () => importar($('#imptxt').value);
  $('#impxls').onclick = () => {
    const i = document.createElement('input'); i.type = 'file';
    i.accept = '.xlsx,.xls,.xlsm,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv';
    i.onchange = async () => { const f = i.files[0]; if (!f) return; try { await gravarClientes(lerClientes(await lerPlanilha(f))); } catch (err) { alert('Não consegui ler esta planilha.\n' + err.message); } };
    i.click();
  };
  $('#q').oninput = debounce(ev => { view.params.q = ev.target.value; history.replaceState(view, ''); render().then(() => { const qi = $('#q'); qi.focus(); qi.setSelectionRange(qi.value.length, qi.value.length); }); }, 300);
}

// ---------- Histórico por cliente ou por RCA ----------
async function vHistorico(m, p) {
  let titulo, sub = '', list;
  if (p.cli) {
    const c = S.clients.find(x => x.codigo === p.cli);
    const nomeVisto = S.entries.find(e => clean(e.clienteCodigo) === p.cli)?.clienteNome;
    titulo = `${p.cli} · ${c?.nome || nomeVisto || 'Cliente'}`;
    sub = [c?.razao && c.razao !== c.nome ? c.razao : '', c?.cidade, c?.rca && 'RCA ' + rcaLabel(c.rca)].filter(Boolean).join(' · ');
    list = S.entries.filter(e => clean(e.clienteCodigo) === p.cli);
  } else {
    titulo = 'RCA ' + rcaLabel(p.rca);
    list = S.entries.filter(e => e.rca === p.rca);
  }
  list.sort((a, b) => b.date.localeCompare(a.date) || b.order - a.order);
  const visitas = list.filter(e => e.tipo === 'visita');
  const abertas = []; for (const e of visitas) for (const d of (e.demandas || [])) if (clean(d.texto) && !d.resolvida) abertas.push({ e, d });
  const clientesDist = new Set(visitas.map(e => clean(e.clienteCodigo) || clean(e.clienteNome)));
  let h = `<div class="row"><button class="btn sm" onclick="history.back()">← Voltar</button><h2 class="grow" style="margin:0">${esc(titulo)}</h2></div>
    ${sub ? `<p class="muted" style="margin:6px 4px">${esc(sub)}</p>` : ''}
    <div class="r-resumo" style="margin:10px 0">
      <div><b>${visitas.length}</b><span>visitas</span></div>
      ${p.rca ? `<div><b>${clientesDist.size}</b><span>clientes</span></div>` : ''}
      <div><b>${abertas.length}</b><span>pendências abertas</span></div>
      <div><b>${visitas[0] ? ddmm(visitas[0].date) : '—'}</b><span>última visita</span></div>
    </div>
    <div class="row" style="margin-bottom:10px"><button class="btn grow" id="hnova">+ Nova visita${p.cli ? ' a este cliente' : ' com este RCA'}</button>${p.rca && list.length ? '<button class="btn grow" id="hrel">📄 Relatório</button>' : ''}</div>`;
  if (abertas.length) h += `<div class="card"><h3>📌 Pendências abertas</h3>${abertas.map(({ e, d }) => `<div class="line"><span class="muted">${ddmm(e.date)}${p.rca ? ' · ' + esc(clean(e.clienteNome)) : ''}</span><br>${esc(d.texto)}</div>`).join('')}</div>`;
  let dia = '';
  for (const e of list) {
    if (e.date !== dia) { dia = e.date; h += `<h3 style="margin:14px 4px 6px">${DIAS_SEMANA[parseISO(dia).getDay()]} · ${ddmmyyyy(dia)}</h3>`; }
    const linhas = entryLines(e);
    h += `<div class="card" data-open="${e.id}" style="cursor:pointer">
      <div><span class="badge">${TIPO_NOME[e.tipo]}</span><span class="muted">${hhmm(e.createdAt)}${e.tipo === 'visita' && clean(e.cidade) ? ' · ' + esc(clean(e.cidade)) : ''}${p.cli && e.rca ? ' · RCA ' + esc(rcaLabel(e.rca)) : ''}</span></div>
      <div class="tt" style="font-weight:700;margin:2px 0">${esc(e.tipo === 'combo' ? comboLine(e) : entryTitle(e))}</div>
      ${e.tipo === 'visita' && contatosOf(e).length ? `<div class="muted">Falamos com: ${esc(contatosTxt(e))}</div>` : ''}
      ${linhas.length ? `<div style="font-size:14px;margin-top:4px">${linhas.slice(0, 6).map(l => esc(l)).join('<br>')}${linhas.length > 6 ? `<br><span class="muted">+ ${linhas.length - 6} tópico(s)…</span>` : ''}</div>` : ''}
      <div class="muted" style="margin-top:4px;color:var(--pri)">Abrir ›</div></div>`;
  }
  if (!list.length) h += '<p class="muted">Nenhum registro ainda.</p>';
  m.innerHTML = h;
  $$('[data-open]', m).forEach(x => x.onclick = () => go('form', { id: x.dataset.open }));
  $('#hnova').onclick = () => {
    const c = p.cli ? S.clients.find(x => x.codigo === p.cli) : null;
    go('form', { novo: 'visita', pre: p.cli ? { clienteCodigo: p.cli, clienteNome: c?.nome || '', cidade: c?.cidade || '', rca: c?.rca && rcaByCode(c.rca) ? c.rca : '' } : { rca: p.rca } });
  };
  const hr = $('#hrel'); if (hr) hr.onclick = () => go('exportar', { rca: p.rca, de: list[list.length - 1].date, ate: list[0].date });
}

// ---------- Backup ----------
const blobToDataUrl = b => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
// Backup completo (sem filtro) ou só de um período/RCA (filtro da tela Exportar), para abrir no RDV de outro aparelho.
async function exportBackup(filtro = null) {
  toast('Preparando arquivo…');
  const entries = filtro ? filtrar(filtro) : await getAll('entries');
  const ids = new Set(entries.map(e => e.id));
  const photos = [];
  for (const p of await getAll('photos')) if (ids.has(p.entryId)) photos.push({ id: p.id, entryId: p.entryId, tema: p.tema, createdAt: p.createdAt, data: await blobToDataUrl(p.blob) });
  const audios = [];
  for (const a of await getAll('audios')) if (a.blob && ids.has(a.entryId)) audios.push({ ...a, blob: undefined, data: await blobToDataUrl(a.blob) });
  const meta = (await getAll('meta')).filter(x => x.key !== 'lastBackup' && x.key !== 'pin');
  const data = { app: 'RDV', versao: 2, exportadoEm: new Date().toISOString(), parcial: !!filtro, entries, clients: await getAll('clients'), meta, photos, audios };
  const nome = filtro ? nomeArq(filtro).replace('Relatorio-visitas', 'RDV-completo') + '.json' : `RDV-backup-${today()}.json`;
  const file = new File([JSON.stringify(data)], nome, { type: 'application/json' });
  const ok = await shareFiles([file], nome);
  if (ok === false) return;
  if (!filtro) await setMeta('lastBackup', Date.now());
  toast(`Arquivo pronto (${(file.size / 1048576).toFixed(1)} MB)`);
  if (!filtro) render();
}
function importBackup() {
  const i = document.createElement('input'); i.type = 'file'; i.accept = '.json,application/json';
  i.onchange = async () => {
    const f = i.files[0]; if (!f) return;
    let data; try { data = JSON.parse(await f.text()); } catch { return alert('Arquivo inválido.'); }
    if (data.app !== 'RDV') return alert('Este arquivo não é um backup do RDV.');
    if (!confirm(`Restaurar backup de ${new Date(data.exportadoEm).toLocaleString('pt-BR')}?\n${data.entries.length} registros, ${data.photos.length} fotos e ${(data.audios || []).length} áudios.\n\nRegistros iguais serão substituídos pela versão do backup; os outros que já estão aqui continuam.`)) return;
    for (const e of data.entries) await put('entries', e);
    for (const c of data.clients) await put('clients', c);
    for (const x of data.meta) if (x.key !== 'pin') await put('meta', x);
    for (const p of data.photos) { const blob = await (await fetch(p.data)).blob(); await put('photos', { id: p.id, entryId: p.entryId, tema: p.tema, createdAt: p.createdAt, blob }); }
    for (const a of (data.audios || [])) { const { data: du, ...rest } = a; const blob = await (await fetch(du)).blob(); await put('audios', { ...rest, blob }); }
    await loadAll(); toast('Backup restaurado!'); render();
  };
  i.click();
}

// ---------- PIN ----------
async function sha(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('rdv:' + s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
async function configPin() {
  const atual = await getMeta('pin', null);
  if (atual) {
    const a = prompt('Digite o PIN atual:'); if (a === null) return;
    if (await sha(a) !== atual) return alert('PIN errado.');
  }
  const n = prompt(atual ? 'Novo PIN de 4 dígitos (deixe vazio para TIRAR o PIN):' : 'Crie um PIN de 4 dígitos:');
  if (n === null) return;
  if (!n) { await del('meta', 'pin'); toast('PIN removido'); return render(); }
  if (!/^\d{4}$/.test(n)) return alert('Use exatamente 4 números.');
  if (prompt('Repita o PIN:') !== n) return alert('Os PINs não conferem.');
  await setMeta('pin', await sha(n)); toast('PIN criado'); render();
}
let hiddenAt = 0;
async function lock() {
  const pin = await getMeta('pin', null); if (!pin) return;
  const L = $('#lock'); let v = '';
  L.innerHTML = `<div style="font-size:20px;font-weight:700">RDV</div><div>Digite seu PIN</div><div class="dots" id="dots"></div>
    <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, '⌫'].map(k => k === '' ? '<span></span>' : `<button data-k="${k}">${k}</button>`).join('')}</div>`;
  L.classList.remove('hidden');
  L.onclick = async ev => {
    const k = ev.target.dataset.k; if (k === undefined) return;
    v = k === '⌫' ? v.slice(0, -1) : (v + k).slice(0, 4);
    $('#dots').textContent = '●'.repeat(v.length);
    if (v.length === 4) {
      if (await sha(v) === pin) { L.classList.add('hidden'); L.innerHTML = ''; }
      else { v = ''; $('#dots').textContent = 'PIN errado'; if (navigator.vibrate) navigator.vibrate(200); }
    }
  };
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); if (cur && !isEmpty(cur)) saveEntry(cur); }
  else if (hiddenAt && Date.now() - hiddenAt > 5 * 60 * 1000) lock();
});

// ---------- Início ----------
(async function start() {
  await loadAll();
  await lock();
  try { if (navigator.storage?.persist && !(await navigator.storage.persisted())) navigator.storage.persist(); } catch { }
  view = history.state || { name: 'hoje', params: {} };
  if (view.name === 'form' && view.params.novoTemp && !S.entries.find(e => e.id === view.params.id)) view = { name: 'hoje', params: {} };
  history.replaceState(view, '');
  render();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw?.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            $('#banner').insertAdjacentHTML('afterbegin', '<div class="banner" id="upd">🔄 Nova versão do RDV disponível. <a href="#">Toque para atualizar</a></div>');
            $('#upd').onclick = ev => { ev.preventDefault(); nw.postMessage('skip'); };
          }
        });
      });
    });
    // Recarrega só quando uma versão NOVA assume (não na primeira instalação).
    let reloaded = false; const tinhaVersao = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (tinhaVersao && !reloaded) { reloaded = true; location.reload(); } });
  }
})();
