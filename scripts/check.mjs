import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const server = readFileSync(join(root, "server.js"), "utf8");
const html = readFileSync(join(root, "public/index.html"), "utf8");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = server.match(/BUILD_VERSION\s*=\s*['"]([^'"]+)['"]/);
if (!version || !html.includes(version[1])) throw new Error("Client/server build versions do not match.");
if (!server.includes('app.get("/health"') || !server.includes('const asyncRoute =')) throw new Error("Required health or async error handling is missing.");
const staticHtml = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
const ids = [...staticHtml.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
if (duplicates.length) throw new Error("Duplicate static HTML IDs: " + duplicates.join(", "));
const css = html.match(/<style>([\s\S]*?)<\/style>/i)?.[1] || "";
if ((css.match(/{/g) || []).length !== (css.match(/}/g) || []).length) throw new Error("CSS braces are unbalanced.");
const runCheck = (file) => {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "Syntax check failed: " + file);
};
runCheck(join(root, "server.js"));
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]).filter(code => code.trim());
const temp = mkdtempSync(join(tmpdir(), "radinwar-check-"));
try {
  scripts.forEach((code, index) => {
    const file = join(temp, "inline-" + index + ".js");
    writeFileSync(file, code, "utf8");
    runCheck(file);
  });
} finally {
  rmSync(temp, { recursive: true, force: true });
}
if (!pkg.scripts?.start || !pkg.scripts?.test) throw new Error("Required npm scripts are missing.");
console.log("RADINWAR checks passed: server, inline scripts, HTML IDs, CSS structure, build version.");
