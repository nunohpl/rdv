/* RDV – Exportação: relatório de visita (PDF/JPG), planilha e texto para IA; importação de clientes. */
'use strict';

function loadScript(src) {
  return new Promise((res, rej) => {
    const ok = { 'vendor/html2canvas.min.js': () => window.html2canvas, 'vendor/jspdf.umd.min.js': () => window.jspdf, 'vendor/xlsx.full.min.js': () => window.XLSX }[src];
    if (ok && ok()) return res();
    const s = document.createElement('script'); s.src = src;
    s.onload = () => res(); s.onerror = () => rej(new Error('Não carregou ' + src));
    document.head.appendChild(s);
  });
}
// Entrega os arquivos: "baixar" salva na pasta Downloads do aparelho; "enviar" abre WhatsApp, e-mail, Drive…
// Devolve false se a pessoa cancelou.
async function shareFiles(files, titulo) {
  const enviar = S.settings.entrega === 'enviar';
  if (enviar && navigator.canShare && navigator.canShare({ files })) {
    try { await navigator.share({ files, title: titulo }); return true; } catch (err) { if (err.name === 'AbortError') return false; }
  }
  for (const f of files) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 15000);
    if (files.length > 1) await new Promise(r => setTimeout(r, 400));
  }
  toast(files.length > 1 ? `${files.length} arquivos salvos em Downloads` : `Salvo em Downloads: ${files[0].name}`);
  return true;
}

// ---------- Filtro ----------
const GRUPOS = { visita: ['visita'], admin: ['admin', 'email'], combo: ['combo'], cadastro: ['cadastro'] };
function filtroPadrao(p) {
  return {
    de: p.de || S.weekStart, ate: p.ate || addDays(S.weekStart, 6), rca: p.rca || '',
    g: p.g || { visita: true, admin: true, combo: true, cadastro: true }, fotos: p.fotos ?? true, trans: p.trans ?? false
  };
}
function filtrar(f) {
  const tipos = Object.keys(GRUPOS).filter(k => f.g[k]).flatMap(k => GRUPOS[k]);
  return S.entries.filter(e => e.date >= f.de && e.date <= f.ate && tipos.includes(e.tipo) && (!f.rca || e.rca === f.rca))
    .sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
}
const rcaNome = c => c ? rcaLabel(c) : 'Todos os RCAs';
const nomeArq = f => `Relatorio-visitas-${f.rca ? 'RCA' + f.rca + '-' : ''}${ddmm(f.de).replace('/', '-')}_a_${ddmm(f.ate).replace('/', '-')}`;

