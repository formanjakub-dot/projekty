/* KNS Program Web — karty z data/obsah.json, slovníček, lightbox, embed mapa/tonda */
(function () {
  const root = document.body.dataset.root || './';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function pill(stavy, stav) {
    const label = (stavy && stavy[stav]) || stav;
    return `<span class="pill p-${esc(stav)}">${esc(label)}</span>`;
  }

  function card(item, stavy) {
    const thumb = item.nahled
      ? `<img src="${esc(item.nahled)}" alt="Náhled: ${esc(item.titul)}" loading="lazy">`
      : `<div class="ph">${item.stav === 'pripravujeme' ? 'připravujeme' : item.stav === 'produkce' ? 'náhled jen po přihlášení' : 'bez náhledu'}</div>`;
    const gal = (item.galerie || []).map(g => `<a href="${esc(g)}" data-lb data-cap="${esc(item.titul)}"><img src="${esc(g)}" alt="" loading="lazy"></a>`).join('');
    let act = '';
    if (item.odkaz) {
      const ext = /^https?:/i.test(item.odkaz);
      act = `<a class="btn" href="${esc(item.odkaz)}"${ext ? ' target="_blank" rel="noopener"' : ''}>${esc(item.odkazText || 'Otevřít')}${ext ? ' ↗' : ' →'}</a>`;
    } else if (item.stav === 'pripravujeme') {
      act = `<span class="btn" aria-disabled="true">Připravujeme</span>`;
    } else if (item.stav === 'lokalni') {
      act = `<span class="btn" aria-disabled="true">Jen lokálně</span>`;
    }
    const thumbHtml = item.odkaz && item.nahled
      ? `<a class="thumb" href="${esc(item.odkaz)}"${/^https?:/i.test(item.odkaz) ? ' target="_blank" rel="noopener"' : ''}>${thumb}</a>`
      : item.nahled ? `<a class="thumb" href="${esc(item.nahled)}" data-lb data-cap="${esc(item.titul)}">${thumb}</a>` : `<div class="thumb">${thumb}</div>`;
    return `<article class="card is-${esc(item.stav)}" id="${esc(item.id)}">
      ${thumbHtml}
      <div class="body">
        <div class="meta">${pill(stavy, item.stav)}<span class="ver">${esc(item.verze || '')}${item.verze && item.datum ? ' · ' : ''}${esc(item.datum || '')}</span></div>
        <h3>${esc(item.titul)}</h3>
        <p class="popis">${esc(item.popis)}</p>
        ${item.pro ? `<p class="kv"><b>Pro koho:</b> ${esc(item.pro)}</p>` : ''}
        ${gal ? `<div class="gal">${gal}</div>` : ''}
        ${(item.stitky || []).length ? `<div class="tags">${item.stitky.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
        ${item.poznamka ? `<p class="pozn">${esc(item.poznamka)}</p>` : ''}
        <div class="act">${act}</div>
      </div>
    </article>`;
  }

  function renderGloss(list) {
    const host = document.querySelector('[data-gloss]');
    if (!host) return;
    const input = document.querySelector('[data-gloss-filter]');
    const draw = q => {
      const ql = (q || '').toLowerCase();
      host.innerHTML = list
        .filter(([k, v]) => !ql || (k + ' ' + v).toLowerCase().includes(ql))
        .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('') || `<div><dd>Nic nenalezeno.</dd></div>`;
    };
    draw('');
    input && input.addEventListener('input', e => draw(e.target.value));
  }

  function renderEmbed(key, cfg, stavy) {
    const host = document.querySelector(`[data-embed="${key}"]`);
    if (!host || !cfg) return;
    if (cfg.stav === 'pripravujeme' || !cfg.soubor) {
      host.innerHTML = `<div class="placeholder"><p class="big">Připravujeme</p><p>${esc(cfg.poznamka || '')}</p></div>`;
      return;
    }
    host.innerHTML = `<p style="margin:.6rem 0 0"><a class="btn sec" href="${esc(cfg.soubor)}">Otevřít na celou obrazovku →</a></p>
      <div class="embed"><iframe src="${esc(cfg.soubor)}" title="${esc(key)}" loading="lazy"></iframe></div>`;
  }

  function lightbox() {
    let lb = document.querySelector('.lb');
    if (!lb) {
      lb = document.createElement('div');
      lb.className = 'lb';
      lb.innerHTML = '<button class="x" aria-label="Zavřít">×</button><img alt=""><div class="cap"></div>';
      document.body.appendChild(lb);
    }
    const img = lb.querySelector('img'), cap = lb.querySelector('.cap');
    const close = () => { lb.classList.remove('open'); img.src = ''; };
    lb.addEventListener('click', e => { if (e.target === lb || e.target.classList.contains('x')) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    document.addEventListener('click', e => {
      const a = e.target.closest('a[data-lb]');
      if (!a) return;
      e.preventDefault();
      img.src = a.getAttribute('href'); cap.textContent = a.dataset.cap || '';
      lb.classList.add('open');
    });
  }

  fetch(root + 'data/obsah.json', { cache: 'no-cache' })
    .then(r => r.json())
    .then(data => {
      document.querySelectorAll('[data-cards]').forEach(host => {
        const list = data[host.dataset.cards] || [];
        const filt = host.dataset.filter;
        const items = filt ? list.filter(i => i.stav === filt) : list;
        host.innerHTML = items.map(i => card(i, data.stavy)).join('') || '<p class="callout">Zatím nic.</p>';
      });
      document.querySelectorAll('[data-count]').forEach(el => {
        const list = data[el.dataset.count] || [];
        el.textContent = list.length;
      });
      renderGloss(data.slovnicek || []);
      renderEmbed('mapa', data.mapa, data.stavy);
      renderEmbed('tonda', data.tonda, data.stavy);
      document.querySelectorAll('[data-updated]').forEach(el => el.textContent = data.aktualizovano || el.textContent);
    })
    .catch(err => {
      document.querySelectorAll('[data-cards]').forEach(h => h.innerHTML = '<p class="callout red">Karty se nenačetly (data/obsah.json). Otevři web přes http server, ne přes file://.</p>');
      console.error(err);
    });

  lightbox();

  // aktivní položka navigace
  const here = location.pathname.replace(/index\.html$/, '');
  document.querySelectorAll('.nav a.item').forEach(a => {
    const href = new URL(a.getAttribute('href'), location.href).pathname.replace(/index\.html$/, '');
    if (href === here) a.setAttribute('aria-current', 'page');
  });
})();
