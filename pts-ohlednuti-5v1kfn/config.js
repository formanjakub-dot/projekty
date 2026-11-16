/* Jediné nastavení webu (studentská stránka i administrace).
 *   server: úplná adresa edge funkcí Supabase (…/functions/v1). Prohlížeč je volá přímo, bez proxy
 *           a bez klíče Supabase. Tady je lokální Supabase; ostrou adresu dosadí při sestavení
 *           scripts/sestav.sh <adresa> (spouští ho scripts/nasad_pages.sh), stejně jako do CSP v obou HTML.
 *   server: ''  → ukázka s vymyšleným serverem v prohlížeči (mock), viz tests/server_4496.py.
 * Žádné klíče ani tajemství sem nepatří. */
window.FAMU_CONFIG = { server: 'https://vpxnwpfkcurggdyobdbt.supabase.co/functions/v1' };
