/*
 * Rozhraní administrace k serveru. S vyplněným `server` v ../config.js volá edge funkci `admin`
 * (docs/backend.md); bez něj běží MOCK níže s vymyšlenými daty (mock_data.json).
 * Každé volání kromě prihlasit() nese token v hlavičce Authorization: Bearer <token>.
 *
 *   prihlasit(heslo)                -> { ok, token, kdo } | { ok: false, duvod? }   duvod 'limit' = moc pokusů
 *   odhlasit()                      -> zruší relaci na serveru (jen se serverem)
 *   poznamka                        -> text pro přihlášení, jen v ukázce bez serveru
 *   nactiVse()                      -> { termin, studenti: [Student] }      Student = id, jmeno, prijmeni, projekty, role,
 *                                                                           zalozeno, upraveno, odeslano, skryty, slouceno_do, odpovedi
 * Se serverem každá akce kromě prihlasit() při neúspěchu (stav mimo 2xx, ok:false, výpadek) vyhodí Error se `status`
 * (0 = server neodpověděl); mock vrací { ok: false }. admin.js řeší obojí. 401 vrátí na přihlášení.
 *   obnovOdkaz(id)                  -> { ok, klic }                         nový klíč, starý otisk se zahodí
 *   smazStudenta(id)                -> { ok }
 *   skryt(id, skryty)               -> { ok }
 *   sloucit(idPonechat, idSloucit)  -> { ok }                               doplní chybějící odpovědi, druhý skryje
 *   nastavTermin(iso)               -> { ok }
 *   smazVse(potvrzeni)              -> { ok }                               potvrzeni musí být "SMAZAT"
 */
(function () {
  const KLIC = 'famu-postmortem:mockadmin:data';
  // MOCK: heslo a poznámku dodává jen ukázka bez serveru (tests/server_4496.py) v config.js, na ostrý web nejdou.
  const MOCK = (window.FAMU_CONFIG && window.FAMU_CONFIG.mock) || {};
  const pauza = (ms) => new Promise((r) => setTimeout(r, ms));
  let data = null;

  async function db() {
    if (data) return data;
    try { data = JSON.parse(localStorage.getItem(KLIC) || 'null'); } catch (e) { data = null; }
    if (!data) {
      data = await fetch('mock_data.json', { cache: 'no-cache' }).then((r) => r.json());
      ulozit();
    }
    return data;
  }
  function ulozit() { try { localStorage.setItem(KLIC, JSON.stringify(data)); } catch (e) { /* bez úložiště */ } }
  function klic() {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  }

  window.adminApi = {
    poznamka: MOCK.poznamka,
    async prihlasit(heslo) {
      await pauza(300);
      return MOCK.heslo && heslo === MOCK.heslo ? { ok: true, token: 'mock-' + klic(), kdo: 'mock' } : { ok: false };
    },
    async nactiVse() { await pauza(150); const d = await db(); return JSON.parse(JSON.stringify(d)); },
    async obnovOdkaz(id) { await pauza(250); await db(); return { ok: data.studenti.some((s) => s.id === id), klic: klic() }; },
    async smazStudenta(id) { await db(); data.studenti = data.studenti.filter((s) => s.id !== id); ulozit(); return { ok: true }; },
    async skryt(id, skryty) { await db(); const s = data.studenti.find((x) => x.id === id); if (s) s.skryty = skryty; ulozit(); return { ok: !!s }; },
    async sloucit(idPonechat, idSloucit) {
      await db();
      const a = data.studenti.find((s) => s.id === idPonechat);
      const b = data.studenti.find((s) => s.id === idSloucit);
      if (!a || !b) return { ok: false };
      const mam = new Set(a.odpovedi.map((o) => o.id_otazky));
      b.odpovedi.forEach((o) => { if (!mam.has(o.id_otazky)) a.odpovedi.push(o); });
      a.projekty = [...new Set([...a.projekty, ...b.projekty])];
      b.skryty = true;
      b.slouceno_do = a.id;
      ulozit();
      return { ok: true };
    },
    async nastavTermin(iso) { await db(); data.termin = iso; ulozit(); return { ok: true }; },
    async smazVse(potvrzeni) { await db(); if (potvrzeni !== 'SMAZAT') return { ok: false }; data.studenti = []; ulozit(); return { ok: true }; },
    async obnovitMock() { localStorage.removeItem(KLIC); data = null; return db(); }
  };

  /* --- SERVER: edge funkce `admin`. Když je v ../config.js vyplněné `server`, mock se nepoužívá. --- */
  const SERVER = (window.FAMU_CONFIG && window.FAMU_CONFIG.server) || '';
  if (!SERVER) return;
  const TOKEN = 'famu-admin-token'; // ukládá admin.js do sessionStorage po přihlášení
  function token() { try { return sessionStorage.getItem(TOKEN) || ''; } catch (e) { return ''; } }
  const VYPRSELO = 'famu-admin-vyprselo'; // admin.js ho přečte a ukáže větu na přihlášení
  function chyba(status, d) { const e = new Error('server ' + status); e.status = status; e.kod = d && d.duvod; return e; }
  async function volej(telo) {
    const hl = { 'Content-Type': 'application/json' };
    if (telo.akce !== 'prihlasit' && token()) hl.Authorization = 'Bearer ' + token();
    let r;
    try { r = await fetch(SERVER + '/famu-admin', { method: 'POST', headers: hl, body: JSON.stringify(telo), cache: 'no-store', credentials: 'omit' }); }
    catch (e) { throw chyba(0); } // výpadek spojení
    let d = null;
    try { d = await r.json(); } catch (e) { d = null; }
    if (r.status === 401 && telo.akce !== 'prihlasit') {
      // relace vypršela nebo neplatí → zpátky na přihlášení
      try { sessionStorage.removeItem(TOKEN); sessionStorage.setItem(VYPRSELO, '1'); } catch (e) { /* nic */ }
      location.reload();
      return new Promise(() => {});
    }
    if (telo.akce === 'prihlasit') { if (!d) throw chyba(r.status); return d; }
    // ostatní akce: úspěch jen při 2xx a ok !== false, jinak vyhodí chybu se stavem (400, 500, …)
    if (!r.ok || !d || d.ok === false) throw chyba(r.status, d);
    return d;
  }
  window.adminApi = {
    async prihlasit(heslo) { const d = await volej({ akce: 'prihlasit', heslo }); return d.ok ? { ok: true, token: d.token, kdo: d.kdo } : { ok: false, duvod: d.duvod }; },
    async odhlasit() { try { await volej({ akce: 'odhlasit' }); } catch (e) { /* odhlásí se aspoň v prohlížeči */ } },
    async nactiVse() { const d = await volej({ akce: 'vse' }); if (!d.ok) throw new Error('nactiVse'); return { termin: d.termin, studenti: d.studenti }; },
    async obnovOdkaz(id) { return volej({ akce: 'obnovOdkaz', id }); },
    async smazStudenta(id) { return volej({ akce: 'smazStudenta', id }); },
    async skryt(id, skryty) { return volej({ akce: 'skryt', id, skryty }); },
    async sloucit(idPonechat, idSloucit) { return volej({ akce: 'sloucit', idPonechat, idSloucit }); },
    async nastavTermin(iso) { return volej({ akce: 'nastavTermin', termin: iso }); },
    async smazVse(potvrzeni) { return volej({ akce: 'smazVse', potvrzeni }); }
  };
})();
