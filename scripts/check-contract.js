// Checks that every API call and live event in the mobile app has a matching route or handler here.
//   node scripts/check-contract.js ../caliphate-rides
// Exit code 1 if something the app uses is missing.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const appDir = resolve(process.argv[2] ?? "../caliphate-rides");
const here = resolve(import.meta.dirname, "..");

const walk = (dir, exts, out = []) => {
  for (const f of readdirSync(dir)) {
    if (f === "node_modules" || f.startsWith(".")) continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, exts, out);
    else if (exts.some((e) => p.endsWith(e))) out.push(p);
  }
  return out;
};

// ---- server routes: mount prefix from app.js + router.METHOD("path") in each route file ----
const appJs = readFileSync(join(here, "src/app.js"), "utf8");
const mounts = {};
for (const m of appJs.matchAll(/app\.use\("([^"]*)",\s*(\w+Router)\)/g)) mounts[m[2]] = m[1] === "/" ? "" : m[1];

const routes = [];
for (const file of walk(join(here, "src/routes"), [".js"])) {
  const src = readFileSync(file, "utf8");
  const name = src.match(/export const (\w+Router)/)?.[1];
  if (!name || mounts[name] === undefined) continue;
  for (const m of src.matchAll(/\w+Router\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g)) {
    routes.push({ method: m[1].toUpperCase(), path: mounts[name] + (m[2] === "/" ? "" : m[2]) });
  }
}
const toRegex = (p) => new RegExp(`^${p.replace(/:[A-Za-z]+/g, "[^/]+")}$`);
const routeExists = (method, path) => routes.some((r) => r.method === method && toRegex(r.path).test(path));

// ---- app calls: api("/path", { method }) and fetch(`${ENV.apiUrl}/path`, { method }) ----
const appFiles = walk(join(appDir, "src"), [".ts", ".tsx"]);
const calls = [];
for (const file of appFiles) {
  const src = readFileSync(file, "utf8");
  const patterns = [
    /\bapi(?:<[^>]*(?:<[^>]*>[^>]*)*>)?\(\s*(["`])([^"`]+)\1(?:,\s*\{([^}]*))?/g,
    /fetch\(\s*`\$\{ENV\.apiUrl\}([^`]+)`(?:,\s*\{([^}]*))?/g,
  ];
  for (const [i, rx] of patterns.entries()) {
    for (const m of src.matchAll(rx)) {
      const raw = i === 0 ? m[2] : m[1];
      const opts = (i === 0 ? m[3] : m[2]) ?? "";
      const method = opts.match(/method:\s*"([A-Z]+)"/)?.[1] ?? "GET";
      // `${id}` → x; `${ep}` where ep is one of several values is expanded below.
      if (!raw.startsWith("/")) continue; // the api() helper itself
      calls.push({ file: file.slice(appDir.length + 1), method, raw });
    }
  }
}

// Template parts that pick between endpoints: look up the object literal of names in the same file.
const expand = (call) => {
  const dyn = [...call.raw.matchAll(/\$\{(\w+)\}/g)].map((m) => m[1]);
  let paths = [call.raw];
  for (const v of dyn) {
    if (v === "ep") {
      const src = readFileSync(join(appDir, call.file), "utf8");
      const values = [...(src.match(/STAGE_ENDPOINT[^=]*=\s*\{([^}]*)\}/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
      paths = paths.flatMap((p) => values.map((x) => p.replace("${ep}", x)));
    } else {
      paths = paths.map((p) => p.replace(new RegExp(`\\$\\{${v}(\\.\\w+)*\\}`), "ID"));
    }
  }
  return paths.map((p) => p.replace(/\$\{[^}]+\}/g, "ID").split("?")[0]);
};

let missing = 0;
console.log(`Server routes: ${routes.length}. App calls: ${calls.length}.\n`);
for (const c of calls) {
  for (const path of expand(c)) {
    const ok = routeExists(c.method, path);
    if (!ok) missing++;
    console.log(`${ok ? "ok     " : "MISSING"} ${c.method.padEnd(6)} ${path.padEnd(42)} (${c.file})`);
  }
}

// ---- live events ----
const serverSrc = walk(join(here, "src"), [".js"]).map((f) => readFileSync(f, "utf8")).join("\n");
const handled = new Set([...serverSrc.matchAll(/socket\.on\("([^"]+)"/g)].map((m) => m[1]));
const sent = new Set([...serverSrc.matchAll(/(?:emitTo\([^,]+,|socket\.emit\()\s*"([^"]+)"/g)].map((m) => m[1]));
const appSrc = appFiles.map((f) => readFileSync(f, "utf8")).join("\n");
const appEmits = new Set([...appSrc.matchAll(/\.emit\("([a-z]+:[a-z]+)"/g)].map((m) => m[1]));
const appListens = new Set([...appSrc.matchAll(/\.on\("([a-z]+:[a-z]+)"/g)].map((m) => m[1]));
console.log("");
for (const e of appEmits) {
  if (!handled.has(e)) missing++;
  console.log(`${handled.has(e) ? "ok     " : "MISSING"} app sends   ${e}`);
}
for (const e of appListens) {
  if (!sent.has(e)) missing++;
  console.log(`${sent.has(e) ? "ok     " : "MISSING"} app expects ${e}`);
}
for (const e of sent) if (!appListens.has(e)) console.log(`note    server sends ${e}, which the app doesn't listen for yet`);

console.log(missing ? `\n${missing} missing.` : "\nEverything the app uses is here.");
process.exit(missing ? 1 : 0);