// ---------- Tela ----------
async function vExportar(m, p) {
  const f = filtroPadrao(p);
  view.params = Object.assign(view.params || {}, f);
  const list = filtrar(f);
  const nVis = list.filter(e => e.tipo === 'visita').length;
  const rcasUsados = [...new Set(S.entries.map(e => e.rca).filter(Boolean))];
  const opcoesRca = S.rcas.concat(rcasUsados.filter(c => !rcaByCode(c)).map(c => ({ codigo: c, nome: '' })));
  const chk = (k, txt) => `<label class="row" style="margin-top:6px"><input type="checkbox" data-g="${k}" ${f.g[k] ? 'checked' : ''} style="width:22px;min-height:22px"> ${txt}</label>`;
  const hojeIso = today(), mes0 = hojeIso.slice(0, 8) + '01';
  m.innerHTML = `<div class="row"><button class="btn sm" onclick="history.back()">← Voltar</button><h2 class="grow" style="margin:0">Exportar</h2></div>
    <div class="card">
      <label class="f">Período</label>
      <div class="row"><input type="date" id="fde" value="${f.de}" class="grow"><span>a</span><input type="date" id="fate" value="${f.ate}" class="grow"></div>
      <div class="chips" style="margin-top:8px">
        <button class="chip" data-per="${S.weekStart}|${addDays(S.weekStart, 6)}">Semana na tela</button>
        <button class="chip" data-per="${mondayOf(hojeIso)}|${addDays(mondayOf(hojeIso), 6)}">Esta semana</button>
        <button class="chip" data-per="${addDays(mondayOf(hojeIso), -7)}|${addDays(mondayOf(hojeIso), -1)}">Semana passada</button>
        <button class="chip" data-per="${mes0}|${hojeIso}">Este mês</button>
      </div>
      <label class="f">RCA</label>
      <select id="frca"><option value="">Todos os RCAs</option>${opcoesRca.map(r => `<option value="${esc(r.codigo)}" ${r.codigo === f.rca ? 'selected' : ''}>${esc((r.codigo + ' ' + r.nome).trim())}</option>`).join('')}</select>
      <label class="f">Incluir</label>
      ${chk('visita', 'Visitas a clientes')}${chk('admin', 'Assuntos administrativos e do e-mail')}${chk('combo', 'Combos e verbas')}${chk('cadastro', 'Cadastros e reativações')}
      <label class="row" style="margin-top:6px"><input type="checkbox" id="ffotos" ${f.fotos ? 'checked' : ''} style="width:22px;min-height:22px"> Fotos no relatório</label>
      <label class="row" style="margin-top:6px"><input type="checkbox" id="ftrans" ${f.trans ? 'checked' : ''} style="width:22px;min-height:22px"> Transcrições dos áudios</label>
      <p class="muted" style="margin-top:10px"><b>${list.length}</b> registro(s) encontrado(s), sendo <b>${nVis}</b> visita(s).</p>
    </div>
    <div class="card"><label class="f" style="margin-top:0">Os arquivos devem…</label>
      <div class="chips"><button class="chip ${S.settings.entrega !== 'enviar' ? 'on' : ''}" data-ent="baixar">⬇️ Ser baixados no celular</button><button class="chip ${S.settings.entrega === 'enviar' ? 'on' : ''}" data-ent="enviar">📤 Ir para WhatsApp / e-mail / Drive</button></div>
      <p class="muted" style="margin-top:6px">${S.settings.entrega === 'enviar' ? 'Ao gerar, abre a lista de aplicativos para enviar.' : 'Ficam na pasta <b>Downloads</b> do celular. Passe para o notebook pelo cabo USB, Drive ou WhatsApp Web.'}</p></div>
    <button class="btn pri full" id="gerar" ${list.length ? '' : 'disabled'}>📄 Relatório de visita (PDF e JPG)</button>
    <div class="row" style="margin-top:8px"><button class="btn grow" id="txt" ${list.length ? '' : 'disabled'}>📝 Texto (TXT)</button><button class="btn grow" id="csv" ${list.length ? '' : 'disabled'}>📊 Planilha (Excel)</button></div>
    <div class="row" style="margin-top:8px"><button class="btn grow" id="completo" ${list.length ? '' : 'disabled'}>💾 Arquivo completo (abrir no RDV do notebook)</button></div>
    <div class="row" style="margin-top:8px"><button class="btn grow" id="ia" ${list.length ? '' : 'disabled'}>🤖 Copiar texto para IA</button></div>
    <div id="rptout"></div>`;
  const salva = () => { history.replaceState(view, ''); render(); };
  $('#fde').onchange = ev => { if (ev.target.value) { view.params.de = ev.target.value; salva(); } };
  $('#fate').onchange = ev => { if (ev.target.value) { view.params.ate = ev.target.value; salva(); } };
  $('#frca').onchange = ev => { view.params.rca = ev.target.value; salva(); };
  $$('[data-per]', m).forEach(b => b.onclick = () => { const [a, z] = b.dataset.per.split('|'); view.params.de = a; view.params.ate = z; salva(); });
  $$('[data-g]', m).forEach(c => c.onchange = () => { view.params.g = Object.assign({}, f.g, { [c.dataset.g]: c.checked }); salva(); });
  $('#ffotos').onchange = ev => { view.params.fotos = ev.target.checked; history.replaceState(view, ''); };
  $('#ftrans').onchange = ev => { view.params.trans = ev.target.checked; history.replaceState(view, ''); };
  $('#gerar').onclick = () => gerarRelatorio(filtroPadrao(view.params));
  $('#csv').onclick = () => exportarCSV(filtroPadrao(view.params));
  $('#txt').onclick = () => exportarTXT(filtroPadrao(view.params));
  $('#completo').onclick = () => exportBackup(filtroPadrao(view.params));
  $$('[data-ent]', m).forEach(b => b.onclick = async () => { S.settings.entrega = b.dataset.ent; await setMeta('settings', S.settings); history.replaceState(view, ''); render(); });
  $('#ia').onclick = () => textoIA(filtroPadrao(view.params));
}

