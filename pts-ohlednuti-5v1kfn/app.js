/* Ohlédnutí za natáčením — logika studentské stránky. Bez knihoven, bez build kroku.
   Texty, projekty a otázky se načítají z content/*.json. Server je schovaný v api.js. */
(function () {
  'use strict';

  const CONTENT = 'content/';
  const api = window.famuApi;

  let T = null;          // texty.json
  let P = null;          // projekty.json
  let BLOKY = [];        // normalizované bloky z otazky.json
  const PROJ = new Map();

  const stav = {
    klic: null,          // tajný klíč studenta (jen v prohlížeči a v osobním odkazu)
    draft: null,         // { student, odpovedi: {id: {hodnota, cas}}, pozice, odeslano, upraveno }
    aktualni: null,
    zKontroly: false,
    ukazatOdkaz: false,
    spatnyOdkaz: false,
    klapkaBlok: null
  };

  /* ---------- drobnosti ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  function el(tag, attrs, ...deti) {
    const e = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v === false || v == null) continue;
      if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'class') e.className = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const d of deti.flat(Infinity)) if (d != null && d !== false) e.append(d.nodeType ? d : document.createTextNode(d));
    return e;
  }
  function ikona(id) {
    const ns = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(ns, 'svg');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('focusable', 'false');
    const u = document.createElementNS(ns, 'use');
    u.setAttribute('href', '#' + id);
    s.append(u);
    return s;
  }
  function t(cesta, vars) {
    let v = cesta.split('.').reduce((o, k) => (o == null ? o : o[k]), T);
    if (typeof v !== 'string') return v == null ? '' : v;
    vars = { termin: terminText(), ...(vars || {}) };
    return v.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : ''));
  }
  const iso = () => new Date().toISOString();
  const hodiny = (d = new Date()) => d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
  const motionOK = () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function hlas(text) { const h = $('#hlaseni'); h.textContent = ''; setTimeout(() => { h.textContent = text; }, 30); }
  function terminText() {
    if (!P || !P.termin) return '';
    const d = new Date(P.termin);
    return `${d.getDate()}. ${d.getMonth() + 1}.`;
  }
  const poTerminu = () => !!(P && P.termin && Date.now() > Date.parse(P.termin));
  const celeJmeno = (s) => `${s.jmeno} ${s.prijmeni}`.trim();

  /* ---------- otázky: normalizace a obrazovky ---------- */
  function normTyp(x) {
    const s = String(x || '').toLowerCase();
    if (/skal|scale/.test(s)) return 'skala';
    if (/volb|choice/.test(s)) return 'volba';
    if (/kratk|short/.test(s)) return 'kratky';
    return 'text';
  }
  function normRole(x) { const s = String(x || '').toUpperCase(); return s === 'PM' || s === 'PA' ? s : null; }
  function normalizuj(raw) {
    const vynech = new Set(T.vynechatOtazky || []);
    let bloky;
    if (Array.isArray(raw) && raw.length && Array.isArray(raw[0].otazky)) {
      bloky = raw.map((b) => ({ nazev: b.blok || b.nazev || '', uvod: b.uvod || '', otazky: b.otazky }));
    } else {
      const m = new Map();
      (Array.isArray(raw) ? raw : raw.otazky || []).forEach((q) => {
        const k = q.blok || '';
        if (!m.has(k)) m.set(k, { nazev: k, uvod: '', otazky: [] });
        m.get(k).otazky.push(q);
      });
      bloky = [...m.values()];
    }
    return bloky
      .map((b) => ({ nazev: b.nazev, uvod: b.uvod, otazky: b.otazky.filter((q) => !vynech.has(q.id)).map((q) => ({ ...q, typ: normTyp(q.typ), role: normRole(q.role) })) }))
      .filter((b) => b.otazky.length);
  }
  function viditelneBloky() {
    const role = stav.draft ? stav.draft.student.role : null;
    return BLOKY
      .map((b) => ({ ...b, otazky: b.otazky.filter((q) => !q.role || q.role === role) }))
      .filter((b) => b.otazky.length);
  }
  function obrazovky() {
    const out = [];
    viditelneBloky().forEach((b, bi) => {
      const skup = [];
      for (let i = 0; i < b.otazky.length; i++) {
        const q = b.otazky[i];
        if ((q.typ === 'skala' || q.typ === 'volba') && b.otazky[i + 1]) { skup.push([q, b.otazky[i + 1]]); i++; }
        else skup.push([q]);
      }
      skup.forEach((qs, zi) => out.push({ klic: 'q:' + qs[0].id, blok: b, bIndex: bi + 1, qs, zaber: zi + 1, zaberu: skup.length }));
    });
    return out;
  }
  const najdiObrazovku = (klic) => obrazovky().find((o) => o.klic === klic);
  const obrazovkaOtazky = (qid) => obrazovky().find((o) => o.qs.some((q) => q.id === qid));

  /* ---------- převod mezi stránkou a serverem ---------- */
  function zDokumentu(dok) {
    const odpovedi = {};
    (dok.odpovedi || []).forEach((a) => { odpovedi[a.id_otazky] = { hodnota: a.text, cas: a.cas }; });
    const s = dok.student;
    return {
      student: { jmeno: s.jmeno, prijmeni: s.prijmeni, projekty: s.projekty || [], role: s.role },
      odpovedi,
      pozice: dok.pozice || null,
      odeslano: s.odeslano || null,
      upraveno: s.upraveno || null,
      serverUpraveno: s.upraveno || null,   // přesně řetězec ze serveru (mikrosekundy), nikdy přes Date
      zaklad: casyOdpovedi(dok)             // časy odpovědí na serveru při posledním společném stavu
    };
  }
  const casyOdpovedi = (dok) => Object.fromEntries((dok.odpovedi || []).map((a) => [a.id_otazky, a.cas]));
  function proServer(stavDokumentu) {
    const d = stav.draft;
    const odpovedi = [];
    viditelneBloky().forEach((b) => b.otazky.forEach((q) => {
      const a = d.odpovedi[q.id];
      if (!a || a.hodnota === '' || a.hodnota == null) return;
      odpovedi.push({ id_otazky: q.id, text: String(a.hodnota), cas: a.cas });
    }));
    return { student: { ...d.student }, odpovedi, stav: stavDokumentu };
  }

  /* ---------- dvě zařízení: sloučení po otázkách ---------- */
  function jeTextova(qid) {
    for (const b of BLOKY) for (const q of b.otazky) if (q.id === qid) return q.typ === 'text' || q.typ === 'kratky';
    return true;
  }
  // Tady = toto zařízení, tam = server (psalo se i na jiném zařízení). Text se nikdy tiše nezahodí:
  // když se liší a změnily se obě verze, v poli zůstane tahle a druhá se nabídne k výběru (konflikty).
  function sluc(lokalni, serverDok) {
    const s = zDokumentu(serverDok);
    const zaklad = lokalni.zaklad || {};
    const tady = lokalni.odpovedi || {};
    const konflikty = { ...(lokalni.konflikty || {}) };
    const o = {};
    for (const id of new Set([...Object.keys(tady), ...Object.keys(s.odpovedi)])) {
      const L = tady[id];
      const S = s.odpovedi[id];
      if (!L || !S) { o[id] = L || S; continue; }       // jen na jednom místě: nechat
      const l = String(L.hodnota);
      const r = String(S.hodnota);
      if (l === r) { o[id] = S; delete konflikty[id]; }
      else if (L.cas === zaklad[id]) o[id] = S;          // tady beze změny, jinde přepsané
      else if (S.cas === zaklad[id]) o[id] = L;          // jinde beze změny, tady přepsané
      else if (!jeTextova(id)) o[id] = Date.parse(S.cas) > Date.parse(L.cas) ? S : L; // stupnice, volba: novější
      else if (l.includes(r)) o[id] = L;                 // jedna verze jen pokračuje v druhé: delší
      else if (r.includes(l)) o[id] = S;
      else { o[id] = L; konflikty[id] = S; }             // nejisté: nabídnout obě
    }
    return { ...lokalni, odpovedi: o, konflikty, serverUpraveno: s.serverUpraveno, zaklad: s.zaklad, odeslano: s.odeslano || lokalni.odeslano };
  }
  const konfliktyViditelne = () => (stav.draft && stav.draft.konflikty ? viditelneBloky().flatMap((b) => b.otazky.filter((q) => stav.draft.konflikty[q.id]).map((q) => q.id)) : []);
  function prekresliPoSlouceni(pred) {
    const k = stav.aktualni;
    if (!k || !(k.startsWith('q:') || k === 'kontrola')) return;
    const d = stav.draft;
    const hodnota = (x, id) => String(x.odpovedi[id] ? x.odpovedi[id].hodnota : '');
    const zmena = (id) => hodnota(pred, id) !== hodnota(d, id) || !(pred.konflikty || {})[id] !== !(d.konflikty || {})[id];
    const ids = k === 'kontrola' ? Object.keys({ ...pred.odpovedi, ...d.odpovedi, ...(d.konflikty || {}) }) : (najdiObrazovku(k) || { qs: [] }).qs.map((q) => q.id);
    if (ids.some(zmena)) vykresli(k, {});
  }
  // Zápisy na server jdou z jednoho zařízení po jednom, každý s verzí (zaklad), ze které vychází.
  let fronta = Promise.resolve();
  function ulozNaServer(stavDokumentu) {
    const p = fronta.then(() => ulozTed(stavDokumentu));
    fronta = p.catch(() => {});
    return p;
  }
  async function ulozTed(stavDokumentu) {
    if (!stav.draft || !stav.klic) return { ok: false };
    const posli = () => api.ulozOdpovedi(stav.klic, { ...proServer(stavDokumentu), zaklad: stav.draft.serverUpraveno || null });
    let r = await posli();
    if (r && !r.ok && r.duvod === 'konflikt' && r.dokument) {
      const pred = stav.draft;
      stav.draft = sluc(pred, r.dokument);
      ulozKopii(false);
      prekresliPoSlouceni(pred);
      if (stavDokumentu === 'odeslano' && konfliktyViditelne().length) return { ok: false, duvod: 'konflikt' };
      r = await posli();
    }
    if (r && r.ok && r.dokument && stav.draft) {
      stav.draft.serverUpraveno = r.dokument.student.upraveno;
      stav.draft.zaklad = casyOdpovedi(r.dokument);
      ulozKopii(false);
    }
    return r;
  }

  /* ---------- průběžné ukládání ---------- */
  let casLokal = null;
  let casServer = null;
  function ulozKopii(zmena) {
    if (zmena) stav.draft.upraveno = iso();
    return api.ulozKopiiZarizeni({ klic: stav.klic, ...stav.draft });
  }
  function ulozBrzy(ukazatel) {
    clearTimeout(casLokal);
    casLokal = setTimeout(() => {
      if (ulozKopii(true) && ukazatel) {
        ukazatel.querySelector('span').textContent = t('otazka.ulozeno', { cas: hodiny() });
        ukazatel.classList.add('ukazat');
      }
    }, 300);
    clearTimeout(casServer);
    casServer = setTimeout(() => { if (stav.draft) ulozNaServer(stav.draft.odeslano ? 'odeslano' : 'rozpracovano').catch(() => {}); }, 1500);
  }
  function nastavOdpoved(q, hodnota, ukazatel) {
    const prazdna = hodnota == null || (typeof hodnota === 'string' && hodnota.trim() === '');
    if (prazdna) delete stav.draft.odpovedi[q.id];
    else stav.draft.odpovedi[q.id] = { hodnota, cas: iso() };
    ulozBrzy(ukazatel);
  }
  const odpoved = (qid) => (stav.draft && stav.draft.odpovedi[qid] ? stav.draft.odpovedi[qid].hodnota : '');

  /* ---------- osobní odkaz ---------- */
  const mujOdkaz = () => `${location.origin}${location.pathname}#k=${stav.klic}`;
  async function zkopiruj(tlacitko) {
    try {
      await navigator.clipboard.writeText(mujOdkaz());
      const puvodni = tlacitko.firstChild.textContent;
      tlacitko.firstChild.textContent = t('odkaz.zkopirovano');
      hlas(t('odkaz.zkopirovano'));
      setTimeout(() => { tlacitko.firstChild.textContent = puvodni; }, 2200);
    } catch (e) {
      hlas(t('odkaz.rucne'));
      const vstup = tlacitko.closest('.odkaz').querySelector('.odkaz__adresa');
      vstup.focus(); vstup.select();
    }
  }
  async function posli(tlacitko) {
    if (navigator.share) {
      try { await navigator.share({ title: t('odkaz.sdileniTitulek'), url: mujOdkaz() }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    zkopiruj(tlacitko);
  }
  function blokOdkazu({ kompaktni } = {}) {
    const adresa = el('input', { class: 'odkaz__adresa', type: 'text', readonly: true, value: mujOdkaz(), 'aria-label': t('odkaz.nadpis'), spellcheck: 'false' });
    adresa.addEventListener('focus', () => adresa.select());
    const kopirovat = el('button', { type: 'button', class: 'tl tl--vedlejsi', onclick: (e) => zkopiruj(e.currentTarget) }, el('span', { text: t('odkaz.zkopirovat') }), ikona('i-kopie'));
    const poslat = el('button', { type: 'button', class: 'tl tl--vedlejsi', onclick: (e) => posli(e.currentTarget) }, el('span', { text: t('odkaz.poslat') }), ikona('i-sdilet'));
    return el('div', { class: 'odkaz' + (kompaktni ? ' odkaz--kompaktni' : '') },
      kompaktni ? el('p', { class: 'odkaz__vyzva', text: t('odkaz.vyzva') }) : el('p', { class: 'odkaz__text', text: t('odkaz.text') }),
      adresa,
      el('div', { class: 'odkaz__tlacitka' }, kopirovat, poslat));
  }
  function otevriOdkaz() {
    const d = $('#odkaz-dialog');
    $('.odkaz-dialog__obsah', d).replaceChildren(blokOdkazu());
    d.showModal();
  }
  function aktualizujMenu() { $('.pruh__odkaz').hidden = !stav.klic || !stav.draft; }

  /* ---------- klapka a bloky ---------- */
  function nazvyProjektu(projekty) {
    return (projekty || (stav.draft ? stav.draft.student.projekty : [])).map((id) => (PROJ.get(id) || { nazev: id }).nazev).join(' · ');
  }
  function vyplnKlapku({ obraz, blok, zaber, postup, projekty }) {
    const k = $('.klapka');
    k.hidden = false;
    $('.klapka__cislo', k).textContent = obraz;
    $('.klapka__blok', k).textContent = blok;
    $('.klapka__zaber', k).textContent = zaber;
    $('.klapka__produkce', k).textContent = nazvyProjektu(projekty) || '—';
    $('.klapka__postup', k).replaceChildren(...postup.map((s) => el('li', { class: s })));
  }
  function stavPostupu(bIndex, pocet, vse) {
    return Array.from({ length: pocet }, (_, i) => (vse || i + 1 < bIndex ? 'hotovo' : i + 1 === bIndex ? 'ted' : ''));
  }
  function klapni(cisloHotoveho, potom) {
    const k = $('.klapka');
    $('.klapka__razitko-pod', k).textContent = t('klapka.mameToPodtitul', { n: cisloHotoveho });
    k.classList.remove('klap');
    void k.offsetWidth;
    k.classList.add('klap');
    if (navigator.vibrate && motionOK()) setTimeout(() => navigator.vibrate(12), 170);
    setTimeout(potom, 900);
    setTimeout(() => { k.classList.remove('klap'); }, 1500);
  }
  function vyplnBloky(aktivniBIndex, vse) {
    const nav = $('.bloky');
    nav.hidden = false;
    $('.bloky__projekt', nav).textContent = nazvyProjektu();
    $('.bloky__jmeno', nav).textContent = `${celeJmeno(stav.draft.student)} · ${stav.draft.student.role}`;
    const sez = obrazovky();
    $('.bloky__seznam', nav).replaceChildren(...viditelneBloky().map((b, i) => {
      const n = i + 1;
      const hotovy = vse || n < aktivniBIndex;
      const ted = n === aktivniBIndex;
      const obsah = [hotovy ? ikona('i-fajfka') : null, b.nazev];
      const prvni = sez.find((o) => o.bIndex === n);
      return el('li', null, hotovy || ted
        ? el('button', { type: 'button', class: 'bloky__polozka', 'aria-current': ted ? 'step' : false, onclick: () => jdi(prvni.klic) }, obsah)
        : el('span', { class: 'bloky__polozka' }, obsah));
    }));
  }

  /* ---------- navigace ---------- */
  const poradi = () => ['uvod', 'kdo', ...obrazovky().map((o) => o.klic), 'kontrola', 'hotovo'];
  function zpet() {
    if (stav.zKontroly) { stav.zKontroly = false; return jdi('kontrola'); }
    const p = poradi();
    const i = p.indexOf(stav.aktualni);
    jdi(i > 0 ? p[i - 1] : 'uvod');
  }

  function jdi(klic, { pridatDoHistorie = true } = {}) {
    const predtim = stav.aktualni;
    const pred = predtim && predtim.startsWith('q:') ? najdiObrazovku(predtim) : null;
    const po = klic.startsWith('q:') ? najdiObrazovku(klic) : null;
    const dopredu = poradi().indexOf(klic) > poradi().indexOf(predtim);
    const dokoncenBlok = pred && dopredu && pred.zaber === pred.zaberu && (!po || po.bIndex !== pred.bIndex) && !stav.zKontroly;

    stav.aktualni = klic;
    if (stav.draft && (klic.startsWith('q:') || klic === 'kontrola')) { stav.draft.pozice = klic; ulozKopii(); }
    if (pridatDoHistorie) history.pushState({ k: klic }, '', location.pathname);
    document.body.classList.toggle('s-bloky', klic.startsWith('q:') || klic === 'kontrola');
    vykresli(klic, { dokoncenBlok: dokoncenBlok ? pred.bIndex : 0 });
  }

  window.addEventListener('popstate', (e) => {
    const klic = e.state && e.state.k;
    if (!klic) return;
    if ((klic.startsWith('q:') || klic === 'kontrola') && !stav.draft) return jdi('uvod', { pridatDoHistorie: false });
    if (klic.startsWith('q:') && !najdiObrazovku(klic)) return;
    jdi(klic, { pridatDoHistorie: false });
  });

  function vykresli(klic, { dokoncenBlok }) {
    const panel = $('#panel');
    const bloky = viditelneBloky();
    const klapka = $('.klapka');
    aktualizujMenu();

    const nastavKlapku = () => {
      if (klic === 'uvod' || klic === 'hotovo') { klapka.hidden = true; $('.bloky').hidden = true; return; }
      if (klic === 'kdo') {
        vyplnKlapku({ obraz: t('kdo.obraz'), blok: t('kdo.nadpis'), zaber: '1/1', postup: stavPostupu(0, bloky.length), projekty: stav.draft ? null : [] });
        $('.bloky').hidden = true;
        return;
      }
      if (klic === 'kontrola') {
        vyplnKlapku({ obraz: bloky.length + 1, blok: t('kontrola.nadpis'), zaber: '1/1', postup: stavPostupu(0, bloky.length, true) });
        vyplnBloky(0, true);
        return;
      }
      const o = najdiObrazovku(klic);
      vyplnKlapku({ obraz: o.bIndex, blok: o.blok.nazev, zaber: `${o.zaber}/${o.zaberu}`, postup: stavPostupu(o.bIndex, bloky.length) });
      vyplnBloky(o.bIndex);
      if (stav.klapkaBlok !== o.bIndex) hlas(`${t('klapka.obraz')} ${o.bIndex}: ${o.blok.nazev}`);
      stav.klapkaBlok = o.bIndex;
    };

    let obsah;
    if (klic === 'uvod') obsah = vykresliUvod();
    else if (klic === 'kdo') obsah = vykresliKdo();
    else if (klic === 'kontrola') obsah = vykresliKontrolu();
    else if (klic === 'hotovo') obsah = vykresliHotovo();
    else obsah = vykresliOtazky(najdiObrazovku(klic));

    if (dokoncenBlok) klapni(dokoncenBlok, nastavKlapku);
    else nastavKlapku();

    panel.replaceChildren(...[].concat(obsah));
    panel.dataset.o = klic.startsWith('q:') ? 'otazka' : klic;
    if (motionOK()) { panel.classList.remove('vstup'); void panel.offsetWidth; panel.classList.add('vstup'); }
    window.scrollTo(0, 0);
    const nadpis = panel.querySelector('h1, h2');
    if (nadpis) { nadpis.setAttribute('tabindex', '-1'); nadpis.focus({ preventScroll: true }); }
  }

  /* ---------- Úvod ---------- */
  function zapomenNaZarizeni() {
    api.smazZarizeni();
    stav.klic = null;
    stav.draft = null;
  }
  function vykresliUvod() {
    const hero = el('div', { class: 'hero' },
      el('h1', { class: 'hero__nadpis' }, (T.uvod.nadpis || []).map((r) => el('span', { text: r }))),
      el('ul', { class: 'hero__filmy', 'aria-label': t('klapka.produkce') }, P.projekty.map((p) => el('li', { text: p.nazev }))));
    const text = el('div', { class: 'uvod__text' }, T.uvod.odstavce.map((p) => el('p', { text: p })));
    const fakta = el('dl', { class: 'fakta' }, T.uvod.fakta.map((f) => el('div', null, el('dt', { text: f.co }), el('dd', { text: vyplnTermin(f.text) }))));

    const znovu = el('button', { type: 'button', class: 'tl tl--tiche', onclick: () => { zapomenNaZarizeni(); jdi('kdo'); } }, t('uvod.znovu'));
    let akce;
    if (stav.spatnyOdkaz) {
      akce = el('div', { class: 'rozepsano' }, el('p', { text: t('uvod.spatnyOdkaz') }),
        el('button', { type: 'button', class: 'tl tl--hlavni', onclick: () => { stav.spatnyOdkaz = false; zapomenNaZarizeni(); jdi('kdo'); } }, t('uvod.tlacitko'), ikona('i-sipka')));
    } else if (stav.draft) {
      const d = stav.draft;
      const jmeno = celeJmeno(d.student);
      if (d.odeslano) {
        akce = el('div', { class: 'rozepsano' },
          el('p', { text: t(poTerminu() ? 'uvod.poTerminu' : 'uvod.odeslano', { jmeno }) }),
          el('button', { type: 'button', class: 'tl tl--hlavni', onclick: () => jdi('hotovo') }, t('uvod.zobrazitOdeslane'), ikona('i-sipka')),
          znovu);
      } else {
        const cil = d.pozice && (d.pozice === 'kontrola' || najdiObrazovku(d.pozice)) ? d.pozice : obrazovky()[0].klic;
        akce = el('div', { class: 'rozepsano' },
          el('p', { text: t('uvod.rozepsano', { jmeno }) }),
          el('button', { type: 'button', class: 'tl tl--hlavni', onclick: () => jdi(cil) }, t('uvod.pokracovat'), ikona('i-sipka')),
          znovu);
      }
    } else {
      akce = el('div', { class: 'ovladani' },
        el('button', { type: 'button', class: 'tl tl--hlavni', onclick: () => jdi('kdo') }, t('uvod.tlacitko'), ikona('i-sipka')));
    }
    return [hero, el('div', { class: 'uvod__papir' }, text, fakta, akce)];
  }
  const vyplnTermin = (s) => String(s).replace('{termin}', terminText());

  /* ---------- Kdo jsi ---------- */
  function vykresliKdo() {
    const puvodni = stav.draft ? stav.draft.student : { jmeno: '', prijmeni: '', projekty: [], role: null };
    const v = { ...puvodni, projekty: [...puvodni.projekty] };
    const wrap = el('div', null);

    const pole = (id, label, hodnota, autocomplete) => {
      const i = el('input', { class: 'pole', id, type: 'text', autocomplete, autocapitalize: 'words', spellcheck: 'false', required: true });
      i.value = hodnota || '';
      return [i, el('div', { class: 'skupina-pole skupina-pole--pul' }, el('label', { for: id, text: label }), i)];
    };
    const [jmeno, jmenoBlok] = pole('jmeno', t('kdo.jmenoLabel'), v.jmeno, 'given-name');
    const [prijmeni, prijmeniBlok] = pole('prijmeni', t('kdo.prijmeniLabel'), v.prijmeni, 'family-name');
    const chybaJmeno = el('p', { class: 'chyba', role: 'alert' });
    [jmeno, prijmeni].forEach((i) => i.addEventListener('input', () => { chybaJmeno.textContent = ''; }));

    const chybaProjekt = el('p', { class: 'chyba', role: 'alert' });
    const projekty = el('ul', { class: 'projekty' }, P.projekty.map((p) => {
      const box = el('input', { type: 'checkbox', value: p.id, checked: v.projekty.includes(p.id), 'aria-describedby': 'projekty-napoveda' });
      box.addEventListener('change', () => {
        v.projekty = box.checked ? [...v.projekty, p.id] : v.projekty.filter((x) => x !== p.id);
        chybaProjekt.textContent = '';
        $('.klapka__produkce').textContent = nazvyProjektu(v.projekty) || '—';
      });
      return el('li', { class: 'projekt' },
        el('label', { class: 'projekt__zaskrt' }, box,
          el('span', { class: 'projekt__box' }, ikona('i-fajfka')),
          el('span', null, el('span', { class: 'projekt__nazev', text: p.nazev }), ' ', el('span', { class: 'projekt__skupina', text: p.skupina }))));
    }));

    const chybaRole = el('p', { class: 'chyba', role: 'alert' });
    const role = el('div', { class: 'role role--velka', role: 'radiogroup', 'aria-labelledby': 'role-label', 'aria-describedby': 'role-napoveda' },
      P.role.map((r) => {
        const radio = el('input', { type: 'radio', name: 'role', value: r.id, checked: v.role === r.id });
        radio.addEventListener('change', () => { v.role = r.id; chybaRole.textContent = ''; });
        return el('label', null, radio, el('span', { class: 'role__zkratka', text: r.nazev }), el('span', { class: 'role__popis', text: r.popis }));
      }));

    const chybaSit = el('p', { class: 'chyba', role: 'alert' });
    const tlacitko = el('button', { type: 'button', class: 'tl tl--hlavni' }, el('span', { text: t('kdo.tlacitko') }), ikona('i-sipka'));
    tlacitko.addEventListener('click', async () => {
      if (tlacitko.getAttribute('aria-disabled') === 'true') return;
      v.jmeno = jmeno.value.trim().replace(/\s+/g, ' ');
      v.prijmeni = prijmeni.value.trim().replace(/\s+/g, ' ');
      let prvniChyba = null;
      if (!v.jmeno || !v.prijmeni) { chybaJmeno.textContent = t('kdo.chybaJmeno'); prvniChyba = prvniChyba || (v.jmeno ? prijmeni : jmeno); }
      if (!v.projekty.length) { chybaProjekt.textContent = t('kdo.chybaProjekt'); prvniChyba = prvniChyba || projekty.querySelector('input'); }
      if (!v.role) { chybaRole.textContent = t('kdo.chybaRole'); prvniChyba = prvniChyba || role.querySelector('input'); }
      if (prvniChyba) { prvniChyba.focus(); return; }

      tlacitko.setAttribute('aria-disabled', 'true');
      tlacitko.firstChild.textContent = t('kdo.ukladam');
      const student = { jmeno: v.jmeno, prijmeni: v.prijmeni, projekty: P.projekty.map((p) => p.id).filter((id) => v.projekty.includes(id)), role: v.role };
      let ok = true;
      try {
        if (!stav.klic) {
          const r = await api.zalozStudenta(student);
          ok = r.ok;
          if (ok) {
            stav.klic = r.klic;
            api.ulozKlicZarizeni(r.klic);
            stav.draft = { student, odpovedi: {}, pozice: null, odeslano: null, upraveno: iso() };
            stav.ukazatOdkaz = true;
          }
        } else {
          stav.draft.student = student;
          const r = await ulozNaServer(stav.draft.odeslano ? 'odeslano' : 'rozpracovano');
          ok = r.ok || r.duvod === 'termin';
        }
      } catch (e) { ok = false; }
      tlacitko.removeAttribute('aria-disabled');
      tlacitko.firstChild.textContent = t('kdo.tlacitko');
      if (!ok) { chybaSit.textContent = t('kdo.chybaSit'); return; }
      ulozKopii(true);
      const d = stav.draft;
      jdi(d.pozice && najdiObrazovku(d.pozice) ? d.pozice : obrazovky()[0].klic);
    });

    wrap.append(
      el('h2', { class: 'nadpis-obrazovky', text: t('kdo.nadpis') }),
      el('div', { class: 'jmeno-radek' }, jmenoBlok, prijmeniBlok),
      chybaJmeno,
      el('div', { class: 'skupina-pole', role: 'group', 'aria-labelledby': 'projekty-label' },
        el('span', { class: 'popisek', id: 'projekty-label', text: t('kdo.projektyLabel') }),
        el('p', { class: 'napoveda', id: 'projekty-napoveda', text: t('kdo.projektyNapoveda') }),
        projekty, chybaProjekt),
      el('div', { class: 'skupina-pole' },
        el('span', { class: 'popisek', id: 'role-label', text: t('kdo.roleLabel') }),
        el('p', { class: 'napoveda', id: 'role-napoveda', text: t('kdo.roleNapoveda') }),
        role, chybaRole),
      chybaSit,
      el('div', { class: 'ovladani' },
        el('button', { type: 'button', class: 'tl tl--vedlejsi tl--ikona', 'aria-label': t('otazka.zpet'), onclick: zpet }, ikona('i-zpet')),
        tlacitko));
    return wrap;
  }

  /* ---------- Otázky ---------- */
  function vykresliOtazky(o) {
    const wrap = el('div', null);
    const sez = obrazovky();
    const jenCist = poTerminu();
    if (o.klic === sez[0].klic && stav.ukazatOdkaz) {
      wrap.append(blokOdkazu({ kompaktni: true }));
      stav.ukazatOdkaz = false;
    }
    if (o.zaber === 1) {
      wrap.append(el('div', { class: 'blok-uvod' },
        o.blok.uvod ? el('p', { class: 'blok-uvod__text', text: o.blok.uvod }) : null,
        el('p', { class: 'blok-uvod__napoveda', text: t('otazka.napovedaBloku') })));
    }
    if (jenCist) wrap.append(el('p', { class: 'otazka__poznamka', text: t('otazka.jenCteni') }));
    const ukazatel = el('p', { class: 'ulozeno' }, ikona('i-fajfka'), el('span'));

    o.qs.forEach((q, i) => {
      const idN = 'n-' + q.id;
      const sekce = el('section', { class: 'otazka', 'aria-labelledby': 'h-' + q.id });
      sekce.append(el(i === 0 ? 'h2' : 'h3', { class: 'otazka__text', id: 'h-' + q.id, text: q.text }));
      if (q.napoveda) sekce.append(el('p', { class: 'otazka__napoveda', id: idN, text: q.napoveda }));
      if (o.bIndex === sez[0].bIndex && o.zaber === 1 && i === 0 && stav.draft.student.projekty.length > 1) {
        sekce.append(el('p', { class: 'otazka__poznamka', text: t('otazka.dvaProjekty') }));
      }
      const jina = !jenCist && stav.draft.konflikty && stav.draft.konflikty[q.id];
      if (jina) sekce.append(nabidkaVerzi(q, jina));
      sekce.append(ovladac(q, q.napoveda ? idN : null, ukazatel, jenCist));
      wrap.append(sekce);
    });
    wrap.append(ukazatel);

    const vyplneno = () => o.qs.some((q) => odpoved(q.id) !== '');
    const i = sez.findIndex((x) => x.klic === o.klic);
    const dalsi = stav.zKontroly ? 'kontrola' : (sez[i + 1] ? sez[i + 1].klic : 'kontrola');
    const vzhled = () => (vyplneno() || stav.zKontroly || jenCist ? 'tl tl--hlavni' : 'tl tl--vedlejsi tl--preskocit');
    const popis = () => (stav.zKontroly ? t('kontrola.nadpis') : (vyplneno() || jenCist ? t('otazka.dal') : t('otazka.preskocit')));
    const dal = el('button', { type: 'button', class: vzhled(), onclick: () => { stav.zKontroly = false; jdi(dalsi); } }, el('span', { text: popis() }), ikona('i-sipka'));
    wrap.addEventListener('input', () => { dal.className = vzhled(); dal.firstChild.textContent = popis(); });
    wrap.addEventListener('change', () => { dal.className = vzhled(); dal.firstChild.textContent = popis(); });
    wrap.append(el('div', { class: 'ovladani' },
      el('button', { type: 'button', class: 'tl tl--vedlejsi tl--ikona', 'aria-label': t('otazka.zpet'), onclick: zpet }, ikona('i-zpet')),
      dal));
    return wrap;
  }

  // Konflikt: stejnou odpověď student napsal jinak na jiném zařízení. Ukázat obě, ať si vybere.
  function nabidkaVerzi(q, jina) {
    const vyres = (pouzit) => {
      if (pouzit) stav.draft.odpovedi[q.id] = { hodnota: jina.hodnota, cas: iso() };
      delete stav.draft.konflikty[q.id];
      ulozBrzy(null);
      vykresli(stav.aktualni, {});
    };
    return el('div', { class: 'konflikt', role: 'group', 'aria-label': t('konflikt.zprava') },
      el('p', { class: 'otazka__poznamka', text: t('konflikt.zprava') }),
      el('p', { class: 'napoveda', text: t('konflikt.jinaVerze') }),
      el('p', { class: 'kontrola__odpoved', text: String(jina.hodnota) }),
      el('div', { class: 'ovladani' },
        el('button', { type: 'button', class: 'tl tl--vedlejsi', onclick: () => vyres(true) }, t('konflikt.pouzitJinou')),
        el('button', { type: 'button', class: 'tl tl--tiche', onclick: () => vyres(false) }, t('konflikt.nechatSvou'))));
  }

  function rozmer(ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 3 + 'px'; }

  function ovladac(q, popisId, ukazatel, jenCist) {
    if (q.typ === 'text' || q.typ === 'kratky') {
      const pole = q.typ === 'text'
        ? el('textarea', { class: 'pole', id: 'o-' + q.id, rows: 7, 'aria-labelledby': 'h-' + q.id, 'aria-describedby': popisId, readonly: jenCist })
        : el('input', { class: 'pole', id: 'o-' + q.id, type: 'text', 'aria-labelledby': 'h-' + q.id, 'aria-describedby': popisId, readonly: jenCist });
      pole.value = odpoved(q.id) || '';
      pole.addEventListener('input', () => { if (q.typ === 'text') rozmer(pole); nastavOdpoved(q, pole.value, ukazatel); });
      if (q.typ === 'text') requestAnimationFrame(() => rozmer(pole));
      return pole;
    }
    if (q.typ === 'skala') {
      const hodnota = Number(odpoved(q.id)) || null;
      const ram = el('div', { class: 'pas__ram', role: 'radiogroup', 'aria-labelledby': 'h-' + q.id, 'aria-describedby': popisId });
      for (let n = 1; n <= 10; n++) {
        const r = el('input', { type: 'radio', name: 's-' + q.id, value: n, checked: hodnota === n, disabled: jenCist, 'aria-label': String(n) });
        r.addEventListener('change', () => nastavOdpoved(q, n, ukazatel));
        ram.append(el('label', { class: 'pas__okenko' }, r, el('span', { 'aria-hidden': 'true', text: n })));
      }
      let tah = false;
      const podPrstem = (e) => {
        const lab = document.elementFromPoint(e.clientX, e.clientY);
        const okenko = lab && lab.closest('.pas__okenko');
        if (okenko && ram.contains(okenko)) {
          const r = okenko.querySelector('input');
          if (!r.checked && !r.disabled) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
        }
      };
      ram.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') tah = true; });
      ram.addEventListener('pointermove', (e) => { if (tah) podPrstem(e); });
      window.addEventListener('pointerup', () => { tah = false; });
      return el('div', { class: 'pas' }, ram,
        el('div', { class: 'pas__popisky', 'aria-hidden': 'true' }, el('span', { text: '1 ' + t('otazka.skalaMin') }), el('span', { text: '10 ' + t('otazka.skalaMax') })));
    }
    const vybrana = odpoved(q.id);
    return el('div', { class: 'volby', role: 'radiogroup', 'aria-labelledby': 'h-' + q.id, 'aria-describedby': popisId },
      (q.moznosti || []).map((m) => {
        const r = el('input', { type: 'radio', name: 'v-' + q.id, value: m, checked: vybrana === m, disabled: jenCist });
        r.addEventListener('change', () => nastavOdpoved(q, m, ukazatel));
        return el('label', { class: 'volba' }, r, el('span', { class: 'volba__znak' }, ikona('i-fajfka')), el('span', { text: m }));
      }));
  }

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      const a = document.activeElement;
      if (a && a.classList && a.classList.contains('pole')) setTimeout(() => a.scrollIntoView({ block: 'nearest' }), 60);
    });
  }

  /* ---------- Kontrola ---------- */
  function seznamOdpovedi({ upravy }) {
    return viditelneBloky().map((b, bi) => el('section', { class: 'kontrola__blok', 'aria-labelledby': 'k-' + bi },
      el('h3', { id: 'k-' + bi }, el('span', { text: bi + 1 }), b.nazev),
      b.otazky.map((q) => {
        const a = odpoved(q.id);
        const prazdna = a === '' || a == null;
        return el('div', { class: 'kontrola__polozka' },
          el('p', { class: 'kontrola__otazka', text: q.text }),
          upravy && stav.draft.konflikty && stav.draft.konflikty[q.id] ? el('p', { class: 'otazka__poznamka', text: t('konflikt.zprava') }) : null,
          upravy ? el('button', {
            type: 'button', class: 'tl tl--tiche', 'aria-label': `${t('kontrola.upravit')}: ${q.text}`,
            onclick: () => { stav.zKontroly = true; jdi(obrazovkaOtazky(q.id).klic); }
          }, t('kontrola.upravit')) : null,
          el('p', { class: 'kontrola__odpoved' + (prazdna ? ' prazdna' : ''), text: prazdna ? t('kontrola.bezOdpovedi') : String(a) }));
      })));
  }
  function vykresliKontrolu() {
    stav.zKontroly = false;
    const jenCist = poTerminu();
    const wrap = el('div', null,
      el('h2', { class: 'nadpis-obrazovky', text: t('kontrola.nadpis') }),
      el('p', { class: 'napoveda', text: jenCist ? t('kontrola.jenCteni') : t('kontrola.perex') }),
      seznamOdpovedi({ upravy: !jenCist }));
    if (jenCist) return wrap;
    const chyba = el('p', { class: 'chyba', role: 'alert', text: konfliktyViditelne().length ? t('konflikt.predOdeslanim') : '' });
    const popis = stav.draft.odeslano ? t('kontrola.odeslatZnovu') : t('kontrola.odeslat');
    const odeslat = el('button', { type: 'button', class: 'tl tl--hlavni' }, el('span', { text: popis }), ikona('i-sipka'));
    odeslat.addEventListener('click', async () => {
      if (odeslat.getAttribute('aria-disabled') === 'true') return;
      if (konfliktyViditelne().length) { chyba.textContent = t('konflikt.predOdeslanim'); return; }
      odeslat.setAttribute('aria-disabled', 'true');
      odeslat.firstChild.textContent = t('kontrola.odesilam');
      chyba.textContent = '';
      clearTimeout(casServer);
      let v;
      try { v = await ulozNaServer('odeslano'); } catch (e) { v = { ok: false }; }
      odeslat.removeAttribute('aria-disabled');
      odeslat.firstChild.textContent = popis;
      if (!v || !v.ok) {
        const d = v && v.duvod;
        chyba.textContent = d === 'klic' ? t('uvod.spatnyOdkaz') : d === 'konflikt' ? t('konflikt.predOdeslanim') : t('kontrola.chybaOdeslani');
        return;
      }
      stav.draft.odeslano = v.dokument.student.odeslano;
      stav.draft.mock = !!v.mock;
      ulozKopii();
      jdi('hotovo');
    });
    wrap.append(
      el('p', { class: 'workshop', text: t('kontrola.workshop') }),
      chyba,
      el('div', { class: 'ovladani' },
        el('button', { type: 'button', class: 'tl tl--vedlejsi tl--ikona', 'aria-label': t('otazka.zpet'), onclick: zpet }, ikona('i-zpet')),
        odeslat));
    return wrap;
  }

  /* ---------- Hotovo ---------- */
  function vykresliHotovo() {
    const d = stav.draft;
    const hero = el('div', { class: 'hero hero--konec' },
      el('h1', { class: 'hero__nadpis' }, (T.hotovo.nadpis || []).map((r) => el('span', { text: r }))));
    if (!d) return [hero, el('div', { class: 'uvod__papir' }, el('div', { class: 'uvod__text' }, el('p', { text: t('hotovo.smazano') })))];

    const smazat = el('button', { type: 'button', class: 'tl tl--tiche tl--smazat' }, t('hotovo.smazat'));
    let potvrzeno = false;
    smazat.addEventListener('click', () => {
      if (!potvrzeno) { potvrzeno = true; smazat.textContent = t('hotovo.smazatPotvrzeni'); return; }
      zapomenNaZarizeni();
      vykresli('hotovo', {});
      hlas(t('hotovo.smazano'));
    });
    const sez = obrazovky();
    return [hero, el('div', { class: 'uvod__papir' },
      el('div', { class: 'uvod__text' }, el('p', { text: t('hotovo.text') })),
      d.mock ? el('p', { class: 'prototyp', text: t('hotovo.prototyp') }) : null,
      el('h2', { class: 'hotovo__nadpis', text: t('odkaz.nadpis') }),
      blokOdkazu(),
      poTerminu() ? null : el('div', { class: 'ovladani' },
        el('button', { type: 'button', class: 'tl tl--hlavni', onclick: () => jdi(sez[0].klic) }, t('hotovo.upravit'), ikona('i-sipka'))),
      el('p', { class: 'hotovo__kopie', text: t('hotovo.kopie') }),
      el('div', { class: 'hotovo__stahnout' },
        el('button', { type: 'button', class: 'tl tl--vedlejsi', onclick: stahniText }, t('hotovo.stahnoutText'), ikona('i-stahnout')),
        el('button', { type: 'button', class: 'tl tl--vedlejsi', onclick: tiskni }, t('hotovo.ulozitPdf'), ikona('i-tisk'))),
      smazat)];
  }

  function souhrn() {
    const d = stav.draft;
    const kdo = `${celeJmeno(d.student)} · ${nazvyProjektu()} · ${d.student.role}`;
    const bloky = viditelneBloky().map((b) => ({
      nazev: b.nazev,
      polozky: b.otazky.map((q) => ({ q: q.text, a: odpoved(q.id) === '' ? t('kontrola.bezOdpovedi') : String(odpoved(q.id)) }))
    }));
    const kdy = d.odeslano ? new Date(d.odeslano).toLocaleString('cs-CZ', { dateStyle: 'long', timeStyle: 'short' }) : '';
    return { kdo, bloky, kdy };
  }
  function stahniText() {
    const s = souhrn();
    const radky = [t('tisk.nadpis').toUpperCase(), s.kdo, s.kdy ? t('tisk.odeslano', { datum: s.kdy }) : '', ''];
    s.bloky.forEach((b) => {
      radky.push('', b.nazev.toUpperCase(), '-'.repeat(b.nazev.length));
      b.polozky.forEach((p) => radky.push('', p.q, p.a));
    });
    radky.push('', '', t('paticka.kdo'));
    const blob = new Blob([radky.join('\n')], { type: 'text/plain;charset=utf-8' });
    const a = el('a', { href: URL.createObjectURL(blob), download: 'ohlednuti-za-natacenim.txt' });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function tiskni() {
    const s = souhrn();
    $('#tisk').replaceChildren(...[
      el('h1', { text: t('tisk.nadpis') }),
      el('p', { class: 'tisk__kdo', text: s.kdo + (s.kdy ? ' · ' + t('tisk.odeslano', { datum: s.kdy }) : '') }),
      s.bloky.map((b) => [el('h2', { text: b.nazev }), b.polozky.map((p) => [el('p', { class: 'tisk__q', text: p.q }), el('p', { class: 'tisk__a', text: p.a })])]),
      el('p', { class: 'tisk__pata', text: `${t('paticka.kdo')} · ${t('paticka.neoficialni')}` })].flat(Infinity));
    window.print();
  }

  /* ---------- start ---------- */
  function vyplnStatickeTexty() {
    document.title = t('titulekStranky');
    document.documentElement.lang = T.jazyk || 'cs';
    document.querySelectorAll('[data-t]').forEach((e) => { e.textContent = t(e.dataset.t); });
    $('.bloky').setAttribute('aria-label', t('otazka.pocetBloku'));
    $('.pruh__odkaz').addEventListener('click', otevriOdkaz);
    $('#odkaz-dialog .odkaz-dialog__zavrit').addEventListener('click', () => $('#odkaz-dialog').close());
  }

  async function nactiStudenta() {
    // 1) klíč z osobního odkazu (#k=…), hned ho schovat z adresního řádku
    const m = location.hash.match(/(?:^#|&)k=([0-9a-fA-F]{32})/);
    const zOdkazu = m ? m[1].toLowerCase() : null;
    if (location.hash) history.replaceState(null, '', location.pathname);
    const klic = zOdkazu || api.klicZarizeni();
    if (!klic) return;

    let dok = null;
    try { dok = await api.nactiPodleKlice(klic); } catch (e) { dok = undefined; }
    const kopie = api.kopieZarizeni();
    const mamKopii = kopie && kopie.klic === klic;
    if (dok === null && !mamKopii) {       // neplatný klíč
      if (zOdkazu) stav.spatnyOdkaz = true;
      else api.smazZarizeni();
      return;
    }
    // Bez porovnávání hodin zařízení se serverem: rozhoduje verze ze serveru (serverUpraveno).
    let draft = dok ? zDokumentu(dok) : null;
    if (mamKopii) {
      const { klic: _k, ...lokalni } = kopie;
      if (!draft) draft = lokalni;                                                    // server nedostupný
      else if (lokalni.serverUpraveno && lokalni.serverUpraveno === draft.serverUpraveno) {
        draft = { ...lokalni, odeslano: draft.odeslano || lokalni.odeslano };         // jinde se nic nezměnilo
      } else draft = sluc(lokalni, dok);                                              // psalo se i jinde
    }
    if (!draft) return;
    stav.klic = klic;
    stav.draft = draft;
    api.ulozKlicZarizeni(klic);
    ulozKopii(false);
  }

  async function start() {
    try {
      const nacti = (f) => fetch(CONTENT + f, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(f); return r.json(); });
      const [texty, projekty, otazky] = await Promise.all([nacti('texty.json'), nacti('projekty.json'), nacti('otazky.json')]);
      T = texty; P = projekty;
      // Ročník a termín platí ze serveru; projekty.json je jen záloha pro výpadek a ukázku bez serveru.
      if (api.info) {
        try { const i = await api.info(); if (i) { P.termin = i.termin; P.dotaznik = i.dotaznik; } } catch (e) { /* záloha */ }
      }
      P.projekty.forEach((p) => PROJ.set(p.id, p));
      BLOKY = normalizuj(otazky);
      api.dotaznik = P.dotaznik;
      api.termin = P.termin;
    } catch (e) {
      $('#panel').textContent = T ? t('chyby.nacteni') : 'Obsah stránky se nepovedlo načíst. Obnov stránku.';
      return;
    }
    vyplnStatickeTexty();
    await nactiStudenta();
    history.replaceState({ k: 'uvod' }, '', location.pathname);
    stav.aktualni = 'uvod';
    vykresli('uvod', {});
  }
  // osobní odkaz vložený do už otevřené stránky (změní se jen část za křížkem)
  window.addEventListener('hashchange', () => { if (/(^#|&)k=/.test(location.hash)) location.reload(); });
  start();
})();
