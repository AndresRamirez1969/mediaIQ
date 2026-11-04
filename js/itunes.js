// Búsqueda de canciones en el catálogo de iTunes / Apple Music
import { CATS, YEAR_FIX } from "./pools/music.js";
import { norm, shuffle, sleep } from "./utils.js";

// Quita lo que va entre paréntesis/corchetes y lo que sigue a " - " (ej. "Song (Remastered) - Live")
export const cleanTitle = (t) =>
  t
    .replace(/\s*[\(\[].*?[\)\]]/g, "")
    .replace(/\s+-\s+.*$/, "")
    .trim();

// Año válido de un resultado de iTunes (0 si no hay o es absurdo)
const yr = (r) => {
  const y = +(r.releaseDate || "").slice(0, 4);
  return y >= 1950 && y <= new Date().getFullYear() ? y : 0;
};

// Versiones que no queremos reproducir: en vivo, remixes, karaoke, regrabaciones…
const BAD =
  /\b(live|remix|mix|karaoke|instrumental|acoustic|demo|sped up|slowed|re-?record(ed)?|taylor.?s version)\b/i;
const BADALBUM =
  /\b(live (at|from|in|on)|unplugged|in concert|karaoke)\b|\(live\)/i;
const altVersion = (r) =>
  BAD.test(
    (r.trackName.match(/[\(\[].*?[\)\]]|\s+-\s+.*$/g) || []).join(" "),
  ) || BADALBUM.test(r.collectionName || "");

// Plan B si fetch falla (por ejemplo, por CORS): JSONP con una etiqueta <script>
function jsonp(url) {
  return new Promise((res, rej) => {
    const cb = "cb" + Math.random().toString(36).slice(2),
      s = document.createElement("script");
    const t = setTimeout(() => {
      cleanup();
      rej(new Error("tiempo de espera agotado"));
    }, 9000);
    function cleanup() {
      clearTimeout(t);
      delete window[cb];
      s.remove();
    }
    window[cb] = (d) => {
      cleanup();
      res(d);
    };
    s.onerror = () => {
      cleanup();
      rej(new Error("error de red"));
    };
    s.src = url + "&callback=" + cb;
    document.head.appendChild(s);
  });
}

// Proxy en Cloudflare (código en worker/itunes-proxy.js). En iPhone, Apple suele redirigir la
// búsqueda a la app de Música y el navegador no puede seguirla; el proxy evita eso.
// Vacío = no se usa el proxy.
const ITUNES_PROXY = "https://mediaiq-itunes.andres-ramirezdea.workers.dev";

// GET de un JSON con tiempo máximo de espera
async function getJSON(url, ms = 8000) {
  const c = new AbortController(),
    t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { signal: c.signal });
    if (!r.ok) throw new Error("http " + r.status);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

export async function itunes(
  term,
  extra = "&media=music&entity=song&attribute=artistTerm&limit=50",
) {
  const query = `/search?term=${encodeURIComponent(term)}${extra}`,
    url = "https://itunes.apple.com" + query;
  // 1) Apple directo. En iPhone suele fallar al instante (redirección a la app de Música).
  try {
    return (await getJSON(url)).results || [];
  } catch (e) {}
  // 2) Proxy: solo se usa cuando falla lo directo, así no se gasta su cupo con desktop/Android
  if (ITUNES_PROXY) {
    try {
      return (await getJSON(ITUNES_PROXY + query)).results || [];
    } catch (e) {}
  }
  // 3) JSONP como último recurso
  return (await jsonp(url)).results || [];
}

// Carga una lista mezclada de canciones de 6 artistas al azar de la categoría
export async function loadCat(cat) {
  const C = CATS[cat],
    arts = shuffle(C.a).slice(0, 6);
  let fails = 0,
    lastErr = "";
  const results = await Promise.allSettled(
    arts.map((a, i) =>
      sleep(i * 350)
        .then(() => itunes(a))
        .then((r) => ({ a, r }))
        .catch((e) => {
          fails++;
          lastErr = e.message;
          throw e;
        }),
    ),
  );
  const lists = [];
  results.forEach((x) => {
    if (x.status != "fulfilled") return;
    const na = norm(x.value.a),
      groups = new Map();
    // Agrupar todas las versiones de la misma canción (original, remaster, recopilatorio…)
    x.value.r
      .filter(
        (r) => r.previewUrl && r.trackName && norm(r.artistName).includes(na),
      )
      .forEach((r) => {
        const k = norm(cleanTitle(r.trackName));
        if (!k) return;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(r);
      });
    const l = [];
    groups.forEach((vs, k) => {
      // El año de la canción es el más antiguo entre todas sus versiones
      const years = vs.map(yr).filter(Boolean),
        first = years.length ? Math.min(...years) : 0;
      // Se reproduce la versión "normal" más antigua
      const ok = vs
        .filter((r) => !altVersion(r))
        .sort((a, b) => (yr(a) || 9999) - (yr(b) || 9999));
      if (!ok.length) return;
      const r = ok[0],
        key = na + "|" + k;
      const song = {
        title: cleanTitle(r.trackName),
        artist: r.artistName,
        url: r.previewUrl,
        art: (r.artworkUrl100 || "").replace("100x100", "300x300"),
        link: r.trackViewUrl,
        year: first ? String(first) : "",
        genre: r.primaryGenreName || "",
        key,
        na,
      };
      // Si la categoría tiene rango de años, descartar lo que cae fuera (suele ser reedición sin original).
      // Las canciones con corrección manual se respetan siempre.
      if (YEAR_FIX[key]) song.year = String(YEAR_FIX[key]);
      else if (
        song.year &&
        ((C.from && +song.year < C.from) || (C.to && +song.year > C.to))
      )
        return;
      l.push(song);
    });
    if (l.length) lists.push(shuffle(l));
  });
  const out = [];
  for (let p = 0; p < 8; p++)
    out.push(...shuffle(lists.map((l) => l[p]).filter(Boolean)));
  if (out.length < 3)
    throw new Error(
      fails == arts.length
        ? "fallaron las " + fails + " peticiones a Apple: " + lastErr
        : "no se encontraron fragmentos reproducibles",
    );
  return out;
}

// Segunda búsqueda (artista + título) justo antes de jugar, para encontrar una fecha más antigua
export async function refineYear(s) {
  if (YEAR_FIX[s.key]) return;
  try {
    const res = await Promise.race([
      itunes(s.artist + " " + s.title, "&media=music&entity=song&limit=25"),
      sleep(4000).then(() => []),
    ]);
    const nt = norm(s.title),
      ys = res
        .filter(
          (r) =>
            r.trackName &&
            norm(r.artistName).includes(s.na) &&
            norm(cleanTitle(r.trackName)) == nt,
        )
        .map(yr)
        .filter(Boolean);
    if (ys.length) {
      const m = Math.min(...ys);
      if (!s.year || m < +s.year) s.year = String(m);
    }
  } catch (e) {}
}
