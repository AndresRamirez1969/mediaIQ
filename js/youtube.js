// Escenas de películas en YouTube: búsqueda con la Data API y reproductor (IFrame API)
import { norm, shuffle } from "./utils.js";

// Clave de la API de YouTube del juego (los jugadores no ingresan la suya).
const YT_KEY = "AIzaSyCxcFE0vfTxrRIK5yv0vWiu8mcN7RVqFcA";

// ===== Búsqueda de escenas =====

// localStorage puede fallar (modo privado, almacenamiento bloqueado): en ese caso no se guarda nada
const lsGet = (k) => {
  try {
    return localStorage.getItem(k);
  } catch (e) {
    return null;
  }
};
const lsSet = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch (e) {}
};

// La API devuelve los títulos con entidades HTML (&amp;, &#39;…)
const decodeHTML = (t) => {
  const x = document.createElement("textarea");
  x.innerHTML = t;
  return x.value;
};
// Texto en minúsculas, sin acentos y con palabras separadas por un espacio (y espacios en los extremos)
const lw = (t) =>
  " " +
  t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim() +
  " ";
// Videos que no son escenas: tráileres, reseñas, reacciones, parodias, películas completas…
const BAD_YT =
  /trailer|teaser|tr[aá]iler|avance|review|rese[nñ]a|reaction|reacci|explained|explicad|behind the scenes|detr[aá]s de c[aá]maras|making of|interview|entrevista|recap|resumen|fan ?made|tiktok|#shorts|parod|honest|pitch meeting|cinemasins|everything wrong|full movie|pel[ií]cula completa|lyrics|letra|karaoke|gameplay|lego|minecraft|fortnite|unboxing|top ?\d+|ranking|bloopers|reacting|podcast|analysis|an[aá]lisis|theory|teor[ií]a|easter eggs|vs\.? /i;
// Nombres con los que el título del video puede mencionar la película
function namesOf(m) {
  const out = new Set();
  [m.t, ...m.alts, m.q].filter(Boolean).forEach((n) => {
    out.add(lw(n));
    out.add(lw(n.replace(/^(the|el|la|los|las)\s+/i, "")));
    const pre = n.split(":")[0];
    if (pre != n && pre.trim().split(/\s+/).length >= 2) out.add(lw(pre));
  });
  return [...out].filter((n) => n.trim().length >= 2);
}
// Duración ISO 8601 ("PT4M13S") a segundos
const isoDur = (d) => {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(d || "") || [];
  return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
};
function ytErr(e) {
  const r = (e.errors && e.errors[0] && e.errors[0].reason) || "";
  if (r == "quotaExceeded" || r == "dailyLimitExceeded")
    return "se agotó la cuota diaria de la API de YouTube (se reinicia cada día; las películas ya vistas siguen funcionando)";
  if (r == "keyInvalid" || /API key not valid/i.test(e.message || ""))
    return "la clave de la API de YouTube no es válida";
  if (
    r == "accessNotConfigured" ||
    /has not been used|is disabled/i.test(e.message || "")
  )
    return "la YouTube Data API v3 no está activada en el proyecto de Google Cloud";
  if (/referer|ipRefererBlocked|forbidden/i.test(r + (e.message || "")))
    return "la clave tiene restricciones que bloquean esta página";
  return "error de la API de YouTube: " + (e.message || r || "desconocido");
}
async function ytApi(path, params) {
  const url = `https://www.googleapis.com/youtube/v3/${path}?${new URLSearchParams({ ...params, key: YT_KEY })}`;
  let r;
  try {
    r = await fetch(url);
  } catch (e) {
    throw new Error("no se pudo conectar con YouTube");
  }
  const d = await r.json().catch(() => ({}));
  if (d.error) throw new Error(ytErr(d.error));
  if (!r.ok) throw new Error("YouTube respondió " + r.status);
  return d;
}
// Busca escenas (no tráileres) de una película. Los resultados se guardan en el navegador para ahorrar cuota.
async function findScenes(m, cat) {
  const ck = "yt:" + norm(m.t) + m.y,
    cached = lsGet(ck);
  if (cached) {
    try {
      const v = JSON.parse(cached);
      if (v.length) return v;
    } catch (e) {}
  }
  const q =
    cat == "espanol" ? `${m.t} ${m.y} escena` : `${m.t} ${m.y} movie scene`;
  const d = await ytApi("search", {
    part: "snippet",
    type: "video",
    videoEmbeddable: "true",
    maxResults: "25",
    q,
  });
  const names = namesOf(m);
  const ids = (d.items || [])
    .filter((it) => {
      const t = decodeHTML(it.snippet.title),
        ch = decodeHTML(it.snippet.channelTitle || "");
      return (
        it.id &&
        it.id.videoId &&
        !BAD_YT.test(t + " " + ch) &&
        it.snippet.liveBroadcastContent == "none" &&
        names.some((n) => lw(t).includes(n))
      );
    })
    .map((it) => it.id.videoId);
  if (!ids.length) {
    lsSet(ck, "[]");
    return [];
  }
  const v = await ytApi("videos", {
    part: "contentDetails,status",
    id: ids.join(","),
  });
  const ok = (v.items || [])
    .filter(
      (x) =>
        x.status &&
        x.status.embeddable !== false &&
        x.status.privacyStatus != "private",
    )
    .map((x) => ({ id: x.id, dur: isoDur(x.contentDetails.duration) }))
    .filter((x) => x.dur >= 40 && x.dur <= 20 * 60);
  const out = shuffle(ok).slice(0, 8);
  lsSet(ck, JSON.stringify(out));
  return out;
}
// Quita una escena que no se pudo reproducir (también de la caché)
export function dropScene(s, id) {
  const ck = "yt:" + norm(s.title) + s.year;
  s.vids = s.vids.filter((v) => v.id != id);
  lsSet(ck, JSON.stringify(s.vids));
}
// Toma la siguiente película del género que tenga escenas disponibles.
// onStatus(texto) sirve para mostrar el progreso en pantalla.
export async function nextMovie(pool, cat, onStatus = () => {}) {
  let tries = 0;
  while (pool.length && tries < 4) {
    const m = pool.shift();
    tries++;
    onStatus("Buscando una escena");
    const vids = await findScenes(m, cat); // los errores de la API (clave, cuota) se muestran directamente
    if (vids.length)
      return {
        title: m.t,
        alts: m.alts,
        actors: m.a,
        artist: m.a.join(" / "),
        year: String(m.y),
        vids,
        genre: "",
      };
  }
  throw new Error(
    pool.length
      ? "se probaron " + tries + " películas y no se encontraron escenas en YouTube"
      : "no quedan películas en este género",
  );
}