// ---------- Fotos para o relatório (corta no formato 4:3) ----------
function miniatura(blob, w = 480, h = 360) {
  return new Promise(res => {
    const img = new Image(); const u = URL.createObjectURL(blob);
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const k = Math.max(w / img.width, h / img.height);
      const sw = w / k, sh = h / k;
      c.getContext('2d').drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, w, h);
      URL.revokeObjectURL(u); res(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(u); res(null); };
    img.src = u;
  });
}

// ---------- Montagem do relatório ----------
async function blocosRelatorio(f) {
  const list = filtrar(f);
  const B = []; // { html, keep }
  const add = (html, keep = false) => B.push({ html, keep });
  const visitas = list.filter(e => e.tipo === 'visita');
  const clientes = new Set(visitas.map(e => clean(e.clienteCodigo) || clean(e.clienteNome)));
  const cidades = [...new Set(visitas.map(e => up(clean(e.cidade))).filter(Boolean))];
  const pend = []; for (const e of visitas) for (const d of (e.demandas || [])) if (clean(d.texto) && !d.resolvida) pend.push({ e, d });
  const combos = list.filter(e => e.tipo === 'combo');
  let nFotos = 0;
  const fotosDe = {}, transDe = {};
  for (const e of list) {
    if (f.fotos && e.tipo === 'visita') { const ph = (await photosOf(e.id)).sort((a, b) => a.createdAt - b.createdAt); fotosDe[e.id] = ph; nFotos += ph.length; }
    if (f.trans) transDe[e.id] = (await audiosOf(e.id)).filter(a => clean(a.transcricao));
  }
  const periodo = f.de === f.ate ? ddmmyyyy(f.de) : `${ddmmyyyy(f.de)} a ${ddmmyyyy(f.ate)}`;

  add(`<div class="r-capa">
    <div class="r-emp">${esc(S.settings.empresa || '')}</div>
    <div class="r-tit">RELATÓRIO DE VISITAS</div>
    <table class="r-info"><tr><td>Período</td><td><b>${periodo}</b></td></tr>
      <tr><td>RCA</td><td><b>${esc(rcaNome(f.rca))}</b></td></tr>
      ${S.settings.supervisor ? `<tr><td>Supervisor</td><td><b>${esc(S.settings.supervisor)}</b></td></tr>` : ''}
      <tr><td>Emitido em</td><td>${ddmmyyyy(today())} às ${hhmm(Date.now())}</td></tr></table></div>`);
  add(`<div class="r-resumo">
    <div><b>${visitas.length}</b><span>visitas</span></div><div><b>${clientes.size}</b><span>clientes</span></div>
    <div><b>${pend.length}</b><span>pendências abertas</span></div><div><b>${combos.length}</b><span>combos / verbas</span></div>
    ${f.fotos ? `<div><b>${nFotos}</b><span>fotos</span></div>` : ''}</div>
    ${cidades.length ? `<div class="r-cid">Cidades: ${esc(cidades.join(', '))}</div>` : ''}`);

  const dias = [...new Set(list.map(e => e.date))];
  for (const d of dias) {
    const doDia = list.filter(e => e.date === d);
    add(`<div class="r-dia">${DIAS_SEMANA[parseISO(d).getDay()]} · ${ddmmyyyy(d)}</div>`, true);
    for (const e of doDia.filter(x => x.tipo !== 'combo')) {
      if (e.tipo === 'visita') {
        const meta = [clean(e.cidade) && up(clean(e.cidade)), hhmm(e.createdAt), e.rca && 'RCA ' + rcaLabel(e.rca)].filter(Boolean).join(' · ');
        add(`<div class="r-v r-vtop"><div class="r-cli">${clean(e.clienteCodigo) ? `<span class="r-cod">${esc(e.clienteCodigo)}</span> ` : ''}${esc(up(clean(e.clienteNome) || 'Cliente não informado'))}</div>
          <div class="r-meta">${esc(meta)}</div>${contatosOf(e).length ? `<div class="r-meta">Falamos com: <b>${esc(contatosTxt(e))}</b></div>` : ''}</div>`, true);
        for (const tema of TEMAS) {
          const ns = (e.notas || []).filter(n => n.tema === tema && clean(n.texto));
          if (!ns.length) continue;
          add(`<div class="r-v"><div class="r-tema">${esc(tema)}</div><ul>${ns.map(n => `<li>${esc(fmt(n.texto))}${n.industria ? ` <span class="r-ind">${esc(n.industria)}</span>` : ''}</li>`).join('')}</ul></div>`);
        }
        const obs = (e.obsRca || []).filter(o => clean(o.texto));
        if (obs.length) add(`<div class="r-v"><div class="r-tema">Observações ao RCA</div><ul>${obs.map(o => `<li>${esc(fmt(o.texto))}</li>`).join('')}</ul></div>`);
        const dem = (e.demandas || []).filter(o => clean(o.texto));
        if (dem.length) add(`<div class="r-v"><div class="r-tema">Demandas e pendências</div><ul class="r-dem">${dem.map(o => `<li class="${o.resolvida ? 'ok' : 'ab'}">${o.resolvida ? '✔ Resolvida' : '⏳ Aberta'} — ${esc(fmt(o.texto))}</li>`).join('')}</ul></div>`);
        const ph = fotosDe[e.id] || [];
        for (let i = 0; i < ph.length; i += 3) {
          const linha = [];
          for (const x of ph.slice(i, i + 3)) { const u = await miniatura(x.blob); if (u) linha.push(`<figure><img src="${u}"><figcaption>${esc(x.tema)}</figcaption></figure>`); }
          if (linha.length) add(`<div class="r-v r-fotos">${linha.join('')}</div>`);
        }
        for (const a of (transDe[e.id] || [])) add(`<div class="r-v"><div class="r-tema">Transcrição do áudio (${hhmm(a.createdAt)})</div><div class="r-trans">${esc(a.transcricao)}</div></div>`);
        add(`<div class="r-vfim"></div>`);
      } else {
        const linhas = entryLines(e);
        const tag = e.tipo === 'email' ? 'E-mail' : e.tipo === 'cadastro' ? 'Cadastro' : 'Administrativo';
        add(`<div class="r-a"><div class="r-atit"><span class="r-tag">${tag}</span> ${esc(entryTitle(e))}</div>${linhas.length ? `<ul>${linhas.map(l => `<li>${esc(l.replace(/^- /, ''))}</li>`).join('')}</ul>` : ''}</div>`);
      }
    }
    const cb = doDia.filter(x => x.tipo === 'combo');
    if (cb.length) add(`<div class="r-a"><div class="r-atit"><span class="r-tag">Combos</span> COMBOS E VERBAS SOLICITADOS</div><table class="r-tab">${cb.map(c => `<tr><td>${esc(c.comboTipo)}</td><td>${esc(c.clienteCodigo)}</td><td>${esc(c.clienteNome)}${clean(c.obs) ? ` <i>${esc(clean(c.obs))}</i>` : ''}</td></tr>`).join('')}</table></div>`);
  }
  if (pend.length) {
    add(`<div class="r-dia">PENDÊNCIAS EM ABERTO</div>`, true);
    for (let i = 0; i < pend.length; i += 6)
      add(`<table class="r-tab r-pend">${pend.slice(i, i + 6).map(({ e, d }) => `<tr><td>${ddmm(e.date)}</td><td>${esc(clean(e.clienteNome))}</td><td>${esc(fmt(d.texto))}</td></tr>`).join('')}</table>`);
  }
  return { blocos: B, periodo };
}

