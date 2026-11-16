/*
 * Rozhraní k serveru pro studentskou stránku. Jediné místo, které Tomáš nahradí skutečným API.
 * Bez účtů a hesel: student má tajný klíč (32 hex znaků). Server zná jen jeho otisk (SHA-256).
 *
 *   zalozStudenta({ jmeno, prijmeni, projekty, role }) -> Promise<{ ok: true, klic } | { ok: false }>
 *   nactiPodleKlice(klic)                              -> Promise<Dokument | null>   (null = neplatný klíč)
 *   ulozOdpovedi(klic, data)                           -> Promise<{ ok: boolean, dokument?, duvod? }>
 *       data = { student: { jmeno, prijmeni, projekty, role }, odpovedi: [{ id_otazky, text, cas }], stav, zaklad? }
 *       stav = 'rozpracovano' (průběžné ukládání) | 'odeslano' (tlačítko Odeslat / Uložit změny)
 *       Server po termínu vrací { ok: false, duvod: 'termin' }, po změně na jiném zařízení
 *       { ok: false, duvod: 'konflikt', dokument } (mock kontrolu verze nedělá).
 *   info()  (jen se serverem)                          -> Promise<{ dotaznik, termin } | null>
 *   Dokument = viz docs/data_model.md (schema famu-postmortem/student@1).
 *
 * Klíč posílej v hlavičce (Authorization: Bearer <klic>), nikdy v query stringu.
 * Osobní odkaz nese klíč za křížkem (#k=…), takže se k serveru nedostane v adrese.
 *
 * SERVER: když je v config.js vyplněné `server` (na Netlify '/api' → edge funkce Supabase `student`),
 * volají se skutečné funkce. Prázdné `server` = původní MOCK níže.
 * MOCK: „server“ je samostatný jmenný prostor v localStorage (famu-postmortem:mockserver:*),
 * oddělený od dat „tohoto zařízení“ (famu-postmortem:<dotaznik>:zarizeni:*).
 */
(function () {
  const PREFIX = 'famu-postmortem:';
  const SERVER = (window.FAMU_CONFIG && window.FAMU_CONFIG.server) || '';

  function cti(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function pis(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function smaz(k) { try { localStorage.removeItem(k); } catch (e) { /* bez úložiště */ } }
  const pauza = (ms) => new Promise((r) => setTimeout(r, ms));

  async function otisk(klic) {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(klic));
    return Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
  }
  function novyKlic() {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  }
  function iso() { return new Date().toISOString(); }

  const api = {
    dotaznik: 'default',
    termin: null,

    /* --- MOCK serveru: nahradit voláním API ---------------------------------- */
    async zalozStudenta(student) {
      await pauza(350);
      const klic = novyKlic();
      const h = await otisk(klic);
      const ted = iso();
      pis(`${PREFIX}mockserver:${api.dotaznik}:${h}`, {
        schema: 'famu-postmortem/student@1',
        dotaznik: api.dotaznik,
        student: { ...student, klic_hash: h, zalozeno: ted, upraveno: ted, odeslano: null },
        odpovedi: []
      });
      return { ok: true, klic };
    },

    async nactiPodleKlice(klic) {
      await pauza(200);
      if (!/^[0-9a-f]{32}$/.test(klic || '')) return null;
      return cti(`${PREFIX}mockserver:${api.dotaznik}:${await otisk(klic)}`);
    },

    async ulozOdpovedi(klic, data) {
      await pauza(data.stav === 'odeslano' ? 600 : 120);
      const k = `${PREFIX}mockserver:${api.dotaznik}:${await otisk(klic)}`;
      const dok = cti(k);
      if (!dok) return { ok: false, duvod: 'klic' };
      if (api.termin && Date.now() > Date.parse(api.termin)) return { ok: false, duvod: 'termin' };
      const ted = iso();
      dok.student = { ...dok.student, ...data.student, upraveno: ted };
      if (data.stav === 'odeslano') dok.student.odeslano = ted;
      dok.odpovedi = data.odpovedi;
      pis(k, dok);
      if (data.stav === 'odeslano') console.info('[mock] ulozOdpovedi', dok);
      return { ok: true, dokument: dok, mock: true };
    },
    /* ------------------------------------------------------------------------ */

    /* Tohle zařízení: klíč a kopie rozepsaného (pro výpadek sítě). Zůstává i po napojení serveru. */
    klicZarizeni() { return cti(`${PREFIX}${api.dotaznik}:zarizeni:klic`); },
    ulozKlicZarizeni(klic) { pis(`${PREFIX}${api.dotaznik}:zarizeni:klic`, klic); },
    kopieZarizeni() { return cti(`${PREFIX}${api.dotaznik}:zarizeni:kopie`); },
    ulozKopiiZarizeni(dok) { return pis(`${PREFIX}${api.dotaznik}:zarizeni:kopie`, dok); },
    smazZarizeni() {
      smaz(`${PREFIX}${api.dotaznik}:zarizeni:klic`);
      smaz(`${PREFIX}${api.dotaznik}:zarizeni:kopie`);
    }
  };

  /* --- SERVER: edge funkce `student`. Klíč jen v hlavičce Authorization, nikdy v adrese. ------ */
  async function volej(telo, klic) {
    const hl = { 'Content-Type': 'application/json' };
    if (klic) hl.Authorization = 'Bearer ' + klic;
    const r = await fetch(SERVER + '/famu-student', { method: 'POST', headers: hl, body: JSON.stringify(telo), cache: 'no-store', credentials: 'omit' });
    let data = null;
    try { data = await r.json(); } catch (e) { data = null; }
    if (!data || (r.status >= 500)) throw new Error('server ' + r.status); // výpadek → stránka ukáže chybu sítě
    return { status: r.status, data };
  }
  if (SERVER) {
    // Ročník a termín ze serveru (famu.nastaveni) — jediný zdroj pravdy. null = nepovedlo se.
    api.info = async () => {
      const { data } = await volej({ akce: 'info' });
      return data.ok ? data : null;
    };
    api.zalozStudenta = async (student) => {
      const { data } = await volej({ akce: 'zaloz', dotaznik: api.dotaznik, student });
      return data.ok ? { ok: true, klic: data.klic } : { ok: false, duvod: data.duvod };
    };
    api.nactiPodleKlice = async (klic) => {
      if (!/^[0-9a-f]{32}$/.test(klic || '')) return null;
      const { status, data } = await volej({ akce: 'nacti' }, klic);
      if (status === 404 && data.duvod === 'klic') return null; // jen tohle je „neplatný klíč“, jiná 404 = výpadek
      if (!data.ok) throw new Error('nacti ' + status);
      return data.dokument;
    };
    // d.zaklad = student.upraveno, ze kterého stránka vycházela; při změně jinde vrátí { duvod: 'konflikt', dokument }
    api.ulozOdpovedi = async (klic, d) => {
      const { data } = await volej({ akce: 'uloz', student: d.student, odpovedi: d.odpovedi, stav: d.stav, zaklad: d.zaklad || null }, klic);
      return data;
    };
  }

  window.famuApi = api;
  window.zalozStudenta = (s) => api.zalozStudenta(s);
  window.nactiPodleKlice = (k) => api.nactiPodleKlice(k);
  window.ulozOdpovedi = (k, d) => api.ulozOdpovedi(k, d);
})();
