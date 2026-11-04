// Utilidades compartidas entre módulos

// Normaliza un texto para comparar: minúsculas, sin acentos, sin "The" inicial, sin espacios ni signos
export const norm = (s) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/^the /, "")
    .replace(/[^a-z0-9]/g, "");

// Devuelve una copia del arreglo en orden aleatorio
export const shuffle = (a) => {
  a = [...a];
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
