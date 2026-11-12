import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const server = readFileSync(join(root, "server.js"), "utf8");
const html = readFileSync(join(root, "public/index.html"), "utf8");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const systems = readFileSync(join(root, "systems.js"), "utf8");
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
runCheck(join(root, "systems.js"));
if (!server.includes("registerWorldSystems") || !server.includes("initWorldSystems")) throw new Error("World systems are not registered and initialized.");
if (!systems.includes("/api/player-market") || !systems.includes("/api/research") || !systems.includes("/api/espionage/launch") || !systems.includes("/api/season")) throw new Error("A major world system route is missing.");
for (const tech of ["industry","energy","agriculture","materials","intelligence","logistics","military","aviation","defense"]) if (!systems.includes(`id:"${tech}"`)) throw new Error("Technology missing: " + tech);
if (!server.includes("attackerTech.military") || !server.includes("attackerTech.aviation") || !server.includes("defenderTech.defense")) throw new Error("Combat technologies are not applied to battle calculations.");
const catalogStart = server.indexOf("const BUILDING_CATALOG = {");
const catalogEnd = server.indexOf("\n};", catalogStart);
const ratesStart = server.indexOf("const BUILDING_RESOURCE_OUTPUTS = ") + "const BUILDING_RESOURCE_OUTPUTS = ".length;
const ratesEnd = server.indexOf(";\nfor", ratesStart);
if (catalogStart < 0 || catalogEnd < 0 || ratesStart < 0 || ratesEnd < 0) throw new Error("Building production catalog is missing.");
const catalogBlock = server.slice(catalogStart, catalogEnd);
const buildingKeys = [...catalogBlock.matchAll(/^\s{2}([a-zA-Z0-9_]+):\\{/gm)].map(x => x[1]);
const resourceRates = JSON.parse(server.slice(ratesStart, ratesEnd));
if (buildingKeys.length !== 45 || buildingKeys.some(key => !resourceRates[key])) throw new Error("Every economy building must have a resource yield.");
if (!server.includes("if(production.energy)energy+=hours*level*Number(production.energy)") || !server.includes("if(production.oil)oil+=hours*active*Number(production.oil)")) throw new Error("Hourly building resource production is not applied.");

if (!server.includes("tech.industry") || !server.includes("tech.agriculture") || !server.includes("tech.materials") || !server.includes("tech.energy")) throw new Error("Economic technologies are not applied to production.");
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
console.log("RADINWAR checks passed: server, systems module, inline scripts, HTML IDs, CSS structure, build version.");
