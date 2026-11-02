import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const port = Number(process.env.PORT || 4173);
const root = process.cwd();
const types = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml"
};

http.createServer(async (request, response) => {
  try {
    const relative = decodeURIComponent(request.url.split("?")[0] === "/" ? "/index.html" : request.url.split("?")[0]);
    const file = normalize(join(root, relative));
    if (!file.startsWith(root)) throw new Error("Ruta inválida");
    const body = await readFile(file);
    response.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Archivo no encontrado");
  }
}).listen(port, "127.0.0.1", () => console.log(`KleeneLab disponible en http://127.0.0.1:${port}`));
