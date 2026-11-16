/* Administrace — přehled, čtení, stažení, správa. Bez knihoven. Texty v ../content/texty_admin.json. */
(function () {
  'use strict';
  const C = '../content/';
  const api = window.adminApi;
  const $ = (s, r = document) => r.querySelector(s);

  let T, P, OTAZKY = [], PROJ = new Map();
  let D = null; // { termin, studenti }
  const st = { zalozka: 'prehled', filtr: { projekt: '', role: '', stav: '' }, skryte: false, razeni: { k: 'aktivita', smer: -1 }, otazka: null, bezJmen: false, student: null, slouceni: null };

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
    const s = document.createElementNS(ns, 'svg'); s.setAttribute('aria-hidden', 'true');
    const u = document.createElementNS(ns, 'use'); u.setAttribute('href', '#' + id); s.append(u); return s;
  }
  const t = (c, v) => {
    let x = c.split('.').reduce((o, k) => (o == null ? o : o[k]), T);
    if (typeof x === 'string' && v) x = x.replace(/\{(\w+)\}/g, (_, k) => v[k]);
    return x == null ? '' : x;
  };
  const hlas = (x) => { const h = $('#hlaseni'); h.textContent = ''; setTimeout(() => { h.textContent = x; }, 30); };
  // Provede serverovou akci. Úspěch (hláška, překreslení) jen když server akci opravdu provedl; jinak ukáže chybu a nic nemění.
  async function akce(volani, ctiKlic) {
    $('#chyba').textContent = '';
    try {
      const r = await volani();
      if (r && r.ok === false) { const e = new Error('odmitnuto'); e.status = 400; throw e; }
      return r || true;
    } catch (e) {
      const s = e && e.status;
      $('#chyba').textContent = t(s === 0 || s >= 500 ? 'chyby.server' : s === 400 && ctiKlic ? 'chyby.' + ctiKlic : 'chyby.obecna');
      return null;
    }
  }
  const cas = (iso) => iso ? new Date(iso).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const bez = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
  const projNazvy = (ids) => ids.map((id) => (PROJ.get(id) || { nazev: id }).nazev).join(' + ');
  const stav = (s) => (s.odeslano ? 'odeslano' : 'rozpracovano');
  const jmeno = (s) => `${s.jmeno} ${s.prijmeni}`;

  /* ---------- přihlášení ---------- */
  function prihlaseni() {
    document.body.classList.remove('prihlasen');
    $('.a-odhlasit').hidden = true;
    const heslo = el('input', { class: 'pole', id: 'heslo', type: 'password', autocomplete: 'current-password' });
    const chyba = el('p', { class: 'chyba', role: 'alert' });
    try { if (sessionStorage.getItem('famu-admin-vyprselo')) { sessionStorage.removeItem('famu-admin-vyprselo'); chyba.textContent = t('chyby.vyprselo'); } } catch (x) { /* nic */ }
    const odeslat = async (e) => {
      e.preventDefault();
      const r = await api.prihlasit(heslo.value);
      if (!r.ok) { chyba.textContent = r.duvod === 'limit' ? t('prihlaseni.limit') : t('prihlaseni.chyba'); heslo.select(); return; }
      try { sessionStorage.setItem('famu-admin-token', r.token); } catch (x) { /* nic */ }
      start2();
    };
    $('#obsah').replaceChildren(el('form', { class: 'a-login panel', onsubmit: odeslat },
      el('h1', { class: 'nadpis-obrazovky', text: t('prihlaseni.nadpis') }),
      el('p', { class: 'napoveda', text: t('prihlaseni.text') }),
      el('div', { class: 'skupina-pole' }, el('label', { for: 'heslo', text: t('prihlaseni.heslo') }), heslo),
      chyba,
      el('div', { class: 'ovladani' }, el('button', { type: 'submit', class: 'tl tl--hlavni' }, t('prihlaseni.tlacitko'), ikona('i-sipka'))),
      api.poznamka ? el('p', { class: 'prototyp', text: api.poznamka }) : null)); // jen ukázka bez serveru
    heslo.focus();
  }

  /* ---------- kostra ---------- */
  function kostra() {
    document.body.classList.add('prihlasen');
    $('.a-odhlasit').hidden = false;
    const zal = el('nav', { class: 'a-zalozky', 'aria-label': t('titulek') },
      Object.entries(T.zalozky).map(([k, v]) => el('button', { type: 'button', class: 'a-zalozka', 'aria-current': st.zalozka === k ? 'page' : false, onclick: () => { st.zalozka = k; vykresli(); } }, v)));
    const stah = el('div', { class: 'a-stahnout' },
      el('button', { type: 'button', class: 'tl tl--hlavni', title: t('stahnout.vsePopis'), onclick: stahniVse }, t('stahnout.vse'), ikona('i-stahnout')),
      el('button', { type: 'button', class: 'tl tl--vedlejsi', title: t('stahnout.trideniPopis'), onclick: stahniTrideni }, t('stahnout.trideni'), ikona('i-stahnout')),
      el('button', { type: 'button', class: 'tl tl--vedlejsi', title: t('stahnout.studentiPopis'), onclick: tiskniStudenty }, t('stahnout.studenti'), ikona('i-tisk')));
    return [el('div', { class: 'a-hlava' }, zal, stah)];
  }
  function vykresli() {
    const obsah = st.zalozka === 'prehled' ? prehled() : st.zalozka === 'otazky' ? poOtazkach() : st.zalozka === 'studenti' ? poStudentech() : sprava();
    $('#obsah').replaceChildren(...kostra(), el('div', { class: 'panel a-panel' }, obsah));
  }
  const viditelni = () => D.studenti.filter((s) => st.skryte || !s.skryty);

  /* ---------- přehled ---------- */
  function duplicity() {
    const m = new Map();
    D.studenti.filter((s) => !s.skryty).forEach((s) => { const k = bez(jmeno(s)); m.set(k, [...(m.get(k) || []), s.id]); });
    const dup = new Map();
    m.forEach((ids) => { if (ids.length > 1) ids.forEach((id) => dup.set(id, ids)); });
    return dup;
  }
  function prehled() {
    const vse = D.studenti.filter((s) => !s.skryty);
    const odes = vse.filter((s) => s.odeslano).length;
    const souhrn = el('p', { class: 'a-souhrn' },
      el('span', null, el('b', { text: vse.length }), ' ', t('prehled.zacalo')),
      el('span', null, el('b', { text: odes }), ' ', t('prehled.odeslalo')),
      el('span', null, el('b', { text: vse.length - odes }), ' ', t('prehled.rozepsano')));

    const role = P.role.map((r) => r.id);
    const matice = el('table', { class: 'a-matice' },
      el('caption', { text: t('prehled.matice') }),
      el('thead', null, el('tr', null, el('th', { scope: 'col', text: t('prehled.projekt') }), role.map((r) => el('th', { scope: 'col', text: r })))),
      el('tbody', null, P.projekty.map((p) => el('tr', null, el('th', { scope: 'row', text: p.nazev }), role.map((r) => {
        const lide = vse.filter((s) => s.projekty.includes(p.id) && s.role === r);
        const o = lide.filter((s) => s.odeslano).length;
        return el('td', { class: lide.length ? '' : 'nula' }, el('b', { text: o }), ` / ${lide.length}`);
      })))));

    const sel = (k, vsechno, moznosti) => {
      const s = el('select', { class: 'a-select', 'aria-label': vsechno }, el('option', { value: '', text: vsechno }), moznosti.map(([v, n]) => el('option', { value: v, text: n, selected: st.filtr[k] === v })));
      s.addEventListener('change', () => { st.filtr[k] = s.value; vykresli(); });
      return s;
    };
    const skr = el('input', { type: 'checkbox', checked: st.skryte });
    skr.addEventListener('change', () => { st.skryte = skr.checked; vykresli(); });
    const filtry = el('div', { class: 'a-filtry' },
      sel('projekt', t('prehled.vsechnyProjekty'), P.projekty.map((p) => [p.id, p.nazev])),
      sel('role', t('prehled.vsechnyRole'), role.map((r) => [r, r])),
      sel('stav', t('prehled.vsechnyStavy'), [['odeslano', t('prehled.stav.odeslano')], ['rozpracovano', t('prehled.stav.rozpracovano')]]),
      el('label', { class: 'a-check' }, skr, ' ', t('prehled.zobrazitSkryte')));

    const dup = duplicity();
    const f = st.filtr;
    const klice = { jmeno: (s) => bez(s.prijmeni + ' ' + s.jmeno), projekty: (s) => projNazvy(s.projekty), role: (s) => s.role, stav: stav, odpovedi: (s) => s.odpovedi.length, aktivita: (s) => s.upraveno || '' };
    const radky = viditelni()
      .filter((s) => (!f.projekt || s.projekty.includes(f.projekt)) && (!f.role || s.role === f.role) && (!f.stav || stav(s) === f.stav))
      .sort((a, b) => { const k = klice[st.razeni.k]; const x = k(a), y = k(b); return (x > y ? 1 : x < y ? -1 : 0) * st.razeni.smer; });
    const pocetOtazek = (s) => OTAZKY.filter((q) => !q.role || q.role === s.role).length;

    const th = (k) => el('th', { scope: 'col', 'aria-sort': st.razeni.k === k ? (st.razeni.smer > 0 ? 'ascending' : 'descending') : 'none' },
      el('button', { type: 'button', class: 'a-razeni', onclick: () => { st.razeni = { k, smer: st.razeni.k === k ? -st.razeni.smer : 1 }; vykresli(); } }, t('prehled.sloupce.' + k), ikona('i-razeni')));
    const tabulka = radky.length ? el('div', { class: 'a-tabulka-obal' }, el('table', { class: 'a-tabulka' },
      el('thead', null, el('tr', null, ['jmeno', 'projekty', 'role', 'stav', 'odpovedi', 'aktivita'].map(th), el('th', { scope: 'col' }, el('span', { class: 'sr-only', text: '…' })))),
      el('tbody', null, radky.map((s) => el('tr', { class: (dup.has(s.id) ? 'dup ' : '') + (s.skryty ? 'skryty' : '') },
        el('td', null,
          el('button', { type: 'button', class: 'a-jmeno', onclick: () => { st.zalozka = 'studenti'; st.student = s.id; vykresli(); } }, jmeno(s)),
          dup.has(s.id) ? el('span', { class: 'a-stitek a-stitek--dup', text: t('prehled.duplicita') }) : null,
          s.skryty ? el('span', { class: 'a-stitek', text: t('prehled.skryty') }) : null),
        el('td', { text: projNazvy(s.projekty) }),
        el('td', { text: s.role }),
        el('td', null, el('span', { class: 'a-stav a-stav--' + stav(s), text: t('prehled.stav.' + stav(s)) })),
        el('td', { class: 'cislo', text: `${s.odpovedi.length}/${pocetOtazek(s)}` }),
        el('td', { class: 'cislo', text: cas(s.upraveno) }),
        el('td', { class: 'a-akce' },
          dup.has(s.id) ? el('button', { type: 'button', class: 'tl tl--tiche', onclick: () => { st.slouceni = dup.get(s.id); vykresli(); } }, t('prehled.sloucit')) : null,
          el('button', { type: 'button', class: 'tl tl--tiche', onclick: async () => { if (await akce(() => api.skryt(s.id, !s.skryty))) await obnov(); } }, s.skryty ? t('prehled.odkryt') : t('prehled.skryt'))))))))
      : el('p', { class: 'napoveda', text: D.studenti.length ? t('prehled.prazdne') : t('prehled.zadnaData') });

    return [souhrn, st.slouceni ? slouceni() : null, filtry, tabulka, matice];
  }

  function slouceni() {
    const [a, b] = st.slouceni.map((id) => D.studenti.find((s) => s.id === id));
    if (!a || !b) { st.slouceni = null; return null; }
    const karta = (x, y) => el('div', { class: 'a-karta' },
      el('p', { class: 'a-karta__jmeno', text: jmeno(x) }),
      el('p', { text: `${projNazvy(x.projekty)} · ${x.role} · ${t('prehled.stav.' + stav(x))}` }),
      el('p', { text: `${x.odpovedi.length} ${t('prehled.sloupce.odpovedi').toLowerCase()} · ${cas(x.upraveno)}` }),
      el('button', { type: 'button', class: 'tl tl--hlavni', onclick: async () => { if (!await akce(() => api.sloucit(x.id, y.id), 'sloucit')) return; st.slouceni = null; hlas(t('slouceni.hotovo')); await obnov(); } }, t('slouceni.ponechat')));
    return el('section', { class: 'a-slouceni', 'aria-labelledby': 'sl-h' },
      el('h2', { id: 'sl-h', text: t('slouceni.nadpis') }),
      el('p', { class: 'napoveda', text: t('slouceni.text') }),
      el('div', { class: 'a-slouceni__karty' }, karta(a, b), karta(b, a)),
      el('button', { type: 'button', class: 'tl tl--tiche', onclick: () => { st.slouceni = null; vykresli(); } }, t('slouceni.zrusit')));
  }

  /* ---------- po otázkách ---------- */
  function poOtazkach() {
    if (!st.otazka) st.otazka = OTAZKY[0].id;
    const s = el('select', { class: 'a-select a-select--siroky', id: 'otazka' },
      OTAZKY.map((q) => el('option', { value: q.id, text: `${q.blok} · ${q.text}`, selected: q.id === st.otazka })));
    s.addEventListener('change', () => { st.otazka = s.value; vykresli(); });
    const bj = el('input', { type: 'checkbox', checked: st.bezJmen });
    bj.addEventListener('change', () => { st.bezJmen = bj.checked; vykresli(); });
    const q = OTAZKY.find((x) => x.id === st.otazka);
    const odp = viditelni().flatMap((st2) => st2.odpovedi.filter((o) => o.id_otazky === st.otazka).map((o) => ({ s: st2, o })));
    return [
      el('div', { class: 'a-filtry' }, el('label', { class: 'sr-only', for: 'otazka', text: t('otazky.vyber') }), s, el('label', { class: 'a-check' }, bj, ' ', t('otazky.bezJmen'))),
      el('h2', { class: 'a-otazka', text: q.text }),
      el('p', { class: 'napoveda', text: t('otazky.pocet', { n: odp.length }) }),
      odp.length ? el('ol', { class: 'a-odpovedi' }, odp.map(({ s: x, o }) => el('li', null,
        el('p', { class: 'a-odpoved', text: o.text }),
        el('p', { class: 'a-meta' },
          st.bezJmen ? null : el('b', { text: jmeno(x) }),
          el('span', { class: 'a-stitek', text: projNazvy(x.projekty) }),
          el('span', { class: 'a-stitek a-stitek--role', text: x.role }),
          el('span', { text: cas(o.cas) }))))) : el('p', { text: t('otazky.zadna') })
    ];
  }

  /* ---------- po studentech ---------- */
  function poStudentech() {
    const lide = viditelni().slice().sort((a, b) => bez(a.prijmeni).localeCompare(bez(b.prijmeni)));
    if (!lide.length) return el('p', { text: t('prehled.zadnaData') });
    if (!st.student || !lide.some((s) => s.id === st.student)) st.student = lide[0].id;
    const s = el('select', { class: 'a-select a-select--siroky', id: 'student' },
      lide.map((x) => el('option', { value: x.id, text: `${x.prijmeni} ${x.jmeno} · ${projNazvy(x.projekty)} · ${x.role}`, selected: x.id === st.student })));
    s.addEventListener('change', () => { st.student = s.value; vykresli(); });
    const x = lide.find((y) => y.id === st.student);

    const odkazMisto = el('div', { 'aria-live': 'polite' });
    const obnovit = el('button', { type: 'button', class: 'tl tl--vedlejsi' }, t('studenti.obnovitOdkaz'));
    obnovit.addEventListener('click', async () => {
      const r = await akce(() => api.obnovOdkaz(x.id));
      if (!r) return;
      const url = new URL('../#k=' + r.klic, location.href).href;
      const vstup = el('input', { class: 'odkaz__adresa', readonly: true, value: url, 'aria-label': t('studenti.novyOdkaz') });
      const kop = el('button', { type: 'button', class: 'tl tl--vedlejsi' }, t('studenti.zkopirovat'));
      kop.addEventListener('click', async () => { try { await navigator.clipboard.writeText(url); kop.textContent = t('studenti.zkopirovano'); } catch (e) { vstup.select(); } });
      odkazMisto.replaceChildren(el('p', { class: 'napoveda', text: t('studenti.obnovitText') }), vstup, kop);
    });
    const smazat = el('button', { type: 'button', class: 'tl tl--tiche a-nebezpecne' }, t('studenti.smazat'));
    let potvrzeno = false;
    smazat.addEventListener('click', async () => {
      if (!potvrzeno) { potvrzeno = true; smazat.textContent = t('studenti.smazatPotvrzeni'); return; }
      if (!await akce(() => api.smazStudenta(x.id))) { potvrzeno = false; smazat.textContent = t('studenti.smazat'); return; }
      st.student = null; hlas(t('studenti.smazano')); await obnov();
    });

    const bloky = [];
    OTAZKY.filter((q) => !q.role || q.role === x.role).forEach((q) => {
      if (!bloky.length || bloky[bloky.length - 1].nazev !== q.blok) bloky.push({ nazev: q.blok, q: [] });
      bloky[bloky.length - 1].q.push(q);
    });
    const odp = new Map(x.odpovedi.map((o) => [o.id_otazky, o]));
    return [
      el('div', { class: 'a-filtry' }, el('label', { class: 'sr-only', for: 'student', text: t('studenti.vyber') }), s),
      el('h2', { class: 'a-otazka', text: jmeno(x) }),
      el('p', { class: 'napoveda', text: `${projNazvy(x.projekty)} · ${x.role} · ${t('prehled.stav.' + stav(x))} · ${cas(x.upraveno)}` }),
      bloky.map((b, i) => el('section', { class: 'kontrola__blok' },
        el('h3', null, el('span', { text: i + 1 }), b.nazev),
        b.q.map((q) => {
          const o = odp.get(q.id);
          return el('div', { class: 'kontrola__polozka' },
            el('p', { class: 'kontrola__otazka', text: q.text }),
            el('p', { class: 'kontrola__odpoved' + (o ? '' : ' prazdna'), text: o ? o.text : t('studenti.bezOdpovedi') }));
        }))),
      el('div', { class: 'a-sprava-studenta' }, obnovit, odkazMisto, smazat)
    ];
  }

  /* ---------- správa ---------- */
  function sprava() {
    const d = D.termin ? new Date(D.termin) : null;
    const p2 = (n) => String(n).padStart(2, '0');
    const hodnota = d ? `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}` : '';
    const termin = el('input', { class: 'pole', id: 'termin', type: 'datetime-local', value: hodnota });
    const terminInfo = el('p', { class: 'napoveda', 'aria-live': 'polite' });
    const slovo = el('input', { class: 'pole', id: 'slovo', type: 'text', autocomplete: 'off' });
    const smazat = el('button', { type: 'button', class: 'tl tl--hlavni a-nebezpecne-plne', 'aria-disabled': 'true' }, t('sprava.smazatVseTlacitko'));
    slovo.addEventListener('input', () => smazat.setAttribute('aria-disabled', String(slovo.value.trim() !== t('sprava.smazatVseSlovo'))));
    smazat.addEventListener('click', async () => {
      if (smazat.getAttribute('aria-disabled') === 'true') { slovo.focus(); return; }
      if (!await akce(() => api.smazVse(slovo.value.trim()))) return;
      hlas(t('sprava.smazanoVse')); await obnov();
    });
    return [
      el('section', { class: 'a-sekce' },
        el('h2', { class: 'a-otazka', text: t('sprava.termin') }),
        el('p', { class: 'napoveda', text: t('sprava.terminText') }),
        el('label', { class: 'sr-only', for: 'termin', text: t('sprava.termin') }), termin,
        el('div', { class: 'ovladani' }, el('button', { type: 'button', class: 'tl tl--vedlejsi', onclick: async () => { if (!termin.value) return; terminInfo.textContent = ''; if (!await akce(() => api.nastavTermin(new Date(termin.value).toISOString()))) return; terminInfo.textContent = t('sprava.ulozeno'); D = await api.nactiVse(); } }, t('sprava.ulozit'))),
        terminInfo),
      el('section', { class: 'a-sekce' },
        el('h2', { class: 'a-otazka', text: t('sprava.prihlaseni') }),
        el('p', { class: 'napoveda', text: t('sprava.prihlaseniText') })),
      el('section', { class: 'a-sekce a-sekce--nebezpecne' },
        el('h2', { class: 'a-otazka', text: t('sprava.smazatVse') }),
        el('p', { class: 'napoveda', text: t('sprava.smazatVseText') }),
        el('label', { class: 'sr-only', for: 'slovo', text: t('sprava.smazatVseSlovo') }), slovo,
        el('div', { class: 'ovladani' }, smazat))
    ];
  }

  /* ---------- stažení ---------- */
  function csv(radky) {
    // Buňku začínající =, +, -, @, tabulátorem nebo CR by Excel/Numbers vzaly jako vzorec: apostrof ji nechá textem.
    const bunka = (v) => { let s = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return '﻿' + radky.map((r) => r.map(bunka).join(';')).join('\r\n') + '\r\n';
  }
  function stahni(nazev, obsah, typ) {
    const a = el('a', { href: URL.createObjectURL(new Blob([obsah], { type: typ })), download: nazev });
    document.body.append(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  const textOtazky = (id) => (OTAZKY.find((q) => q.id === id) || { text: id }).text;
  const poradiOtazky = (id) => { const i = OTAZKY.findIndex((q) => q.id === id); return i < 0 ? 999 : i; };
  const proExport = () => D.studenti.filter((s) => !s.skryty).sort((a, b) => bez(a.prijmeni).localeCompare(bez(b.prijmeni)));
  const odpovediSerazene = (s) => s.odpovedi.slice().sort((a, b) => poradiOtazky(a.id_otazky) - poradiOtazky(b.id_otazky));
  function stahniVse() {
    const r = [t('stahnout.sloupce')];
    proExport().forEach((s) => odpovediSerazene(s).forEach((o) => r.push([s.jmeno, s.prijmeni, projNazvy(s.projekty), s.role, o.id_otazky, textOtazky(o.id_otazky), o.text, o.cas])));
    stahni(t('stahnout.soubory.vse'), csv(r), 'text/csv;charset=utf-8');
  }
  function stahniTrideni() {
    const lide = proExport();
    const kod = new Map(lide.map((s, i) => [s.id, 'S' + String(i + 1).padStart(2, '0')]));
    const r = [t('stahnout.sloupceTrideni')];
    lide.forEach((s) => odpovediSerazene(s).forEach((o) => r.push([kod.get(s.id), projNazvy(s.projekty), s.role, o.id_otazky, textOtazky(o.id_otazky), o.text, o.cas])));
    const k = [t('stahnout.sloupceKlic'), ...lide.map((s) => [kod.get(s.id), s.jmeno, s.prijmeni, projNazvy(s.projekty), s.role])];
    stahni(t('stahnout.soubory.trideni'), csv(r), 'text/csv;charset=utf-8');
    setTimeout(() => stahni(t('stahnout.soubory.klic'), csv(k), 'text/csv;charset=utf-8'), 400);
  }
  function tiskniStudenty() {
    $('#tisk').replaceChildren(...[
      el('h1', { text: t('stahnout.tiskNadpis') }),
      proExport().map((s) => el('section', { class: 'tisk__student' },
        el('h2', { text: jmeno(s) }),
        el('p', { class: 'tisk__kdo', text: `${projNazvy(s.projekty)} · ${s.role} · ${t('prehled.stav.' + stav(s))} · ${cas(s.upraveno)}` }),
        odpovediSerazene(s).map((o) => [el('p', { class: 'tisk__q', text: textOtazky(o.id_otazky) }), el('p', { class: 'tisk__a', text: o.text })]))),
      el('p', { class: 'tisk__pata', text: t('paticka') })].flat(Infinity));
    window.print();
  }

  /* ---------- start ---------- */
  async function obnov() { D = await api.nactiVse(); vykresli(); }
  async function start2() {
    D = await api.nactiVse();
    vykresli();
    $('#obsah').focus({ preventScroll: true });
  }
  async function start() {
    const nacti = (f) => fetch(C + f, { cache: 'no-cache' }).then((r) => r.json());
    const [ta, pr, ot, tx] = await Promise.all([nacti('texty_admin.json'), nacti('projekty.json'), nacti('otazky.json'), nacti('texty.json')]);
    T = ta; P = pr;
    P.projekty.forEach((p) => PROJ.set(p.id, p));
    const vyn = new Set(tx.vynechatOtazky || []);
    OTAZKY = ot.flatMap((b) => (b.otazky || []).filter((q) => !vyn.has(q.id)).map((q) => ({ id: q.id, text: q.text, blok: b.blok, role: ['PM', 'PA'].includes(String(q.role).toUpperCase()) ? String(q.role).toUpperCase() : null })));
    document.title = t('titulek');
    document.querySelectorAll('[data-t]').forEach((e) => { e.textContent = t(e.dataset.t); });
    $('.a-odhlasit').addEventListener('click', async () => {
      if (api.odhlasit) await api.odhlasit(); // zruší relaci i na serveru
      try { sessionStorage.removeItem('famu-admin-token'); } catch (e) { /* nic */ }
      prihlaseni();
    });
    let token = null;
    try { token = sessionStorage.getItem('famu-admin-token'); } catch (e) { /* nic */ }
    if (token) start2(); else prihlaseni();
  }
  start();
})();