// ===== Reproductor =====

// yt: el reproductor (null hasta que esté listo). ytPlaying: si está reproduciendo ahora mismo.
// Quien los importa puede leerlos (siempre ve el valor actual), pero no cambiarlos.
export let yt = null,
  ytPlaying = false;
let ytReadyP = null,
  stage = null;

function stageEl() {
  if (stage) return stage;
  stage = document.createElement("div");
  stage.className = "stage away";
  stage.innerHTML = `<div class="crop"><div id="ytp"></div></div><div class="shield"></div><div class="vcover" id="vcover"></div>`;
  document.body.appendChild(stage);
  return stage;
}
// El reproductor vive fuera de #app (si se moviera, YouTube lo recargaría) y se coloca encima del elemento target.
// Con target nulo se oculta. Devuelve true si quedó visible.
export function placeStage(target) {
  const st = stageEl();
  if (!target) {
    st.classList.add("away");
    return false;
  }
  const r = target.getBoundingClientRect();
  Object.assign(st.style, {
    left: r.left + scrollX + "px",
    top: r.top + scrollY + "px",
    width: r.width + "px",
    height: r.height + "px",
  });
  st.classList.remove("away");
  return true;
}
// Carga el script de la IFrame API de YouTube (una sola vez)
export function loadYT() {
  if (window.YT && YT.Player) return Promise.resolve();
  if (ytReadyP) return ytReadyP;
  return (ytReadyP = new Promise((res, rej) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev && prev();
      res();
    };
    const sc = document.createElement("script");
    sc.src = "https://www.youtube.com/iframe_api";
    sc.onerror = () => {
      ytReadyP = null;
      rej(new Error("no se pudo cargar el reproductor de YouTube"));
    };
    document.head.appendChild(sc);
    setTimeout(() => {
      ytReadyP = null;
      rej(new Error("el reproductor de YouTube no respondió"));
    }, 15000);
  }));
}
// Crea el reproductor si no existe. Eventos:
//  onChange() – cambió el estado (reproduciendo, en pausa, cargando…)
//  onEnded()  – terminó el video
//  onError(código) – error del reproductor (ej. 150/101: no insertable, 152/153: bloqueado en file://)
export function ensurePlayer({ onChange = () => {}, onEnded = () => {}, onError = () => {} } = {}) {
  if (yt && yt.cueVideoById) return Promise.resolve(yt);
  stageEl();
  return new Promise((res, rej) => {
    const pv = {
      controls: 0,
      disablekb: 1,
      rel: 0,
      iv_load_policy: 3,
      playsinline: 1,
      fs: 0,
      modestbranding: 1,
      cc_load_policy: 0,
    };
    if (location.protocol.startsWith("http")) pv.origin = location.origin;
    const p = new YT.Player("ytp", {
      width: "100%",
      height: "100%",
      playerVars: pv,
      events: {
        onReady: () => {
          yt = p;
          res(p);
        },
        onStateChange: (e) => {
          ytPlaying = e.data == YT.PlayerState.PLAYING;
          if (e.data == YT.PlayerState.ENDED) onEnded();
          onChange();
        },
        onError: (e) => onError(e.data),
      },
    });
    setTimeout(
      () => rej(new Error("el reproductor de YouTube no respondió")),
      15000,
    );
  });
}
export function pauseVideo() {
  if (yt && yt.pauseVideo) yt.pauseVideo();
  ytPlaying = false;
}
// Punto de inicio aleatorio para un fragmento de `clip` segundos, evitando el principio y el final del video
export function sceneOff(dur, clip) {
  const lo = Math.max(3, dur * 0.1),
    hi = dur * 0.85 - clip;
  return Math.floor(
    hi > lo
      ? lo + Math.random() * (hi - lo)
      : Math.max(0, Math.min(lo, dur - clip - 1)),
  );
}