function paginar(blocos, area, rodape, cabecalho) {
  area.innerHTML = '';
  const pages = []; let body;
  const nova = () => {
    const pg = document.createElement('div'); pg.className = 'rpt-page';
    pg.innerHTML = '<div class="rpt-body"></div><div class="rpt-foot"></div>';
    area.appendChild(pg); body = pg.firstChild;
    if (pages.length) body.insertAdjacentHTML('beforeend', cabecalho);
    pages.push(pg);
  };
  nova();
  for (const b of blocos) {
    body.insertAdjacentHTML('beforeend', b.html);
    const el = body.lastElementChild; if (b.keep) el.dataset.keep = '1';
    if (body.scrollHeight <= body.clientHeight + 1) continue;
    const minimo = pages.length > 1 ? 2 : 1; // bloco sozinho maior que a página: deixa como está
    if (body.children.length <= minimo) continue;
    el.remove();
    const mover = [];
    while (body.lastElementChild && body.lastElementChild.dataset.keep && body.children.length > minimo) { mover.unshift(body.lastElementChild); body.lastElementChild.remove(); }
    nova();
    mover.forEach(x => body.appendChild(x));
    body.insertAdjacentHTML('beforeend', b.html); if (b.keep) body.lastElementChild.dataset.keep = '1';
  }
  pages.forEach((pg, i) => pg.querySelector('.rpt-foot').textContent = `${rodape} · Página ${i + 1} de ${pages.length}`);
  return pages;
}

