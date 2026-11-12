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
if (!server.includes("Object.assign(item.production, BUILDING_RESOURCE_OUTPUTS[key] || {})") || !server.includes('"gasfield":{"oil":300}') || !server.includes('"lithium":{"steel":160}') || !server.includes('"greenhouse":{"food":180}') || !server.includes('"nuclear":{"energy":200}')) throw new Error("Economy building yields are missing or not connected to production.");
if (!server.includes("if(production.energy)energy+=hours*level*Number(production.energy)") || !server.includes("if(production.oil)oil+=hours*active*Number(production.oil)")) throw new Error("Minute-rate building resource production is not applied.");
if (!server.includes("daily_reward_claims") || !server.includes("/api/daily-reward") || !server.includes("promo_redemptions") || !server.includes("/api/codes/redeem") || !server.includes("/api/owner/codes")) throw new Error("Daily rewards or secret promo-code APIs are missing.");
if (!server.includes('item.production[field]=Number(item.production[field])*60') || !server.includes('+" "+label+"/دقیقه"')) throw new Error("Building outputs are not converted to per-minute rates.");
if (!server.includes('["coins","energy","oil","steel","food"]') || !server.includes('+" برق مصرفی/ساعت"')) throw new Error("Hourly power consumption must remain separate from minute-based output.");
if (!html.includes("dailyRewardBtn") || !html.includes("redeemCodeBtn") || !html.includes("ownerCreatePromoBtn")) throw new Error("Daily reward or promo-code UI is missing.");

if (!server.includes("tech.industry") || !server.includes("tech.agriculture") || !server.includes("tech.materials") || !server.includes("tech.energy")) throw new Error("Economic technologies are not applied to production.");
if (!server.includes("const coinIncomePerSecond=300;") || !server.includes("let coins=seconds*coinIncomePerSecond") || !server.includes("production_at=production_at+($7::int * INTERVAL '1 second')")) throw new Error("Base income must accrue 300 coins for every elapsed second.");
if (!html.includes("درآمد هر ثانیه:") || !html.includes("shopBigIntValue(value)")) throw new Error("Per-second income label or decimal-safe balance display is missing.");
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

if (!server.includes("let buildingCoinIncome=0") || !server.includes("coins+=Math.floor(buildingCoinIncome*industryBoost)") || !server.includes("const minutes=seconds/60")) throw new Error("Building income is not accrued using displayed per-minute rates.");
if (!server.includes('agriculturecenter:{name:"مرکز کشاورزی"') || !server.includes('technologycenter:{name:"مرکز فناوری"') || !server.includes('factory:{name:"کارخانه صنعتی"')) throw new Error("Agriculture, technology, or factory buildings are missing.");
if (!server.includes('toFixed(6)') || !server.includes('درآمد مستقیم پول')) throw new Error("Resource fractions or direct income labels are missing.");
if (!server.includes('/api/commanders/dismiss') || !server.includes('autoActivated:player.rows[0].active_commander_id==null')) throw new Error("Commander dismissal or first-hire activation is missing.");
if (!server.includes('Math.ceil(baseOperationCost*(1-attackerLogistics))') || !server.includes('nextBonusPercent')) throw new Error("Commander logistics discount or next-level preview is missing.");
if (!server.includes('xp>=level*100') && !server.includes('xp+25>=level*100')) throw new Error("Commander battle XP progression is missing.");
if (!html.includes('data-commander-dismiss') || !html.includes('box.querySelectorAll(".commander-art img")') || !html.includes('fallback.style.display="grid"')) throw new Error("Commander image fallback or dismissal UI is missing.");
if (!server.includes('attackerAirBonus') || !server.includes('attackerLogistics') || !server.includes('defenderLogistics') || !server.includes('تجربه فرمانده مهاجم')) throw new Error("Commander battle bonuses or XP report are missing.");
if (!server.includes("CREATE TABLE IF NOT EXISTS player_commanders") || !server.includes('/api/commanders/hire') || !server.includes('/api/commanders/upgrade') || !server.includes('/api/commanders/active')) throw new Error("Commander database or management APIs are missing.");
if (!server.includes("attackerAttackBonus") || !server.includes("defenderDefenseBonus") || !server.includes("operationOilCost") || !server.includes("player_commanders SET xp=xp+")) throw new Error("Commander bonuses, battle costs, or XP are not applied.");
if (!html.includes('id="commanderGrid"') || !html.includes('data-commander-hire') || !html.includes('data-commander-upgrade') || !html.includes('id="battleCommanderInfo"')) throw new Error("Commander academy or battle UI is missing.");

console.log("RADINWAR checks passed: server, systems module, inline scripts, HTML IDs, CSS structure, build version.");
