// Proxy de la API de búsqueda de iTunes para MediaIQ (Cloudflare Worker).
//
// ¿Por qué existe? Cuando la petición viene de un iPhone, Apple suele responder con una
// redirección a la app de Música (musics://…) en lugar de los resultados, y el navegador
// no puede seguirla. Este Worker hace la búsqueda desde Cloudflare, así Apple nunca ve un iPhone.
//
// Este archivo NO lo usa GitHub Pages: se copia y pega en Cloudflare (Workers & Pages → tu Worker → Edit code).

// Sitios que pueden usar este proxy (agrega aquí tu dominio si lo cambias)
const ALLOWED_ORIGINS = [
  "https://andresramirez1969.github.io",
  "http://localhost:8000",
];
// Solo se reenvían estas rutas de la API de iTunes
const ALLOWED_PATHS = ["/search", "/lookup"];
// Tiempo que se guardan las respuestas en la caché de Cloudflare (ahorra peticiones a Apple)
const CACHE_SECONDS = 24 * 60 * 60;

function corsHeaders(origin) {
  const h = { Vary: "Origin" };
  if (ALLOWED_ORIGINS.includes(origin)) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Allow-Methods"] = "GET, OPTIONS";
  }
  return h;
}

function reply(body, status, origin, extra = {}) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(origin),
      ...extra,
    },
  });
}

export default {
  async fetch(request, _env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);

    if (request.method == "OPTIONS")
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (request.method != "GET")
      return reply('{"error":"método no permitido"}', 405, origin);
    if (!ALLOWED_PATHS.includes(url.pathname))
      return reply('{"error":"ruta no permitida"}', 404, origin);

    const target = "https://itunes.apple.com" + url.pathname + url.search;

    // ¿Ya está en caché? (la clave es la URL de Apple, sin importar quién pregunte)
    const cache = caches.default;
    const cacheKey = new Request(target);
    const hit = await cache.match(cacheKey);
    if (hit)
      return reply(hit.body, 200, origin, { "X-Proxy-Cache": "HIT" });

    let r;
    try {
      r = await fetch(target, {
        redirect: "manual",
        headers: {
          // Un navegador de escritorio: así Apple devuelve JSON y no redirige a la app
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
          Accept: "application/json",
        },
      });
    } catch (e) {
      return reply(JSON.stringify({ error: "no se pudo conectar con Apple" }), 502, origin);
    }

    const text = await r.text();
    const json = r.status == 200 && text.trimStart().startsWith("{");
    if (!json)
      // 301 (redirección), 403, 429 (demasiadas peticiones)…: se informa al juego con el código de Apple
      return reply(JSON.stringify({ error: "Apple respondió " + r.status }), 502, origin);

    // Guardar en caché sin hacer esperar al jugador
    ctx.waitUntil(
      cache.put(
        cacheKey,
        new Response(text, {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "public, max-age=" + CACHE_SECONDS,
          },
        }),
      ),
    );
    return reply(text, 200, origin, { "X-Proxy-Cache": "MISS" });
  },
};