async function gerarRelatorio(f) {
  const out = $('#rptout');
  out.innerHTML = '<div class="card"><b id="rprog">Montando o relatório…</b></div>';
  const prog = t => { const x = $('#rprog'); if (x) x.textContent = t; };
  try {
    await Promise.all([loadScript('vendor/html2canvas.min.js'), loadScript('vendor/jspdf.umd.min.js')]);
    const { blocos, periodo } = await blocosRelatorio(f);
    let area = $('#rpt-area');
    if (!area) { area = document.createElement('div'); area.id = 'rpt-area'; document.body.appendChild(area); }
    const cab = `<div class="r-cab">RELATÓRIO DE VISITAS · ${esc(periodo)} · ${esc(rcaNome(f.rca))}</div>`;
    const pages = paginar(blocos, area, [S.settings.empresa, S.settings.supervisor].filter(Boolean).join(' · ') || 'RDV', cab);
    // espera as fotos carregarem (sem usar decode(), que trava em elementos fora da tela)
    await Promise.all($$('img', area).map(i => i.complete ? null : new Promise(r => { i.onload = i.onerror = r; setTimeout(r, 5000); })));
    const jpgs = [];
    for (let i = 0; i < pages.length; i++) {
      prog(`Gerando página ${i + 1} de ${pages.length}…`);
      const c = await html2canvas(pages[i], { scale: 2, backgroundColor: '#ffffff', logging: false, windowWidth: 794 });
      jpgs.push(c.toDataURL('image/jpeg', 0.86));
    }
    area.innerHTML = '';
    prog('Gerando PDF…');
    const pdf = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4', compress: true });
    jpgs.forEach((u, i) => { if (i) pdf.addPage(); pdf.addImage(u, 'JPEG', 0, 0, 595.28, 841.89); });
    const base = nomeArq(f);
    const pdfFile = new File([pdf.output('blob')], base + '.pdf', { type: 'application/pdf' });
    const jpgFiles = await Promise.all(jpgs.map(async (u, i) => new File([await (await fetch(u)).blob()], `${base}${jpgs.length > 1 ? '-pag' + (i + 1) : ''}.jpg`, { type: 'image/jpeg' })));
    out.innerHTML = `<div class="card"><b>Relatório pronto: ${pages.length} página(s)</b>
      <div class="row" style="margin-top:8px"><button class="btn pri grow" id="shpdf">📄 Enviar PDF</button><button class="btn grow" id="shjpg">🖼️ Enviar JPG</button></div>
      <p class="muted">PDF ${(pdfFile.size / 1048576).toFixed(1)} MB. Os botões abrem o WhatsApp, e-mail, Drive…</p></div>
      <div class="rpt-prev">${jpgs.map(u => `<img src="${u}" alt="página">`).join('')}</div>`;
    $('#shpdf').onclick = () => shareFiles([pdfFile], base);
    $('#shjpg').onclick = () => shareFiles(jpgFiles, base);
    const lbl = S.settings.entrega === 'enviar' ? ['📄 Enviar PDF', '🖼️ Enviar JPG'] : ['⬇️ Baixar PDF', '⬇️ Baixar JPG'];
    $('#shpdf').textContent = lbl[0]; $('#shjpg').textContent = lbl[1];
  } catch (err) {
    out.innerHTML = `<div class="card"><b>Não consegui gerar o relatório.</b><p class="muted">${esc(err.message || err)}</p></div>`;
  }
}

