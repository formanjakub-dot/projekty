# projekty

Statický hosting decků a prototypů NICE! / Družina. Náhrada za Netlify (free plán vyčerpaný).

- **Dnes:** `https://formanjakub-dot.github.io/projekty/<slug>/`
- **Po nastavení DNS:** `https://projekty.jakubforman.cz/<slug>/` (stejné soubory, žádná změna obsahu)

## Pravidla

1. Každý projekt = podsložka se **neuhodnutelným slugem** ve tvaru `<nazev>-<6 znaků>`, např. `telata-tissue-druzina-k4m9x2`.
2. Kořen `/` je prázdná stránka s logem NICE! — **nikdy tam nedávat seznam projektů**.
3. Každý deck musí mít v `<head>`: `<meta name="robots" content="noindex,nofollow">`.
4. Repo je public (obsah = prezentace, které stejně posíláme klientům). Diskrétnost drží slug, ne přístupová práva. **Nic tajného sem nepatří.**
5. Limity GitHub Pages: 100 MB / soubor, 1 GB / repo, ~100 GB měsíčně provoz.
   Deck nad ~15 MB → obrázky ven z bundlu jako soubory vedle `index.html`.

## Deploy

```
~/Claude/Projects/NICE_Decks/tools/deploy_pages.sh <dist_dir_nebo_soubor> <slug>
```

Např.:
```
~/Claude/Projects/NICE_Decks/tools/deploy_pages.sh \
  ~/Claude/Projects/NICE_Decks/2026-09-07_Telata_tissue_v0.1/dist telata-tissue-druzina-k4m9x2
```

## Vlastní doména — co zbývá

1. U registrátora domény `jakubforman.cz` přidat DNS záznam:
   `CNAME  projekty  →  formanjakub-dot.github.io.`
2. Až se záznam propíše (`dig projekty.jakubforman.cz CNAME +short`):
   ```
   cd ~/Claude/Projects/projekty
   git mv CNAME.ready CNAME && git commit -m "chore: custom domain projekty.jakubforman.cz" && git push
   ```
3. V Settings → Pages zapnout **Enforce HTTPS** (certifikát se vydá pár minut po commitu CNAME).

`CNAME.ready` je záměrně mimo funkci — kdyby se `CNAME` commitl před nastavením DNS, Pages hlásí chybu domény.