// ---------- Planilha (CSV que abre no Excel) ----------
function exportarCSV(f) {
  const list = filtrar(f);
  const H = ['Data', 'Dia', 'Hora', 'Tipo', 'Cidade', 'Código', 'Cliente', 'RCA', 'Com quem falei', 'Tema / Título', 'Indústria', 'Texto', 'Situação'];
  const R = [];
  for (const e of list) {
    const base = [ddmmyyyy(e.date), DIAS_SEMANA[parseISO(e.date).getDay()], hhmm(e.createdAt), TIPO_NOME[e.tipo], clean(e.cidade), clean(e.clienteCodigo), clean(e.clienteNome), e.rca ? rcaLabel(e.rca) : '', e.tipo === 'visita' ? contatosTxt(e) : ''];
    const linha = (tema, ind, txt, sit = '') => R.push([...base, tema, ind, txt, sit]);
    if (e.tipo === 'visita') {
      const n0 = R.length;
      for (const tema of TEMAS) for (const n of (e.notas || [])) if (n.tema === tema && clean(n.texto)) linha(tema, n.industria || '', clean(n.texto));
      for (const o of (e.obsRca || [])) if (clean(o.texto)) linha('Observação ao RCA', '', clean(o.texto));
      for (const d of (e.demandas || [])) if (clean(d.texto)) linha('Pendência', '', clean(d.texto), d.resolvida ? 'Resolvida' + (d.resolvidaEm ? ' em ' + ddmmyyyy(d.resolvidaEm) : '') : 'Aberta');
      if (R.length === n0) linha('', '', '');
    } else if (e.tipo === 'combo') linha(clean(e.comboTipo), '', clean(e.obs));
    else if (e.tipo === 'cadastro') { base[6] = [clean(e.razao), clean(e.fantasia) && `(${clean(e.fantasia)})`].filter(Boolean).join(' '); linha(e.cadTipo === 'reativacao' ? 'Reativação' : 'Novo cadastro', '', clean(e.obs)); }
    else { const tps = (e.topicos || []).filter(t => clean(t.texto)); if (!tps.length) linha(clean(e.titulo), '', ''); tps.forEach(t => linha(clean(e.titulo), '', clean(t.texto))); }
  }
  const cel = v => { v = String(v ?? ''); return /[";\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const csv = '﻿' + [H, ...R].map(r => r.map(cel).join(';')).join('\r\n');
  return shareFiles([new File([csv], nomeArq(f).replace('Relatorio-visitas', 'RDV-planilha') + '.csv', { type: 'text/csv' })], 'Planilha RDV');
}

// ---------- Arquivo TXT ----------
// Parte 1: o texto do RDV no formato de sempre (para colar no Excel). Parte 2: o detalhe de cada visita.
function textoDetalhado(f) {
  const list = filtrar(f);
  const L = [];
  for (const d of [...new Set(list.map(e => e.date))]) {
    L.push('', `${DIAS_SEMANA[parseISO(d).getDay()]} ${ddmmyyyy(d)}`, '-'.repeat(40));
    for (const e of list.filter(x => x.date === d)) {
      if (e.tipo === 'visita') {
        L.push('', `CLIENTE: ${[clean(e.clienteCodigo), up(clean(e.clienteNome))].filter(Boolean).join(' ')}`);
        L.push(`Cidade: ${clean(e.cidade) || '—'}  |  Hora: ${hhmm(e.createdAt)}  |  RCA: ${e.rca ? rcaLabel(e.rca) : '—'}`);
        if (contatosOf(e).length) L.push(`Falamos com: ${contatosTxt(e)}`);
        for (const tema of TEMAS) {
          const ns = (e.notas || []).filter(n => n.tema === tema && clean(n.texto));
          if (!ns.length) continue;
          L.push(`  ${tema}:`);
          ns.forEach(n => L.push(`    - ${clean(n.texto)}${n.industria ? ' [' + n.industria + ']' : ''}`));
        }
        const obs = (e.obsRca || []).filter(o => clean(o.texto));
        if (obs.length) { L.push('  Observações ao RCA:'); obs.forEach(o => L.push(`    - ${clean(o.texto)}`)); }
        const dem = (e.demandas || []).filter(o => clean(o.texto));
        if (dem.length) { L.push('  Demandas e pendências:'); dem.forEach(o => L.push(`    - [${o.resolvida ? 'RESOLVIDA' : 'ABERTA'}] ${clean(o.texto)}`)); }
        for (const a of (f.trans ? (e._trans || []) : [])) L.push(`  Transcrição do áudio (${hhmm(a.createdAt)}):`, `    ${clean(a.transcricao)}`);
      } else if (e.tipo === 'combo') {
        if (!L[L.length - 1].startsWith('- ')) L.push('', 'COMBOS E VERBAS:');
        L.push(`- ${comboLine(e)}${e.rca ? '  (RCA ' + rcaLabel(e.rca) + ')' : ''}`);
      } else {
        L.push('', `${TIPO_NOME[e.tipo].toUpperCase()}: ${entryTitle(e)}`, ...entryLines(e).map(l => '  ' + l));
      }
    }
  }
  return L;
}
async function exportarTXT(f) {
  const list = filtrar(f);
  if (f.trans) for (const e of list) e._trans = (await audiosOf(e.id)).filter(a => clean(a.transcricao));
  const periodo = f.de === f.ate ? ddmmyyyy(f.de) : `${ddmmyyyy(f.de)} a ${ddmmyyyy(f.ate)}`;
  const barra = '='.repeat(48);
  const L = ['RDV - RELATÓRIO DE VISITAS', `Período: ${periodo}`, `RCA: ${rcaNome(f.rca)}`];
  if (S.settings.supervisor) L.push(`Supervisor: ${S.settings.supervisor}`);
  if (S.settings.empresa) L.push(`Empresa: ${S.settings.empresa}`);
  L.push(`Emitido em: ${ddmmyyyy(today())} às ${hhmm(Date.now())}`, '', barra, 'PARTE 1 - TEXTO DO RDV (para colar no Excel)', barra, '');
  const dias = [...new Set(list.map(e => e.date))];
  L.push(dias.map(d => dayText(d, { lista: list })).filter(Boolean).join('\n\n\n'));
  L.push('', '', barra, 'PARTE 2 - DETALHE DAS VISITAS', barra, ...textoDetalhado(f));
  const pend = []; for (const e of list) for (const d of (e.demandas || [])) if (clean(d.texto) && !d.resolvida) pend.push(`${ddmm(e.date)} - ${clean(e.clienteNome)}: ${clean(d.texto)}`);
  if (pend.length) L.push('', '', barra, 'PENDÊNCIAS EM ABERTO', barra, ...pend);
  for (const e of list) delete e._trans;
  const txt = '﻿' + L.join('\n').replace(/\r?\n/g, '\r\n');
  await shareFiles([new File([txt], nomeArq(f).replace('Relatorio-visitas', 'RDV-texto') + '.txt', { type: 'text/plain' })], 'Texto RDV');
}

// ---------- Texto para IA ----------
function textoIA(f) {
  const list = filtrar(f);
  const periodo = `${ddmmyyyy(f.de)} a ${ddmmyyyy(f.ate)}`;
  let t = `Monte um RELATÓRIO DE VISITA profissional, em português, para enviar ao RCA ${f.rca ? rcaLabel(f.rca) : '(todos os RCAs)'}, referente ao período ${periodo}. `
    + 'Organize por dia e por cliente, destaque pontos positivos, pontos de melhoria (exposição, ruptura, mix, preço, promoções) e as pendências com responsável. '
    + 'Use linguagem clara e objetiva. Não invente informações que não estão abaixo.\n\nDADOS:\n';
  for (const d of [...new Set(list.map(e => e.date))]) {
    t += `\n${DIAS_SEMANA[parseISO(d).getDay()]} ${ddmmyyyy(d)}\n`;
    for (const e of list.filter(x => x.date === d)) {
      if (e.tipo === 'visita') {
        t += `\nCliente: ${[clean(e.clienteCodigo), clean(e.clienteNome)].filter(Boolean).join(' ')}${clean(e.cidade) ? ' – ' + clean(e.cidade) : ''}${e.rca ? ' – RCA ' + rcaLabel(e.rca) : ''}\n`;
        if (contatosOf(e).length) t += `Falamos com: ${contatosTxt(e)}\n`;
        for (const tema of TEMAS) for (const n of (e.notas || [])) if (n.tema === tema && clean(n.texto)) t += `- ${tema}${n.industria ? ' (' + n.industria + ')' : ''}: ${clean(n.texto)}\n`;
        for (const o of (e.obsRca || [])) if (clean(o.texto)) t += `- Observação ao RCA: ${clean(o.texto)}\n`;
        for (const x of (e.demandas || [])) if (clean(x.texto)) t += `- Pendência (${x.resolvida ? 'resolvida' : 'aberta'}): ${clean(x.texto)}\n`;
      } else if (e.tipo === 'combo') t += `- ${comboLine(e)}\n`;
      else t += `\n${entryTitle(e)}\n${entryLines(e).join('\n')}\n`;
    }
  }
  copyPlain(t);
  alert('Texto copiado! Cole numa IA (ChatGPT, Claude, Gemini) para ela redigir o relatório.');
}

// ---------- Importação de clientes ----------
async function lerPlanilha(file) {
  if (/\.(csv|txt)$/i.test(file.name)) {
    const txt = await file.text();
    return txt.split(/\r?\n/).map(raw => raw.split(raw.includes('\t') ? '\t' : ';').map(x => clean(x.replace(/^"|"$/g, ''))));
  }
  await loadScript('vendor/xlsx.full.min.js');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  let melhor = [];
  for (const nome of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, raw: false, defval: '' });
    if (rows.length > melhor.length) melhor = rows;
  }
  return melhor.map(r => r.map(v => clean(v)));
}
function lerClientes(rows) {
  const norm = v => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  let hr = -1, iCod = -1, iNome = -1, iRaz = -1, iCid = -1, iRca = -1;
  for (let r = 0; r < Math.min(rows.length, 15) && hr < 0; r++) {
    const cs = rows[r].map(norm);
    const cod = cs.findIndex(c => /^(cod|codigo|cód)/.test(c) || c === 'cliente cod' || /cod.*cli/.test(c));
    if (cod < 0) continue;
    hr = r; iCod = cod;
    iRaz = cs.findIndex(c => /razao/.test(c));
    const fant = cs.findIndex(c => /fantasia/.test(c));
    iNome = fant >= 0 ? fant : cs.findIndex((c, i) => i !== cod && /(nome|cliente|razao)/.test(c));
    iCid = cs.findIndex(c => /(cidade|municipio)/.test(c));
    iRca = cs.findIndex(c => c === 'rca' || /^cod.*rca/.test(c));
  }
  if (hr < 0) { iCod = 0; iNome = 1; iCid = rows.some(r => r[2]) ? 2 : -1; }
  const out = [];
  for (const r of rows.slice(hr + 1)) {
    const codigo = String(r[iCod] || '').replace(/\.0+$/, '').trim();
    const nome = clean(r[iNome]) || (iRaz >= 0 ? clean(r[iRaz]) : '');
    if (!/^\d+$/.test(codigo) || !nome) continue;
    const rca = iRca >= 0 ? (String(r[iRca] || '').match(/^\s*(\d+)/) || [])[1] || '' : '';
    out.push({ codigo, nome, razao: iRaz >= 0 && iRaz !== iNome ? clean(r[iRaz]) : '', cidade: iCid >= 0 ? clean(r[iCid]) : '', rca });
  }
  return out;
}
async function gravarClientes(lista) {
  if (!lista.length) return alert('Não encontrei clientes nesta planilha.\n\nPreciso de uma coluna com o CÓDIGO (só números) e outra com o NOME.');
  const ex = lista.slice(0, 3).map(c => `${c.codigo} – ${c.nome}${c.cidade ? ' (' + c.cidade + ')' : ''}`).join('\n');
  if (!confirm(`Encontrei ${lista.length} cliente(s). Exemplos:\n\n${ex}\n\nImportar? Os que já existem serão atualizados.`)) return;
  await tx('clients', 'readwrite', s => { for (const c of lista) s.put(c); });
  S.clients = await getAll('clients');
  toast(`${lista.length} cliente(s) importado(s)`); render();
}
