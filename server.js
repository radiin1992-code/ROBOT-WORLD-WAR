import express from "express";
import pg from "pg";
import crypto from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const worldTopology = require("world-atlas/countries-110m.json");
const topojson = require("topojson-client");
const isoCountries = require("i18n-iso-countries");
const localWorldGeoJSON = (() => { const collection = topojson.feature(worldTopology, worldTopology.objects.countries); return { type: "FeatureCollection", features: collection.features.map(f => { const a3 = isoCountries.numericToAlpha3(String(f.id).padStart(3, "0")); const a2 = isoCountries.numericToAlpha2(String(f.id).padStart(3, "0")); return { ...f, properties: { ...f.properties, ADMIN: f.properties?.name || "Unknown", ISO_A3: a3 || "", ISO_A2: a2 || "" } }; }).filter(f => /^[A-Z]{3}$/.test(f.properties.ISO_A3)) }; })();

let mapTextureCache=null;
const { Pool } = pg;
const app = express();
app.use(express.json({ limit: "7mb" }));
app.use(express.static("public",{setHeaders(res,filePath){if(filePath.endsWith(".html"))res.setHeader("Cache-Control","no-store, no-cache, must-revalidate");}}));
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : undefined, max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 });
const OWNER_ID = "1852348620";
const OWNER_IDS = new Set([OWNER_ID, "8881463089"]);
const BUILD_VERSION='rw-20261112-10';
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const PUBLIC_URL = process.env.RENDER_EXTERNAL_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? "https://" + process.env.RAILWAY_PUBLIC_DOMAIN : "");
const MINI_APP_URL = process.env.MINI_APP_URL || PUBLIC_URL;
const WEBHOOK_SECRET = /^[A-Za-z0-9_-]{1,256}$/.test(process.env.TELEGRAM_WEBHOOK_SECRET || "") ? process.env.TELEGRAM_WEBHOOK_SECRET : crypto.randomBytes(32).toString("hex");
const APP_LINK = (view, extra={}) => { const u=new URL(MINI_APP_URL);u.searchParams.set("view",view);for(const [k,v] of Object.entries(extra))u.searchParams.set(k,String(v));return u.toString(); };
async function notifyPlayer(id,message,view,extra={}) { const q=await pool.query("SELECT chat_id FROM players WHERE telegram_id=$1 AND chat_id IS NOT NULL",[String(id)]); if(!q.rowCount)return; await telegramApi("sendMessage",{chat_id:q.rows[0].chat_id,text:message,reply_markup:{inline_keyboard:[[{text:"📄 نمایش گزارش",web_app:{url:APP_LINK(view,extra)}}]]}}); }
async function publishWorldEvent(message,view="market",extra={}) { const q=await pool.query("INSERT INTO world_news(message) VALUES($1) RETURNING id",[message]); const id=q.rows[0].id; const users=await pool.query("SELECT chat_id FROM players WHERE chat_id IS NOT NULL"); await Promise.allSettled(users.rows.map(p=>telegramApi("sendMessage",{chat_id:p.chat_id,text:"📡 رویداد داخل بازی\n\n"+message,reply_markup:{inline_keyboard:[[{text:"📄 نمایش گزارش",web_app:{url:APP_LINK(view,{...extra,report:extra.report||id,news:id})}}]]}}))); return id; }

async function telegramApi(method, payload) {
  if (!BOT_TOKEN) return { ok: false, description: "BOT_TOKEN is not configured" };
  const response = await fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/" + method, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(() => ({ ok: false, description: "Invalid Telegram response" }));
  if (!response.ok || !result.ok) console.error("Telegram setup failed:", method, result.description || response.status);
  return result;
}
async function configureTelegramBot() {
  if (!BOT_TOKEN || !MINI_APP_URL || !MINI_APP_URL.startsWith("https://")) {
    console.error("Telegram setup skipped: BOT_TOKEN or HTTPS MINI_APP_URL is missing");
    return;
  }
  // Profile text is configured once in BotFather. Avoid repeating Telegram profile writes on every restart.
  await Promise.allSettled([
    telegramApi("setMyCommands", { commands: [
      { command: "start", description: "شروع بازی و ورود به نقشه جهان" },
      { command: "game", description: "نمایش دکمه ورود به بازی" },
      { command: "help", description: "راهنمای بازی و دستورها" },
      { command: "about", description: "درباره radinwar💥" }
    ]}),
    telegramApi("setChatMenuButton", { menu_button: { type: "web_app", text: "🎮 Play", web_app: { url: MINI_APP_URL } } }),
    telegramApi("setWebhook", {
      url: PUBLIC_URL + "/telegram/webhook",
      allowed_updates: ["message"],
      ...(WEBHOOK_SECRET ? { secret_token: WEBHOOK_SECRET } : {})
    })
  ]);
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      telegram_id BIGINT PRIMARY KEY, username TEXT DEFAULT '', first_name TEXT DEFAULT 'Commander', chat_id BIGINT,
      coins BIGINT NOT NULL DEFAULT 10000, level INT NOT NULL DEFAULT 1,
      country_code TEXT UNIQUE, country_name TEXT, country_flag TEXT DEFAULT '',
      oil BIGINT NOT NULL DEFAULT 300, steel BIGINT NOT NULL DEFAULT 500,
      food BIGINT NOT NULL DEFAULT 900, energy BIGINT NOT NULL DEFAULT 400,
      technology INT NOT NULL DEFAULT 1, industry INT NOT NULL DEFAULT 1, energy_level INT NOT NULL DEFAULT 1,
      agriculture INT NOT NULL DEFAULT 1, approval INT NOT NULL DEFAULT 75,
      wins INT NOT NULL DEFAULT 0, losses INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS world_news (
      id BIGSERIAL PRIMARY KEY, message TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS admin_logs (
      id BIGSERIAL PRIMARY KEY, owner_id BIGINT NOT NULL, target_id BIGINT,
      action TEXT NOT NULL, details JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id BIGSERIAL PRIMARY KEY, telegram_id BIGINT NOT NULL, kind TEXT NOT NULL,
      resource TEXT NOT NULL, amount NUMERIC NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS upgrades (
      telegram_id BIGINT NOT NULL, kind TEXT NOT NULL, level INT NOT NULL DEFAULT 1,
      PRIMARY KEY (telegram_id, kind)
    );
    CREATE TABLE IF NOT EXISTS military_units (
      telegram_id BIGINT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE,
      unit_type TEXT NOT NULL, quantity BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY(telegram_id,unit_type)
    );
    CREATE TABLE IF NOT EXISTS custom_unit_catalog (
      unit_type TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, category_name TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT '🧩', image_url TEXT NOT NULL, quantity BIGINT NOT NULL DEFAULT 1,
      coins BIGINT NOT NULL DEFAULT 0, steel BIGINT NOT NULL DEFAULT 0, food BIGINT NOT NULL DEFAULT 0,
      energy BIGINT NOT NULL DEFAULT 0, oil BIGINT NOT NULL DEFAULT 0, power BIGINT NOT NULL DEFAULT 1,
      created_by BIGINT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE custom_unit_catalog ADD COLUMN IF NOT EXISTS game_attack INT NOT NULL DEFAULT 0;
    ALTER TABLE custom_unit_catalog ADD COLUMN IF NOT EXISTS game_defense INT NOT NULL DEFAULT 0;
    ALTER TABLE custom_unit_catalog ADD COLUMN IF NOT EXISTS game_capacity INT NOT NULL DEFAULT 0;
    ALTER TABLE custom_unit_catalog ADD COLUMN IF NOT EXISTS game_operation_cost INT NOT NULL DEFAULT 0;
    ALTER TABLE custom_unit_catalog ADD COLUMN IF NOT EXISTS game_cooldown INT NOT NULL DEFAULT 0;
    CREATE TABLE IF NOT EXISTS unit_catalog_images (
      unit_type TEXT PRIMARY KEY, image_url TEXT NOT NULL, updated_by BIGINT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS national_buildings (
      telegram_id BIGINT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE,
      building_type TEXT NOT NULL, level INT NOT NULL DEFAULT 0,
      PRIMARY KEY(telegram_id,building_type)
    );
    CREATE TABLE IF NOT EXISTS diplomacy (
      id BIGSERIAL PRIMARY KEY,
      from_id BIGINT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE,
      to_id BIGINT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('alliance','war')),
      status TEXT NOT NULL CHECK(status IN ('pending','active','rejected','ended')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK(from_id<>to_id)
    );
    CREATE INDEX IF NOT EXISTS diplomacy_players_idx ON diplomacy(from_id,to_id,status);
    CREATE INDEX IF NOT EXISTS diplomacy_target_idx ON diplomacy(to_id,status);
    CREATE TABLE IF NOT EXISTS battle_reports (
      id BIGSERIAL PRIMARY KEY, attacker_id BIGINT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE,
      defender_id BIGINT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE,
      diplomacy_id BIGINT NOT NULL REFERENCES diplomacy(id) ON DELETE CASCADE, winner_id BIGINT NOT NULL,
      attacker_power NUMERIC NOT NULL, defender_power NUMERIC NOT NULL,
      attacker_losses JSONB NOT NULL DEFAULT '{}'::jsonb, defender_losses JSONB NOT NULL DEFAULT '{}'::jsonb,
      summary TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS battle_reports_players_idx ON battle_reports(attacker_id,defender_id,id DESC);
    ALTER TABLE battle_reports ADD COLUMN IF NOT EXISTS loot JSONB NOT NULL DEFAULT '{}'::jsonb;


  `);
  for (const [key,name,category,categoryName,icon,quantity,coins,steel,food,energy,oil,power,attack,defense,capacity,cooldown] of UNIT_DATABASE) {
    await pool.query("INSERT INTO custom_unit_catalog(unit_type,name,category,category_name,icon,image_url,quantity,coins,steel,food,energy,oil,power,created_by,game_attack,game_defense,game_capacity,game_operation_cost,game_cooldown) VALUES($1,$2,$3,$4,$5,'',$6,$7,$8,$9,$10,$11,$12,0,$13,$14,$15,$16,$17) ON CONFLICT(unit_type) DO NOTHING",["catalog_"+key,name,category,categoryName,icon,quantity,coins,steel,food,energy,oil,power,attack,defense,capacity,Math.max(1,Math.round(power/80)),cooldown]);
  }
  await pool.query("DELETE FROM military_units WHERE left(unit_type,6)='asset_'");
  await pool.query("ALTER TABLE players ADD COLUMN IF NOT EXISTS energy_level INT NOT NULL DEFAULT 1");
  await pool.query("ALTER TABLE players ADD COLUMN IF NOT EXISTS shop_cooldown_until TIMESTAMPTZ");
  await pool.query("ALTER TABLE players ADD COLUMN IF NOT EXISTS chat_id BIGINT");
  await pool.query("ALTER TABLE players ADD COLUMN IF NOT EXISTS country_flag TEXT");
  await pool.query("ALTER TABLE players ADD COLUMN IF NOT EXISTS production_at TIMESTAMPTZ NOT NULL DEFAULT NOW()");
  await pool.query("ALTER TABLE players ADD COLUMN IF NOT EXISTS shop_income BIGINT NOT NULL DEFAULT 0");
  await pool.query("ALTER TABLE transactions ALTER COLUMN amount TYPE NUMERIC USING amount::numeric");
  await pool.query(`ALTER TABLE players
    ALTER COLUMN coins TYPE NUMERIC USING coins::numeric,
    ALTER COLUMN oil TYPE NUMERIC USING oil::numeric,
    ALTER COLUMN steel TYPE NUMERIC USING steel::numeric,
    ALTER COLUMN food TYPE NUMERIC USING food::numeric,
    ALTER COLUMN energy TYPE NUMERIC USING energy::numeric,
    ALTER COLUMN shop_income TYPE NUMERIC USING shop_income::numeric,
    ALTER COLUMN industry TYPE NUMERIC USING industry::numeric,
    ALTER COLUMN agriculture TYPE NUMERIC USING agriculture::numeric,
    ALTER COLUMN technology TYPE NUMERIC USING technology::numeric`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_groups (
      id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, owner_id BIGINT NOT NULL REFERENCES players(telegram_id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS group_members (
      group_id BIGINT NOT NULL REFERENCES game_groups(id) ON DELETE CASCADE,
      telegram_id BIGINT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(group_id,telegram_id)
    );
    CREATE TABLE IF NOT EXISTS group_admins (
      group_id BIGINT NOT NULL REFERENCES game_groups(id) ON DELETE CASCADE,
      telegram_id BIGINT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE,
      promoted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(group_id,telegram_id)
    );
    CREATE TABLE IF NOT EXISTS group_messages (
      id BIGSERIAL PRIMARY KEY, group_id BIGINT NOT NULL REFERENCES game_groups(id) ON DELETE CASCADE,
      telegram_id BIGINT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE,
      body TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS direct_messages (
      id BIGSERIAL PRIMARY KEY, sender_id BIGINT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE,
      receiver_id BIGINT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE,
      body TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS announcements (
      id BIGSERIAL PRIMARY KEY, telegram_id BIGINT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE,
      caption TEXT NOT NULL DEFAULT '', image_data TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS group_invitations (
      id BIGSERIAL PRIMARY KEY,
      group_id BIGINT NOT NULL REFERENCES game_groups(id) ON DELETE CASCADE,
      telegram_id BIGINT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE,
      invited_by BIGINT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      responded_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS group_invitations_inbox_idx ON group_invitations(telegram_id,status,created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS group_invitations_pending_unique_idx ON group_invitations(group_id,telegram_id) WHERE status='pending';
    CREATE INDEX IF NOT EXISTS group_messages_group_id_id_idx ON group_messages(group_id,id);
    CREATE INDEX IF NOT EXISTS direct_messages_pair_idx ON direct_messages(sender_id,receiver_id,id);
    CREATE INDEX IF NOT EXISTS announcements_id_idx ON announcements(id DESC);
  `);
  await pool.query("CREATE TABLE IF NOT EXISTS game_settings (setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL DEFAULT '')");
  const economyReset=await pool.query("INSERT INTO game_settings(setting_key,setting_value) VALUES('economy_reset_20261112','done') ON CONFLICT(setting_key) DO NOTHING RETURNING setting_key");
  if(economyReset.rowCount) await pool.query("UPDATE players SET coins=10000,shop_income=0,production_at=NOW(),updated_at=NOW()");
  await pool.query("ALTER TABLE players ALTER COLUMN coins SET DEFAULT 10000");
  await pool.query("ALTER TABLE players ALTER COLUMN oil SET DEFAULT 0, ALTER COLUMN steel SET DEFAULT 0, ALTER COLUMN food SET DEFAULT 0, ALTER COLUMN energy SET DEFAULT 0");
  await pool.query("UPDATE players SET oil=0,steel=0,food=0,energy=0 WHERE country_code IS NULL");

  const n = await pool.query("SELECT COUNT(*)::int AS n FROM world_news");
  if (!n.rows[0].n) await pool.query("INSERT INTO world_news(message) VALUES ($1),($2),($3)", ["شبکه جهانی radinwar💥 راه‌اندازی شد.", "بازار جهانی آماده معامله است.", "فرماندهان جدید می‌توانند کشور خود را انتخاب کنند."]);
  const updateNotice=await pool.query("INSERT INTO game_settings(setting_key,setting_value) VALUES('game_update_notice_20261112_v1','sent') ON CONFLICT(setting_key) DO NOTHING RETURNING setting_key");
  if(updateNotice.rowCount) await publishWorldEvent("📢 بازی آپدیت شد!\n\n💰 موجودی همه فرمانده‌ها روی ۱۰٬۰۰۰ پول تنظیم شد و درآمد پایه به ۳۰۰ پول در دقیقه تغییر کرد.\n🔄 اگر داخل بازی هستی، مینی‌اپ به‌صورت خودکار فقط یک‌بار ریلود می‌شود. اگر ریلود خودکار انجام نشد، یک‌بار صفحه را تازه کن.");
}
function safeEqual(a,b){const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb)}
function verifyInitData(initData) {
  if (!BOT_TOKEN || !initData) return null;
  const params = new URLSearchParams(initData), hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const authDate = Number(params.get("auth_date"));
  if (!authDate || Math.abs(Date.now()/1000-authDate)>86400) return null;
  const dataCheck = [...params.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+"="+v).join("\n");
  const secret = crypto.createHmac("sha256","WebAppData").update(BOT_TOKEN).digest();
  const calculated = crypto.createHmac("sha256",secret).update(dataCheck).digest("hex");
  if (!safeEqual(calculated,hash)) return null;
  try { return JSON.parse(params.get("user") || "null"); } catch { return null; }
}
async function auth(req,res,next) {
  const user = verifyInitData(req.get("x-telegram-init-data") || "");
  if (!user?.id) return res.status(401).json({ok:false,error:"برای ورود، بازی را از داخل ربات تلگرام باز کن."});
  req.user = user; next();
}
async function ensurePlayer(user) {
  await pool.query(`INSERT INTO players(telegram_id,username,first_name,chat_id) VALUES($1,$2,$3,$1)
    ON CONFLICT(telegram_id) DO UPDATE SET username=EXCLUDED.username,first_name=EXCLUDED.first_name,chat_id=COALESCE(players.chat_id,EXCLUDED.chat_id),updated_at=NOW()`,
    [String(user.id),user.username||"",user.first_name||"Commander"]);
}
app.get("/api/version",(_req,res)=>res.set("Cache-Control","no-store, max-age=0").json({ok:true,version:BUILD_VERSION}));
app.get("/health", async (_req,res)=>{ try { await pool.query("SELECT 1"); res.status(200).json({ok:true,service:"robot-world-war",database:"connected"}); } catch { res.status(503).json({ok:false,service:"robot-world-war",database:"disconnected"}); } });
app.get("/api/profile",auth,async(req,res)=>{
  await ensurePlayer(req.user);
  await applyProduction(req.user.id);
  const q=await pool.query("SELECT * FROM players WHERE telegram_id=$1",[String(req.user.id)]);
  const p=q.rows[0];
  const [military,customPowers]=await Promise.all([pool.query("SELECT unit_type,quantity FROM military_units WHERE telegram_id=$1",[String(req.user.id)]),pool.query("SELECT unit_type,power FROM custom_unit_catalog")]);
  const powerByType=Object.fromEntries(customPowers.rows.map(x=>[x.unit_type,Number(x.power)]));
  p.military_power=military.rows.reduce((sum,row)=>sum+Number(row.quantity||0)*Number(UNIT_CATALOG[row.unit_type]?.power??powerByType[row.unit_type]??0),0);
  const ownedBuildings=await pool.query("SELECT building_type,level FROM national_buildings WHERE telegram_id=$1",[String(req.user.id)]);
  const buildingIncome=ownedBuildings.rows.reduce((sum,row)=>sum+Number(row.level||0)*Number(BUILDING_CATALOG[row.building_type]?.production?.coins||0),0);
  p.income=300+Math.round(buildingIncome/60);p.gdp=Number(p.coins)*4;p.population=0;
  res.json({ok:true,profile:p});
});
app.get("/api/treasury",auth,async(req,res)=>{await applyProduction(req.user.id);const q=await pool.query("SELECT coins,country_code,industry,agriculture,level,shop_income FROM players WHERE telegram_id=$1",[String(req.user.id)]);if(!q.rowCount)return res.status(404).json({ok:false});const p=q.rows[0];const b=await pool.query("SELECT building_type,level FROM national_buildings WHERE telegram_id=$1",[String(req.user.id)]);const buildingIncome=b.rows.reduce((sum,row)=>sum+Number(row.level||0)*Number(BUILDING_CATALOG[row.building_type]?.production?.coins||0),0);const income=300;res.json({ok:true,coins:p.coins,income});});
app.get("/api/news",auth,async(_req,res)=>{const q=await pool.query("SELECT id,message,created_at FROM world_news ORDER BY id DESC LIMIT 60");res.json({ok:true,items:q.rows});});
const mapGeoCache=localWorldGeoJSON;
app.get("/api/map-data",(_req,res)=>res.set("Cache-Control","public, max-age=86400").json(mapGeoCache));
app.get("/api/map-texture",async(_req,res)=>{try{if(mapTextureCache)return res.type("image/jpeg").set("Cache-Control","public,max-age=604800").send(mapTextureCache);for(const url of ["https://cdn.jsdelivr.net/npm/three-globe@2.45.0/example/img/earth-blue-marble.jpg","https://unpkg.com/three-globe@2.45.0/example/img/earth-blue-marble.jpg"]){try{const r=await fetch(url,{signal:AbortSignal.timeout(12000)});if(!r.ok)continue;const b=Buffer.from(await r.arrayBuffer());if(b.length<10000)continue;mapTextureCache=b;return res.type("image/jpeg").set("Cache-Control","public,max-age=604800").send(b)}catch{}}res.status(503).end()}catch{res.status(503).end()}});
app.get("/api/world",auth,async(_req,res)=>{
  const [claims,news]=await Promise.all([pool.query("SELECT country_code,telegram_id,country_name FROM players WHERE country_code IS NOT NULL"),pool.query("SELECT id,message FROM world_news ORDER BY id DESC LIMIT 40")]);
  const claimed={};for(const r of claims.rows)claimed[r.country_code]=r.country_name;
  res.json({ok:true,claimed,news:news.rows});
});
app.post("/api/select-country",auth,async(req,res)=>{
  const {code,name,flag}=req.body||{};
  if(!/^[A-Z]{3}$/.test(code||"")||typeof name!=="string"||name.length>90||(flag&&!/^[A-Z]{2}$/.test(flag)))return res.status(400).json({ok:false,error:"کشور معتبر نیست"});
  const client=await pool.connect();
  try{await client.query("BEGIN");const own=await client.query("SELECT country_code FROM players WHERE telegram_id=$1 FOR UPDATE",[String(req.user.id)]);
    if(own.rows[0]?.country_code){await client.query("ROLLBACK");return res.status(409).json({ok:false,error:"شما قبلاً کشور انتخاب کرده‌ای."});}
    const taken=await client.query("SELECT telegram_id FROM players WHERE country_code=$1",[code]);
    if(taken.rowCount){await client.query("ROLLBACK");return res.status(409).json({ok:false,error:"این کشور قبلاً انتخاب شده است."});}
    await client.query("UPDATE players SET country_code=$1,country_name=$2,country_flag=$3,updated_at=NOW() WHERE telegram_id=$4",[code,name,flag||null,String(req.user.id)]);
    await client.query("COMMIT");await publishWorldEvent("📣 "+(flag?String.fromCodePoint(127397+flag.charCodeAt(0),127397+flag.charCodeAt(1))+" ":"🌍 ")+name+" کشور خود را وارد رقابت جهانی کرد.");res.json({ok:true});
  }catch(e){await client.query("ROLLBACK");if(e.code==="23505")return res.status(409).json({ok:false,error:"این کشور همین الان توسط فرمانده دیگری انتخاب شد. یک کشور آزاد دیگر انتخاب کن."});throw e}finally{client.release()}
});
app.post("/api/upgrade",auth,async(req,res)=>{
  const {kind}=req.body||{}, costs={industry:{coins:900,steel:120},energy:{coins:750,oil:80},technology:{coins:1500,steel:180},agriculture:{coins:650,food:100}};
  if(!costs[kind])return res.status(400).json({ok:false,error:"ارتقای نامعتبر"});
  const c=costs[kind];
  const upgradeColumn=kind==="energy"?"energy_level":kind;
  const resourceCost=Object.entries(c).filter(([k])=>k!=="coins");
  const sets=[`coins=coins-$1`,`${upgradeColumn}=${upgradeColumn}+1`];
  const guards=[`coins >= $1`];
  const values=[c.coins,String(req.user.id)];
  for (const [resource,amount] of resourceCost) { values.push(amount); sets.push(`${resource}=${resource}-$${values.length}`); guards.push(`${resource} >= $${values.length}`); }
  const q=await pool.query(`UPDATE players SET ${sets.join(",")},updated_at=NOW() WHERE telegram_id=$2 AND ${guards.join(" AND ")} RETURNING telegram_id`,values);
  if(!q.rowCount)return res.status(400).json({ok:false,error:"منابع کافی نیست"});
  res.json({ok:true});
});
async function ownerOnly(req,res,next){if(!OWNER_IDS.has(String(req.user.id)))return res.status(403).json({ok:false,error:"دسترسی غیرمجاز"});next()}
app.post("/api/owner/unit-catalog/:type/image",auth,ownerOnly,async(req,res)=>{
  const type=String(req.params.type||""),imageUrl=String(req.body?.imageUrl||"").trim();
  const validImage=/^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+/=]+$/.test(imageUrl)||/^https:\/\//i.test(imageUrl);
  if(!validImage||imageUrl.length>2200000)return res.status(400).json({ok:false,error:"عکس معتبر نیست یا حجمش زیاد است."});
  if(UNIT_CATALOG[type]){
    await pool.query("INSERT INTO unit_catalog_images(unit_type,image_url,updated_by) VALUES($1,$2,$3) ON CONFLICT(unit_type) DO UPDATE SET image_url=EXCLUDED.image_url,updated_by=EXCLUDED.updated_by,updated_at=NOW()",[type,imageUrl,String(req.user.id)]);
    return res.json({ok:true});
  }
  const q=await pool.query("UPDATE custom_unit_catalog SET image_url=$1 WHERE unit_type=$2 RETURNING name",[imageUrl,type]);
  if(!q.rowCount)return res.status(404).json({ok:false,error:"مدل پیدا نشد."});
  res.json({ok:true});
});
app.post("/api/owner/unit-catalog",auth,ownerOnly,async(req,res)=>{
  const name=String(req.body?.name||"").trim().slice(0,60),category=String(req.body?.category||"ground"),categoryNames={ground:"نیروی زمینی",air:"نیروی هوایی",naval:"ناوگان دریایی",support:"پشتیبانی و شناسایی",defense:"پدافند و دفاع"};
  const imageUrl=String(req.body?.imageUrl||"").trim(),validImage=/^https:\/\//i.test(imageUrl)||/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(imageUrl),icon=String(req.body?.icon||"🧩").slice(0,12),quantity=Number(req.body?.quantity??1),power=Number(req.body?.power??10);
  const cost={coins:Number(req.body?.coins),steel:Number(req.body?.steel),food:Number(req.body?.food),energy:Number(req.body?.energy),oil:Number(req.body?.oil)},game={attack:Number(req.body?.gameAttack??power),defense:Number(req.body?.gameDefense??Math.round(power*.55)),capacity:Number(req.body?.gameCapacity??10),operationCost:Number(req.body?.gameOperationCost??Math.max(1,Math.round(power/80))),cooldown:Number(req.body?.gameCooldown??2)};
  if(name.length<2||!categoryNames[category]||!validImage||imageUrl.length>6000000||!Number.isSafeInteger(quantity)||quantity<1||quantity>1000000||!Number.isSafeInteger(power)||power<1||power>1000000||Object.values(cost).some(v=>!Number.isSafeInteger(v)||v<0||v>100000000000)||Object.values(game).some(v=>!Number.isSafeInteger(v)||v<0||v>1000000))return res.status(400).json({ok:false,error:"اطلاعات مدل یا قیمت معتبر نیست."});
  const key="custom_"+crypto.randomBytes(8).toString("hex");
  await pool.query("INSERT INTO custom_unit_catalog(unit_type,name,category,category_name,icon,image_url,quantity,coins,steel,food,energy,oil,power,created_by,game_attack,game_defense,game_capacity,game_operation_cost,game_cooldown) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)",[key,name,category,categoryNames[category],icon,imageUrl,quantity,cost.coins,cost.steel,cost.food,cost.energy,cost.oil,power,String(req.user.id),game.attack,game.defense,game.capacity,game.operationCost,game.cooldown]);
  res.json({ok:true,type:key});
});
app.post("/api/owner/unit-catalog/:type/delete",auth,ownerOnly,async(req,res)=>{
  const type=String(req.params.type||"");
  if(!/^custom_[a-f0-9]{16}$/.test(type))return res.status(400).json({ok:false,error:"فقط مدل‌های سفارشی قابل حذف هستند."});
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const found=await client.query("SELECT unit_type,name FROM custom_unit_catalog WHERE unit_type=$1 FOR UPDATE",[type]);
    if(!found.rowCount){await client.query("ROLLBACK");return res.status(404).json({ok:false,error:"مدل پیدا نشد."})}
    await client.query("DELETE FROM military_units WHERE unit_type=$1",[type]);
    await client.query("DELETE FROM custom_unit_catalog WHERE unit_type=$1",[type]);
    await client.query("COMMIT");
    res.json({ok:true,name:found.rows[0].name});
  }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
});
app.get("/api/owner/players",auth,ownerOnly,async(_req,res)=>{
  const q=await pool.query("SELECT telegram_id,first_name,username,country_name,country_code,country_flag,created_at FROM players WHERE country_code IS NOT NULL ORDER BY country_name,first_name LIMIT 500");
  res.set("Cache-Control","no-store").json({ok:true,players:q.rows});
});
app.post("/api/owner/release-country",auth,ownerOnly,async(req,res)=>{
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const current=await client.query("SELECT country_code,country_name FROM players WHERE telegram_id=$1 FOR UPDATE",[String(req.user.id)]);
    if(!current.rowCount||!current.rows[0].country_code){await client.query("ROLLBACK");return res.status(409).json({ok:false,error:"در حال حاضر کشوری به حساب مالک وصل نیست."});}
    const released=current.rows[0];
    await client.query("UPDATE players SET country_code=NULL,country_name=NULL,country_flag='',updated_at=NOW() WHERE telegram_id=$1",[String(req.user.id)]);
    await client.query("INSERT INTO admin_logs(owner_id,target_id,action,details) VALUES($1,$1,'release_own_country',$2)",[String(req.user.id),JSON.stringify({country_code:released.country_code,country_name:released.country_name})]);
    await client.query("COMMIT");
    await publishWorldEvent("🏳️ "+released.country_name+" آزاد شد و دوباره در فهرست کشورها قرار گرفت.");
    res.json({ok:true,released:released.country_code});
  }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
});
app.post("/api/owner/money",auth,ownerOnly,async(req,res)=>{
  const target=String(req.body?.targetId||"");const amount=Number(req.body?.amount);
  if(!/^\d{5,20}$/.test(target)||!Number.isSafeInteger(amount)||amount<1||amount>100000000000)return res.status(400).json({ok:false,error:"مقادیر نامعتبر"});
  const q=await pool.query("UPDATE players SET coins=coins+$1,updated_at=NOW() WHERE telegram_id=$2 RETURNING telegram_id",[amount,target]);
  if(!q.rowCount)return res.status(404).json({ok:false,error:"بازیکن پیدا نشد"});
  await pool.query("INSERT INTO admin_logs(owner_id,target_id,action,details) VALUES($1,$2,'add_money',$3)",[String(req.user.id),target,JSON.stringify({amount})]);
  await pool.query("INSERT INTO transactions(telegram_id,kind,resource,amount) VALUES($1,'admin','coins',$2)",[target,amount]);res.json({ok:true});
});
app.post("/api/owner/resource",auth,ownerOnly,async(req,res)=>{
  const target=String(req.body?.targetId||""),resource=req.body?.resource,amount=Number(req.body?.amount);
  if(!/^\d{5,20}$/.test(target)||!["oil","steel","food","energy"].includes(resource)||!Number.isSafeInteger(amount)||amount<1||amount>1000000000)return res.status(400).json({ok:false,error:"مقادیر نامعتبر"});
  const q=await pool.query(`UPDATE players SET ${resource}=${resource}+$1,updated_at=NOW() WHERE telegram_id=$2 RETURNING telegram_id`,[amount,target]);
  if(!q.rowCount)return res.status(404).json({ok:false,error:"بازیکن پیدا نشد"});
  await pool.query("INSERT INTO admin_logs(owner_id,target_id,action,details) VALUES($1,$2,'add_resource',$3)",[String(req.user.id),target,JSON.stringify({resource,amount})]);
  await pool.query("INSERT INTO transactions(telegram_id,kind,resource,amount) VALUES($1,'admin',$2,$3)",[target,resource,amount]);res.json({ok:true});
});


const UNIT_CATALOG = {
  infantry:{name:"نیروی زمینی",icon:"🪖",quantity:100,cost:{coins:5200,steel:25,food:70,energy:15,oil:0},power:100},
  armor:{name:"یگان زرهی",icon:"🛡️",quantity:10,cost:{coins:14400,steel:100,food:25,energy:45,oil:70},power:180},
  air:{name:"یگان هوایی",icon:"✈️",quantity:5,cost:{coins:25000,steel:90,food:15,energy:100,oil:110},power:260},
  navy:{name:"ناوگان دریایی",icon:"🚢",quantity:3,cost:{coins:22000,steel:140,food:20,energy:65,oil:95},power:230}
};
const UNIT_DATABASE = [["f22","F-22 Raptor","air","نیروی هوایی","🛩️",5,33000,100,20,110,140,920,88,18,3,2],["f35","F-35 Lightning II","air","نیروی هوایی","✈️",5,29600,95,25,100,125,850,82,22,3,2],["f16","F-16 Fighting Falcon","air","نیروی هوایی","🛩️",6,19600,65,25,70,90,690,68,18,4,1],["rafale","Dassault Rafale","air","نیروی هوایی","✈️",5,26400,90,20,90,115,810,78,20,3,2],["typhoon","Eurofighter Typhoon","air","نیروی هوایی","🛩️",5,27400,95,20,95,120,830,80,20,3,2],["su57","Su-57 Felon","air","نیروی هوایی","🛩️",4,31600,105,20,105,135,890,84,18,3,2],["b2","B-2 Spirit","air","نیروی هوایی","🛫",2,56000,190,10,180,210,980,45,36,5,4],["b52","B-52 Stratofortress","air","نیروی هوایی","🛫",2,44000,170,15,155,190,900,42,40,5,4],["c17","C-17 Globemaster III","air","نیروی هوایی","🛬",3,33000,120,35,110,130,420,20,95,2,3],["awacs","AWACS Support Aircraft","support","پشتیبانی و شناسایی","📡",2,35000,90,20,120,150,300,12,75,2,3],["reaper","MQ-9 Reaper","air","نیروی هوایی","🛸",4,21000,65,15,65,75,560,48,16,3,2],["apache","AH-64 Apache","air","نیروی هوایی","🚁",5,22400,75,20,75,95,720,62,14,3,2],["chinook","CH-47 Chinook","air","نیروی هوایی","🚁",4,18400,60,35,65,80,280,22,65,2,2],["infantry_pro","Professional Infantry","ground","نیروی زمینی","🪖",100,14400,45,100,25,10,320,58,30,2,1],["mechanized","Mechanized Infantry","ground","نیروی زمینی","🚙",30,19600,80,55,45,35,480,66,38,2,2],["mbt","Main Battle Tank","ground","نیروی زمینی","🛡️",12,29000,130,20,65,75,820,72,12,4,2],["light_tank","Light Tank","ground","نیروی زمینی","🚜",15,21000,95,25,50,55,610,58,16,3,2],["artillery","Field Artillery","ground","نیروی زمینی","🎯",8,23600,105,15,55,65,760,24,10,4,3],["rocket_system","Rocket Support Unit","ground","نیروی زمینی","🚀",6,27600,125,10,70,90,800,20,8,5,3],["recon","Reconnaissance Vehicle","support","پشتیبانی و شناسایی","🔭",12,15200,55,20,35,30,260,28,18,2,1],["engineer","Engineering Corps","support","پشتیبانی و شناسایی","🏗️",20,13600,45,65,30,20,180,18,25,2,1],["carrier","Aircraft Carrier","naval","ناوگان دریایی","🚢",1,84000,320,40,210,260,980,92,100,6,5],["destroyer","Guided Missile Destroyer","naval","ناوگان دریایی","🛳️",2,47000,180,20,125,160,820,80,30,4,3],["frigate","Frigate","naval","ناوگان دریایی","🚢",3,33600,130,25,95,120,660,68,22,3,2],["submarine","Submarine","naval","ناوگان دریایی","🫧",2,51000,190,10,110,150,860,74,18,5,4],["patrol_ship","Patrol Ship","naval","ناوگان دریایی","⛴️",4,18400,70,25,55,65,380,42,15,2,1],["amphibious","Amphibious Transport Ship","naval","ناوگان دریایی","🚢",2,39000,145,55,105,125,360,32,80,3,3],["patriot","Patriot Defense Battery","defense","پدافند و دفاع","🛡️",2,37600,150,10,95,130,180,920,12,4,3],["thaad","THAAD Defense Battery","defense","پدافند و دفاع","🛡️",1,49000,210,5,120,160,160,980,10,5,4],["iron_dome","Iron Dome Defense Unit","defense","پدافند و دفاع","🏰",3,25600,95,15,65,85,140,760,18,3,2],["radar","Long-Range Radar Station","support","پشتیبانی و شناسایی","📡",2,22400,75,10,60,70,120,440,45,2,2],["command","Mobile Command Center","support","پشتیبانی و شناسایی","🎛️",1,27600,95,15,80,90,260,380,55,3,2],["supply","Logistics Supply Convoy","support","پشتیبانی و شناسایی","🚚",5,17000,60,90,45,40,120,180,70,2,1],["medical","Field Medical Unit","support","پشتیبانی و شناسایی","🚑",6,15600,50,100,40,35,100,220,45,2,1],["satcom","Satellite Communications Unit","support","پشتیبانی و شناسایی","🛰️",1,33600,100,10,95,110,210,520,60,3,3],["cyber_defense","Cyber Defense Center","support","پشتیبانی و شناسایی","💻",1,29000,85,10,90,100,180,600,35,3,3]];
const UNIT_PERSIAN_NAMES = {"f22":"جنگنده اف-۲۲ رپتور","f35":"جنگنده اف-۳۵ لایتنینگ","f16":"جنگنده اف-۱۶ فایتینگ فالکن","rafale":"جنگنده رافال","typhoon":"جنگنده یوروفایتر تایفون","su57":"جنگنده سوخو ۵۷","b2":"بمب‌افکن بی-۲ اسپیریت","b52":"بمب‌افکن بی-۵۲","c17":"هواپیمای ترابری سی-۱۷","awacs":"هواپیمای آواکس","reaper":"پهپاد ام‌کیو-۹ ریپر","apache":"بالگرد آپاچی","chinook":"بالگرد شینوک","infantry_pro":"نیروی پیاده حرفه‌ای","mechanized":"پیاده‌نظام مکانیزه","mbt":"تانک اصلی میدان نبرد","light_tank":"تانک سبک","artillery":"توپخانه صحرایی","rocket_system":"یگان پشتیبانی راکتی","recon":"خودروی شناسایی","engineer":"گروه مهندسی","carrier":"ناو هواپیمابر","destroyer":"ناوشکن موشک‌انداز","frigate":"ناوچه","submarine":"زیردریایی","patrol_ship":"کشتی گشتی","amphibious":"کشتی ترابری آبی‌خاکی","patriot":"سامانه پدافندی پاتریوت","thaad":"سامانه پدافندی تاد","iron_dome":"سامانه گنبد آهنین","radar":"ایستگاه راداری دوربرد","command":"مرکز فرماندهی متحرک","supply":"کاروان تدارکاتی","medical":"واحد امداد پزشکی صحرایی","satcom":"واحد ارتباطات ماهواره‌ای","cyber_defense":"مرکز دفاع سایبری"};
for(const row of UNIT_DATABASE){
  const [id,english,category,categoryName,icon,quantity,coins,steel,food,energy,oil,power,gameAttack,gameDefense,gameCapacity,gameOperationCost,gameCooldown]=row;
  UNIT_CATALOG[id]={name:UNIT_PERSIAN_NAMES[id]||english,category,categoryName,icon,quantity,power,gameAttack,gameDefense,gameCapacity,gameOperationCost,gameCooldown,cost:{coins,steel,food,energy,oil}};
}

const BUILDING_CATALOG = {
  power:{name:"نیروگاه برق",icon:"⚡",cost:{coins:13000,steel:90,oil:35,energy:0},production:{energy:30,coins:180},output:"تولید ۳۰ برق در ساعت • درآمد 180 پول در ساعت"},
  solar:{name:"مزرعه خورشیدی",icon:"☀️",cost:{coins:10400,steel:65,oil:0,energy:0},production:{energy:22,coins:150},output:"تولید ۲۲ برق در ساعت • درآمد 150 پول در ساعت"},
  wind:{name:"نیروگاه بادی",icon:"🌬️",cost:{coins:11600,steel:75,oil:0,energy:0},production:{energy:24,coins:160},output:"تولید ۲۴ برق در ساعت • درآمد 160 پول در ساعت"},
  hydro:{name:"نیروگاه آبی",icon:"💧",cost:{coins:17600,steel:130,oil:20,energy:0},production:{energy:28,coins:200},output:"تولید ۲۸ برق در ساعت • درآمد 200 پول در ساعت"},
  oilfield:{name:"میدان استخراج نفت",icon:"🛢️",cost:{coins:15200,steel:85,oil:15,energy:35},production:{oil:9,energyNeed:2,coins:300},output:"تولید ۹ نفت در ساعت • درآمد 300 پول در ساعت"},
  refinery:{name:"پالایشگاه نفت",icon:"🏭",cost:{coins:16400,steel:100,oil:0,energy:120},production:{oil:12,energyNeed:4,coins:420},output:"تولید ۱۲ نفت در ساعت • درآمد 420 پول در ساعت"},
  mine:{name:"معدن فولاد",icon:"⛏️",cost:{coins:14400,steel:45,oil:35,energy:45},production:{steel:8,energyNeed:4,coins:280},output:"تولید ۸ فولاد در ساعت • درآمد 280 پول در ساعت"},
  steelworks:{name:"کارخانه فولاد",icon:"🏗️",cost:{coins:19000,steel:60,oil:45,energy:150},production:{steel:10,energyNeed:6,coins:360},output:"تولید ۱۰ فولاد در ساعت • درآمد 360 پول در ساعت"},
  farm:{name:"مزرعه صنعتی",icon:"🌾",cost:{coins:9600,steel:35,oil:0,energy:55},production:{food:18,energyNeed:3,coins:240},output:"تولید ۱۸ غذا در ساعت • درآمد 240 پول در ساعت"},
  fishery:{name:"مرکز پرورش آبزیان",icon:"🐟",cost:{coins:7800,steel:28,oil:0,energy:35},production:{food:12,energyNeed:2,coins:200},output:"تولید ۱۲ غذا در ساعت • درآمد 200 پول در ساعت"},
  commercial:{name:"منطقه تجاری",icon:"🏙️",cost:{coins:18000,steel:75,oil:20,energy:65},production:{energyNeed:3,coins:1200},output:"بدون درآمد مستقیم پولی • درآمد 1200 پول در ساعت"},
  mall:{name:"مجتمع خرید",icon:"🛍️",cost:{coins:25000,steel:95,oil:25,energy:90},production:{energyNeed:5,coins:1500},output:"بدون درآمد مستقیم پولی • درآمد 1500 پول در ساعت"},
  tourism:{name:"مجموعه گردشگری",icon:"🏝️",cost:{coins:21000,steel:65,oil:15,energy:55},production:{energyNeed:3,coins:1400},output:"بدون درآمد مستقیم پولی • درآمد 1400 پول در ساعت"},
  hotel:{name:"هتل بین‌المللی",icon:"🏨",cost:{coins:13600,steel:48,oil:10,energy:40},production:{energyNeed:2,coins:1100},output:"بدون درآمد مستقیم پولی • درآمد 1100 پول در ساعت"},
  bank:{name:"مرکز خدمات مالی",icon:"🏦",cost:{coins:29000,steel:85,oil:20,energy:80},production:{energyNeed:4,coins:1800},output:"بدون درآمد مستقیم پولی • درآمد 1800 پول در ساعت"},
  techpark:{name:"شهرک فناوری",icon:"💻",cost:{coins:35000,steel:120,oil:35,energy:150},production:{energyNeed:8,coins:1700},output:"بدون درآمد مستقیم پولی • درآمد 1700 پول در ساعت"},
  cargoport:{name:"بندر تجاری",icon:"⚓",cost:{coins:19600,steel:110,oil:30,energy:75},production:{energyNeed:3,coins:950},output:"بدون درآمد مستقیم پولی • درآمد 950 پول در ساعت"},
  airport:{name:"فرودگاه باربری",icon:"🛫",cost:{coins:27000,steel:125,oil:45,energy:110},production:{energyNeed:5,coins:1250},output:"بدون درآمد مستقیم پولی • درآمد 1250 پول در ساعت"},
  datacenter:{name:"مرکز داده",icon:"🖥️",cost:{coins:31000,steel:90,oil:25,energy:130},production:{energyNeed:6,coins:1750},output:"بدون درآمد مستقیم پولی • درآمد 1750 پول در ساعت"},
  recycling:{name:"کارخانه بازیافت",icon:"♻️",cost:{coins:12200,steel:55,oil:10,energy:50},production:{steel:4,energyNeed:2,coins:220},output:"تولید ۴ فولاد در ساعت • درآمد 220 پول در ساعت"},
  geothermal:{name:"نیروگاه زمین‌گرمایی",icon:"🌋",cost:{coins:19600,steel:110,oil:10,energy:0},production:{energy:32,coins:220},output:"تولید ۳۲ برق در ساعت • درآمد 220 پول در ساعت"},
  nuclear:{name:"نیروگاه هسته‌ای بازی",icon:"☢️",cost:{coins:48000,steel:260,oil:0,energy:0},production:{energy:85,coins:500},output:"تولید ۸۵ برق در ساعت • درآمد 500 پول در ساعت"},
  tidal:{name:"نیروگاه جزرومدی",icon:"🌊",cost:{coins:23000,steel:145,oil:0,energy:0},production:{energy:30,coins:200},output:"تولید ۳۰ برق در ساعت • درآمد 200 پول در ساعت"},
  biomass:{name:"نیروگاه زیست‌توده",icon:"🍃",cost:{coins:13800,steel:75,oil:0,energy:0},production:{energy:20,coins:160},output:"تولید ۲۰ برق در ساعت • درآمد 160 پول در ساعت"},
  wastepower:{name:"نیروگاه تبدیل پسماند",icon:"♻️",cost:{coins:17000,steel:95,oil:0,energy:0},production:{energy:25,coins:190},output:"تولید ۲۵ برق در ساعت • درآمد 190 پول در ساعت"},
  solarpark:{name:"پارک خورشیدی بزرگ",icon:"🌞",cost:{coins:29000,steel:160,oil:0,energy:0},production:{energy:58,coins:300},output:"تولید ۵۸ برق در ساعت • درآمد 300 پول در ساعت"},
  offshorewind:{name:"مزرعه بادی فراساحلی",icon:"🌀",cost:{coins:33000,steel:190,oil:0,energy:0},production:{energy:62,coins:320},output:"تولید ۶۲ برق در ساعت • درآمد 320 پول در ساعت"},
  battery:{name:"مرکز ذخیره انرژی",icon:"🔋",cost:{coins:14400,steel:125,oil:0,energy:0},production:{energy:14,coins:130},output:"افزایش ۱۴ واحد برق در ساعت در اقتصاد بازی • درآمد 130 پول در ساعت"},
  gasfield:{name:"میدان گاز طبیعی",icon:"🔥",cost:{coins:19600,steel:100,oil:0,energy:30},production:{oil:16,energyNeed:3,coins:380},output:"تولید ۱۶ واحد سوخت در ساعت • درآمد 380 پول در ساعت"},
  petrochem:{name:"مجتمع پتروشیمی",icon:"🧪",cost:{coins:26400,steel:145,oil:60,energy:100},production:{energyNeed:6,coins:650},output:"بدون درآمد مستقیم پولی • درآمد 650 پول در ساعت"},
  factory:{name:"شهرک صنعتی",icon:"🏭",cost:{coins:23600,steel:120,oil:30,energy:100},production:{steel:3,energyNeed:6,coins:600},output:"تولید منابع بدون درآمد مستقیم پولی • درآمد 600 پول در ساعت"},
  electronics:{name:"کارخانه قطعات الکترونیکی",icon:"🔌",cost:{coins:29600,steel:130,oil:25,energy:140},production:{energyNeed:8,coins:850},output:"بدون درآمد مستقیم پولی • درآمد 850 پول در ساعت"},
  software:{name:"مرکز توسعه نرم‌افزار",icon:"🧑‍💻",cost:{coins:21600,steel:55,oil:10,energy:95},production:{energyNeed:5,coins:1050},output:"بدون درآمد مستقیم پولی • درآمد 1050 پول در ساعت"},
  exchange:{name:"بورس و بازار سرمایه",icon:"📈",cost:{coins:37000,steel:90,oil:10,energy:90},production:{energyNeed:5,coins:2000},output:"بدون درآمد مستقیم پولی • درآمد 2000 پول در ساعت"},
  logistics:{name:"مرکز لجستیک",icon:"🚚",cost:{coins:18400,steel:100,oil:35,energy:65},production:{energyNeed:3,coins:650},output:"بدون درآمد مستقیم پولی • درآمد 650 پول در ساعت"},
  containerport:{name:"پایانه کانتینری",icon:"🚢",cost:{coins:27600,steel:160,oil:35,energy:100},production:{energyNeed:5,coins:1000},output:"بدون درآمد مستقیم پولی • درآمد 1000 پول در ساعت"},
  university:{name:"دانشگاه ملی",icon:"🎓",cost:{coins:25000,steel:85,oil:10,energy:75},production:{energyNeed:4,coins:500},output:"بدون درآمد مستقیم پولی • درآمد 500 پول در ساعت"},
  hospital:{name:"شبکه بیمارستانی",icon:"🏥",cost:{coins:22400,steel:105,oil:15,energy:85},production:{energyNeed:5,coins:420},output:"بدون درآمد مستقیم پولی • درآمد 420 پول در ساعت"},
  desalination:{name:"تأسیسات آب‌شیرین‌کن",icon:"💧",cost:{coins:19400,steel:115,oil:0,energy:95},production:{food:8,energyNeed:5,coins:280},output:"تولید ۸ غذا در ساعت • درآمد 280 پول در ساعت"},
  greenhouse:{name:"گلخانه هوشمند",icon:"🌱",cost:{coins:15200,steel:70,oil:0,energy:60},production:{food:28,energyNeed:3,coins:300},output:"تولید ۲۸ غذا در ساعت • درآمد 300 پول در ساعت"},
  livestock:{name:"مجتمع دامپروری",icon:"🐄",cost:{coins:12800,steel:55,oil:0,energy:45},production:{food:22,energyNeed:2,coins:260},output:"تولید ۲۲ غذا در ساعت • درآمد 260 پول در ساعت"},
  quarry:{name:"معدن سنگ و مواد خام",icon:"🪨",cost:{coins:13800,steel:40,oil:20,energy:55},production:{steel:12,energyNeed:3,coins:270},output:"تولید ۱۲ فولاد در ساعت • درآمد 270 پول در ساعت"},
  lithium:{name:"معدن مواد پیشرفته",icon:"💎",cost:{coins:25600,steel:100,oil:25,energy:100},production:{steel:18,energyNeed:6,coins:450},output:"تولید ۱۸ فولاد در ساعت • درآمد 450 پول در ساعت"},
  media:{name:"شبکه رسانه‌ای",icon:"📡",cost:{coins:17400,steel:45,oil:10,energy:50},production:{energyNeed:2,coins:700},output:"بدون درآمد مستقیم پولی • درآمد 700 پول در ساعت"},
  research:{name:"مرکز پژوهش و نوآوری",icon:"🔬",cost:{coins:32400,steel:125,oil:15,energy:145},production:{energyNeed:7,coins:750},output:"بدون درآمد مستقیم پولی • درآمد 750 پول در ساعت"},
};

const COUNTRY_ECONOMY = {
 USA:{income:5,energy:42,oil:22,steel:14,food:25}, CHN:{income:5,energy:48,oil:14,steel:32,food:34},
 DEU:{income:5,energy:32,oil:8,steel:22,food:16}, JPN:{income:5,energy:35,oil:6,steel:18,food:12},
 IND:{income:5,energy:28,oil:10,steel:16,food:38}, GBR:{income:5,energy:29,oil:12,steel:9,food:14},
 FRA:{income:5,energy:38,oil:7,steel:13,food:19}, RUS:{income:5,energy:45,oil:35,steel:25,food:22},
 CAN:{income:5,energy:44,oil:28,steel:15,food:28}, BRA:{income:5,energy:36,oil:18,steel:14,food:36},
 AUS:{income:5,energy:40,oil:24,steel:18,food:30}, KOR:{income:5,energy:30,oil:5,steel:20,food:10},
 ITA:{income:5,energy:27,oil:8,steel:12,food:22}, ESP:{income:5,energy:34,oil:7,steel:10,food:25},
 TUR:{income:5,energy:26,oil:9,steel:14,food:26}, SAU:{income:5,energy:40,oil:48,steel:8,food:8},
 IRN:{income:5,energy:38,oil:42,steel:17,food:20}, IDN:{income:5,energy:31,oil:16,steel:12,food:29},
 MEX:{income:5,energy:29,oil:20,steel:13,food:24}, NLD:{income:5,energy:28,oil:11,steel:11,food:18},
 NOR:{income:5,energy:50,oil:38,steel:10,food:13}, CHE:{income:5,energy:33,oil:4,steel:9,food:12},
 ZAF:{income:5,energy:24,oil:8,steel:19,food:18}, EGY:{income:5,energy:25,oil:13,steel:9,food:23},
 PAK:{income:5,energy:19,oil:7,steel:8,food:28}, ARG:{income:5,energy:27,oil:15,steel:10,food:33},
 POL:{income:5,energy:26,oil:8,steel:17,food:20}, SWE:{income:5,energy:43,oil:5,steel:16,food:17},
 ARE:{income:5,energy:46,oil:32,steel:7,food:7}, NZL:{income:5,energy:39,oil:5,steel:8,food:27}
};
function countryEconomy(code){return COUNTRY_ECONOMY[code]||{income:5,energy:18,oil:5,steel:7,food:12};}

async function applyProduction(id){
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const p=await client.query("SELECT coins,energy,oil,steel,food,production_at,country_code,shop_income FROM players WHERE telegram_id=$1 FOR UPDATE",[String(id)]);
    if(!p.rowCount){await client.query("ROLLBACK");return}
    const b=await client.query("SELECT building_type,level FROM national_buildings WHERE telegram_id=$1",[String(id)]);
    const levels=Object.fromEntries(b.rows.map(x=>[x.building_type,Number(x.level)]));
    const seconds=Math.max(0,Math.min(86400,(Date.now()-new Date(p.rows[0].production_at).getTime())/1000));
    const hours=seconds/3600;
    if(seconds>=1){
      const base=countryEconomy(p.rows[0].country_code); let coins=seconds*5,initialEnergy=Number(p.rows[0].energy),initialOil=Number(p.rows[0].oil),initialSteel=Number(p.rows[0].steel),initialFood=Number(p.rows[0].food),energy=initialEnergy+hours*base.energy,oil=initialOil+hours*base.oil,steel=initialSteel+hours*base.steel,food=initialFood+hours*base.food;
      for(const key of ["power","solar","wind","hydro","geothermal","nuclear","tidal","biomass","wastepower","solarpark","offshorewind","battery"])energy+=hours*(levels[key]||0)*Number(BUILDING_CATALOG[key].production.energy||0);
      for(const [key,item] of Object.entries(BUILDING_CATALOG)){
        const production=item.production||{},level=levels[key]||0;
        if(!level)continue;
        if(production.energy){if(production.coins)coins+=hours*level*production.coins;continue;}
        const need=Number(production.energyNeed||0),active=need>0?Math.min(level,energy/(hours*need)):level;
        if(need>0)energy=Math.max(0,energy-hours*active*need);
        if(production.oil)oil+=hours*active*production.oil;
        if(production.steel)steel+=hours*active*production.steel;
        if(production.food)food+=hours*active*production.food;
        if(production.coins)coins+=hours*active*production.coins;
      }
      await client.query("UPDATE players SET coins=coins+$1::numeric,energy=energy+$2::numeric,oil=oil+$3::numeric,steel=steel+$4::numeric,food=food+$5::numeric,production_at=NOW() WHERE telegram_id=$6",[Math.floor(coins).toString(),(Math.floor(energy)-Math.floor(initialEnergy)).toString(),(Math.floor(oil)-Math.floor(initialOil)).toString(),(Math.floor(steel)-Math.floor(initialSteel)).toString(),(Math.floor(food)-Math.floor(initialFood)).toString(),String(id)]);
    }
    await client.query("COMMIT");
  }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
}
app.get("/api/army",auth,async(req,res)=>{
  await applyProduction(req.user.id);
  const [p,u,b,custom,images]=await Promise.all([
    pool.query("SELECT coins,oil,steel,food,energy FROM players WHERE telegram_id=$1",[String(req.user.id)]),
    pool.query("SELECT unit_type,quantity FROM military_units WHERE telegram_id=$1",[String(req.user.id)]),
    pool.query("SELECT building_type,level FROM national_buildings WHERE telegram_id=$1",[String(req.user.id)]),
    pool.query("SELECT unit_type,name,category,category_name,icon,image_url,quantity,coins,steel,food,energy,oil,power,game_attack,game_defense,game_capacity,game_operation_cost,game_cooldown FROM custom_unit_catalog ORDER BY created_at DESC"),
    pool.query("SELECT unit_type,image_url FROM unit_catalog_images")
  ]);
  const units=Object.fromEntries(u.rows.map(x=>[x.unit_type,Number(x.quantity)]));
  const buildings=Object.fromEntries(b.rows.map(x=>[x.building_type,Number(x.level)]));
  const catalog={...UNIT_CATALOG};
  for(const x of images.rows)if(catalog[x.unit_type])catalog[x.unit_type].imageUrl=x.image_url;
  for(const x of custom.rows)catalog[x.unit_type]={name:x.name,category:x.category,categoryName:x.category_name,icon:x.icon,imageUrl:x.image_url,quantity:Number(x.quantity),power:Number(x.power),gameAttack:Number(x.game_attack||x.power),gameDefense:Number(x.game_defense||Math.round(Number(x.power)*.55)),gameCapacity:Number(x.game_capacity||10),gameOperationCost:Number(x.game_operation_cost||1),gameCooldown:Number(x.game_cooldown||2),cost:{coins:Number(x.coins),steel:Number(x.steel),food:Number(x.food),energy:Number(x.energy),oil:Number(x.oil)}};
  res.json({ok:true,resources:p.rows[0],units,buildings,unitCatalog:catalog,buildingCatalog:BUILDING_CATALOG});
});
app.post("/api/army/recruit",auth,async(req,res)=>{
  const type=String(req.body?.type||"");let item=UNIT_CATALOG[type];if(!item){const custom=await pool.query("SELECT name,icon,category,category_name,quantity,coins,steel,food,energy,oil,power,game_attack,game_defense,game_capacity,game_operation_cost,game_cooldown FROM custom_unit_catalog WHERE unit_type=$1",[type]);if(custom.rowCount){const x=custom.rows[0];item={name:x.name,icon:x.icon,category:x.category,categoryName:x.category_name,quantity:Number(x.quantity),power:Number(x.power),gameAttack:Number(x.game_attack||x.power),gameDefense:Number(x.game_defense||Math.round(Number(x.power)*.55)),gameCapacity:Number(x.game_capacity||10),gameOperationCost:Number(x.game_operation_cost||1),gameCooldown:Number(x.game_cooldown||2),cost:{coins:Number(x.coins),steel:Number(x.steel),food:Number(x.food),energy:Number(x.energy),oil:Number(x.oil)}}}}if(!item)return res.status(400).json({ok:false,error:"نوع یگان معتبر نیست."});
  const batches=Number(req.body?.quantity??1);if(!Number.isSafeInteger(batches)||batches<1||batches>1000000)return res.status(400).json({ok:false,error:"تعداد معتبر نیست."});
  const c=item.cost,totals={coins:c.coins*batches,steel:c.steel*batches,food:c.food*batches,energy:c.energy*batches,oil:c.oil*batches},added=Number(item.quantity)*batches;
  if(!Number.isSafeInteger(added)||Object.values(totals).some(v=>!Number.isSafeInteger(v)))return res.status(400).json({ok:false,error:"تعداد انتخابی بیش از حد مجاز است."});
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const q=await client.query("UPDATE players SET coins=coins-$1,steel=steel-$2,food=food-$3,energy=energy-$4,oil=oil-$5,updated_at=NOW() WHERE telegram_id=$6 AND country_code IS NOT NULL AND coins >= $1 AND steel >= $2 AND food >= $3 AND energy >= $4 AND oil >= $5 RETURNING telegram_id",
      [totals.coins,totals.steel,totals.food,totals.energy,totals.oil,String(req.user.id)]);
    if(!q.rowCount){await client.query("ROLLBACK");return res.status(400).json({ok:false,error:"منابع کافی نیست. هزینه کل و موجودی منابع را بررسی کن."})}
    await client.query("INSERT INTO military_units(telegram_id,unit_type,quantity) VALUES($1,$2,$3) ON CONFLICT(telegram_id,unit_type) DO UPDATE SET quantity=military_units.quantity+EXCLUDED.quantity",[String(req.user.id),type,added]);
    await client.query("INSERT INTO transactions(telegram_id,kind,resource,amount) VALUES($1,'recruit',$2,$3)",[String(req.user.id),type,added]);
    await client.query("COMMIT");
    res.json({ok:true,quantity:added,batches,cost:totals});
  }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
});
app.post("/api/army/build",auth,async(req,res)=>{
  const type=req.body?.type,item=BUILDING_CATALOG[type];if(!item)return res.status(400).json({ok:false,error:"نوع زیرساخت معتبر نیست."});
  const quantity=Number(req.body?.quantity??1);if(!Number.isSafeInteger(quantity)||quantity<1||quantity>1000000)return res.status(400).json({ok:false,error:"تعداد سطح معتبر نیست."});
  const client=await pool.connect(),c=item.cost,totals={coins:c.coins*quantity,steel:c.steel*quantity,oil:c.oil*quantity,energy:c.energy*quantity};
  if(Object.values(totals).some(v=>!Number.isSafeInteger(v)))return res.status(400).json({ok:false,error:"هزینه انتخاب‌شده بیش از حد مجاز است."});
  try{
    await client.query("BEGIN");
    const isEnergySource=["power","solar","wind","hydro","geothermal","nuclear","tidal","biomass","wastepower","solarpark","offshorewind","battery"].includes(type);
    if(!isEnergySource){
      const sources=await client.query("SELECT COALESCE(SUM(level),0)::int AS level FROM national_buildings WHERE telegram_id=$1 AND building_type IN ('power','solar','wind','hydro','geothermal','nuclear','tidal','biomass','wastepower','solarpark','offshorewind','battery')",[String(req.user.id)]);
      if(Number(sources.rows[0]?.level||0)<1){await client.query("ROLLBACK");return res.status(400).json({ok:false,error:"اول یک نیروگاه برق، خورشیدی، بادی یا آبی بساز."})}
    }
    const q=await client.query("UPDATE players SET coins=coins-$1,steel=steel-$2,oil=oil-$3,energy=energy-$4,updated_at=NOW() WHERE telegram_id=$5 AND country_code IS NOT NULL AND coins >= $1 AND steel >= $2 AND oil >= $3 AND energy >= $4 RETURNING telegram_id",[totals.coins,totals.steel,totals.oil,totals.energy,String(req.user.id)]);
    if(!q.rowCount){await client.query("ROLLBACK");return res.status(400).json({ok:false,error:"منابع لازم برای ساخت این زیرساخت کافی نیست."})}
    await client.query("INSERT INTO national_buildings(telegram_id,building_type,level) VALUES($1,$2,$3) ON CONFLICT(telegram_id,building_type) DO UPDATE SET level=national_buildings.level+EXCLUDED.level",[String(req.user.id),type,quantity]);
    await client.query("COMMIT");
    res.json({ok:true,quantity,cost:totals});
  }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
});
app.get("/api/battles",auth,async(req,res)=>{
 const id=String(req.user.id);
 const q=await pool.query("SELECT b.id,b.attacker_id,b.defender_id,b.winner_id,b.attacker_power,b.defender_power,b.attacker_losses,b.defender_losses,b.loot,b.summary,b.created_at,a.country_name AS attacker_country,d.country_name AS defender_country FROM battle_reports b JOIN players a ON a.telegram_id=b.attacker_id JOIN players d ON d.telegram_id=b.defender_id WHERE b.attacker_id=$1 OR b.defender_id=$1 ORDER BY b.id DESC LIMIT 30",[id]);
 res.json({ok:true,reports:q.rows});
});
app.post("/api/battles/launch",auth,async(req,res)=>{
 const attacker=String(req.user.id),target=String(req.body?.target_id||""),forces=req.body?.forces;
 if(!/^\d{5,20}$/.test(target)||target===attacker||!forces||typeof forces!=="object"||Array.isArray(forces))return res.status(400).json({ok:false,error:"هدف یا ترکیب نیروها معتبر نیست."});
 const entries=Object.entries(forces);
 if(!entries.length||entries.length>20||entries.some(([k,v])=>!/^[a-zA-Z0-9_-]{1,64}$/.test(k)||!Number.isSafeInteger(Number(v))||Number(v)<0||Number(v)>50000)||entries.every(([,v])=>Number(v)===0))return res.status(400).json({ok:false,error:"حداقل یک یگان با تعداد معتبر انتخاب کن."});
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  const war=await client.query("SELECT id FROM diplomacy WHERE kind='war' AND status='active' AND ((from_id=$1 AND to_id=$2) OR (from_id=$2 AND to_id=$1)) FOR UPDATE",[attacker,target]);
  if(!war.rowCount){await client.query("ROLLBACK");return res.status(400).json({ok:false,error:"برای این کشور هنوز جنگ فعالی ثبت نشده است."})}
  const people=await client.query("SELECT telegram_id,country_name FROM players WHERE telegram_id=ANY($1::bigint[]) AND country_code IS NOT NULL FOR UPDATE",[[attacker,target]]);
  if(people.rowCount!==2){await client.query("ROLLBACK");return res.status(404).json({ok:false,error:"کشور مهاجم یا مدافع پیدا نشد."})}
  const cr=await client.query("SELECT unit_type,name,game_attack,game_defense,power FROM custom_unit_catalog");
  const custom=new Map(cr.rows.map(x=>[x.unit_type,{name:x.name,attack:Number(x.game_attack||x.power||1),defense:Number(x.game_defense||Math.round(Number(x.power||1)*.55))}]));
  const stats=t=>UNIT_CATALOG[t]?{name:UNIT_CATALOG[t].name,attack:Number(UNIT_CATALOG[t].gameAttack||UNIT_CATALOG[t].power||1),defense:Number(UNIT_CATALOG[t].gameDefense||1)}:custom.get(t);
  const a=await client.query("SELECT unit_type,quantity FROM military_units WHERE telegram_id=$1 FOR UPDATE",[attacker]);
  const d=await client.query("SELECT unit_type,quantity FROM military_units WHERE telegram_id=$1 FOR UPDATE",[target]);
  const am=new Map(a.rows.map(x=>[x.unit_type,Number(x.quantity)])),dm=new Map(d.rows.map(x=>[x.unit_type,Number(x.quantity)]));
  const used=entries.filter(([,v])=>Number(v)>0);let ap=0,dp=0,defending=[];
  for(const [type,raw] of used){const qty=Number(raw),st=stats(type);if(!st||qty>(am.get(type)||0)){await client.query("ROLLBACK");return res.status(400).json({ok:false,error:"موجودی یکی از یگان‌های انتخابی کافی نیست یا مدل معتبر نیست."})}ap+=qty*st.attack}
  for(const [type,qty] of dm){if(qty<=0)continue;const st=stats(type);if(!st)continue;dp+=qty*st.defense;defending.push({type,qty})}
  if(!Number.isFinite(ap)||!Number.isFinite(dp)||ap<=0){await client.query("ROLLBACK");return res.status(400).json({ok:false,error:"قدرت ارتش برای نبرد کافی نیست."})}
  const win=ap>=dp,winner=win?attacker:target,total=ap+dp||1;
  const ar=Math.min(.38,Math.max(.04,(dp/total)*(win ? .30 : .58))),dr=Math.min(.48,Math.max(.05,(ap/total)*(win ? .62 : .34)));
  const al={},dl={};
  const loot={coins:"0",oil:"0",steel:"0",food:"0",energy:"0"};
  if(win){
    const stash=await client.query("SELECT coins,oil,steel,food,energy FROM players WHERE telegram_id=$1",[target]);
    const take=(value,percent,cap)=>{let n=0n;try{n=BigInt(String(value||"0").split(".")[0])}catch{}let amount=n*BigInt(percent)/100n;const limit=BigInt(cap);if(amount>limit)amount=limit;return amount.toString()};
    if(stash.rowCount){
      loot.coins=take(stash.rows[0].coins,5,50000);
      loot.oil=take(stash.rows[0].oil,5,300);
      loot.steel=take(stash.rows[0].steel,4,300);
      loot.food=take(stash.rows[0].food,4,300);
      loot.energy=take(stash.rows[0].energy,3,200);
      await client.query("UPDATE players SET coins=coins-$1::numeric,oil=oil-$2::numeric,steel=steel-$3::numeric,food=food-$4::numeric,energy=energy-$5::numeric WHERE telegram_id=$6",[loot.coins,loot.oil,loot.steel,loot.food,loot.energy,target]);
      await client.query("UPDATE players SET coins=coins+$1::numeric,oil=oil+$2::numeric,steel=steel+$3::numeric,food=food+$4::numeric,energy=energy+$5::numeric WHERE telegram_id=$6",[loot.coins,loot.oil,loot.steel,loot.food,loot.energy,attacker]);
    }
  }
  for(const [type,raw] of used){const qty=Number(raw),loss=Math.min(qty,Math.max(0,Math.ceil(qty*ar)));if(loss){al[type]=loss;await client.query("UPDATE military_units SET quantity=GREATEST(0,quantity-$1) WHERE telegram_id=$2 AND unit_type=$3",[loss,attacker,type])}}
  for(const u of defending){const loss=Math.min(u.qty,Math.max(0,Math.ceil(u.qty*dr)));if(loss){dl[u.type]=loss;await client.query("UPDATE military_units SET quantity=GREATEST(0,quantity-$1) WHERE telegram_id=$2 AND unit_type=$3",[loss,target,u.type])}}
  const names=new Map(people.rows.map(p=>[String(p.telegram_id),p.country_name||"کشور"]));
  const lootText=win?" غنیمت: "+[["🪙",loot.coins],["🛢️",loot.oil],["🔩",loot.steel],["🌾",loot.food],["⚡",loot.energy]].filter(([,v])=>BigInt(v)>0n).map(([icon,v])=>icon+" "+BigInt(v).toLocaleString("en-US")).join(" • "):"";
  const summary=(win?("🏆 "+names.get(attacker)+" در نبرد با "+names.get(target)+" پیروز شد."):("🛡️ "+names.get(target)+" حمله "+names.get(attacker)+" را دفع کرد."))+lootText;
  const report=await client.query("INSERT INTO battle_reports(attacker_id,defender_id,diplomacy_id,winner_id,attacker_power,defender_power,attacker_losses,defender_losses,loot,summary) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10) RETURNING id",[attacker,target,war.rows[0].id,winner,ap,dp,JSON.stringify(al),JSON.stringify(dl),JSON.stringify(loot),summary]);
  await client.query("UPDATE players SET wins=wins+1 WHERE telegram_id=$1",[winner]);
  await client.query("UPDATE players SET losses=losses+1 WHERE telegram_id=$1",[winner===attacker?target:attacker]);
  await client.query("COMMIT");
  await publishWorldEvent("⚔️ "+summary+" قدرت مهاجم: "+Math.round(ap).toLocaleString("en-US")+" • قدرت دفاع: "+Math.round(dp).toLocaleString("en-US"),"war",{report:report.rows[0].id});
  await notifyPlayer(target,summary+" گزارش نبرد در بازی ثبت شد.","war",{report:report.rows[0].id});
  res.json({ok:true,id:report.rows[0].id,summary,loot,attackerPower:ap,defenderPower:dp,attackerLosses:al,defenderLosses:dl});
 }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
});
app.get("/api/diplomacy",auth,async(req,res)=>{
  const id=String(req.user.id);
  const q=await pool.query(`SELECT d.id,d.from_id,d.to_id,d.kind,d.status,d.created_at,
    a.country_name AS from_country,a.country_flag AS from_flag,a.country_code AS from_code,b.country_name AS to_country,b.country_flag AS to_flag,b.country_code AS to_code
    FROM diplomacy d JOIN players a ON a.telegram_id=d.from_id JOIN players b ON b.telegram_id=d.to_id
    WHERE (d.from_id=$1 OR d.to_id=$1) AND d.status IN ('pending','active')
    ORDER BY d.id DESC LIMIT 100`,[id]);
  const p=await pool.query("SELECT telegram_id,country_code,country_name,country_flag FROM players WHERE country_code IS NOT NULL AND telegram_id<>$1 ORDER BY country_name",[id]);
  res.json({ok:true,relations:q.rows,players:p.rows});
});
app.post("/api/diplomacy",auth,async(req,res)=>{
  const action=req.body?.action,target=String(req.body?.target_id||"");
  if(!/^\d{5,20}$/.test(target)||target===String(req.user.id))return res.status(400).json({ok:false,error:"کشور مقصد معتبر نیست."});
  const own=await pool.query("SELECT country_name,country_flag FROM players WHERE telegram_id=$1 AND country_code IS NOT NULL",[String(req.user.id)]);
  const other=await pool.query("SELECT country_name,country_flag,chat_id FROM players WHERE telegram_id=$1 AND country_code IS NOT NULL",[target]);
  if(!own.rowCount||!other.rowCount)return res.status(404).json({ok:false,error:"هر دو طرف باید کشور انتخاب کرده باشند."});
  if(action==="alliance"||action==="war"){
    const kind=action;
    if(kind==="war"){
      const allied=await pool.query("SELECT 1 FROM diplomacy WHERE kind='alliance' AND status='active' AND ((from_id=$1 AND to_id=$2) OR (from_id=$2 AND to_id=$1))",[String(req.user.id),target]);
      if(allied.rowCount)return res.status(400).json({ok:false,error:"تا وقتی اتحاد فعال است، ابتدا باید آن را پایان بدهید."});
    }
    const existing=await pool.query("SELECT id FROM diplomacy WHERE kind=$1 AND status IN ('pending','active') AND ((from_id=$2 AND to_id=$3) OR (from_id=$3 AND to_id=$2)) LIMIT 1",[kind,String(req.user.id),target]);
    if(existing.rowCount)return res.status(409).json({ok:false,error:"برای این دو کشور، درخواست یا وضعیت فعالی وجود دارد."});
    const status=kind==="war"?"active":"pending";
    const q=await pool.query("INSERT INTO diplomacy(from_id,to_id,kind,status) VALUES($1,$2,$3,$4) RETURNING id",[String(req.user.id),target,kind,status]);
    const from=own.rows[0].country_name||"یک کشور",to=other.rows[0].country_name||"کشور دیگر";
    const message=kind==="war"?"⚔️ "+from+" رسماً وضعیت جنگ با "+to+" را اعلام کرد.":"🤝 "+from+" پیشنهاد اتحاد رسمی برای "+to+" فرستاد.";
    const id=q.rows[0].id;
    await publishWorldEvent(message,"diplomacy",{report:id});
    if(kind==="alliance")await notifyPlayer(target,"🤝 "+from+" برای کشور شما پیشنهاد اتحاد فرستاد.","diplomacy",{report:id});
    else await notifyPlayer(target,"⚔️ "+from+" وضعیت جنگ با کشور شما را اعلام کرد.","diplomacy",{report:id});
    return res.json({ok:true,id});
  }
  if(action==="respond"){
    const relationId=Number(req.body?.relation_id),decision=req.body?.decision;
    if(!Number.isSafeInteger(relationId)||!["accept","reject","peace"].includes(decision))return res.status(400).json({ok:false,error:"پاسخ دیپلماتیک معتبر نیست."});
    const relation=await pool.query("SELECT * FROM diplomacy WHERE id=$1 AND to_id=$2 AND status IN ('pending','active')",[relationId,String(req.user.id)]);
    if(!relation.rowCount)return res.status(404).json({ok:false,error:"درخواست فعال پیدا نشد."});
    const r=relation.rows[0];
    if(r.kind==="alliance"&&r.status==="pending"){
      const status=decision==="accept"?"active":"rejected";
      await pool.query("UPDATE diplomacy SET status=$1,updated_at=NOW() WHERE id=$2",[status,relationId]);
      const msg=decision==="accept"?"🤝 اتحاد رسمی دو کشور پذیرفته شد.":"📨 پیشنهاد اتحاد رد شد.";
      await publishWorldEvent(msg,"diplomacy",{report:relationId});
      await notifyPlayer(r.from_id,msg,"diplomacy",{report:relationId});
      return res.json({ok:true});
    }
    if(r.kind==="war"&&decision==="peace"){
      await pool.query("UPDATE diplomacy SET status='ended',updated_at=NOW() WHERE id=$1",[relationId]);
      const msg="🕊️ دو کشور به آتش‌بس رسیدند و وضعیت جنگ پایان یافت.";
      await publishWorldEvent(msg,"diplomacy",{report:relationId});
      await notifyPlayer(r.from_id,msg,"diplomacy",{report:relationId});
      return res.json({ok:true});
    }
    return res.status(400).json({ok:false,error:"این پاسخ برای این وضعیت مناسب نیست."});
  }
  res.status(400).json({ok:false,error:"فرمان دیپلماتیک ناشناخته است."});
});

app.get("/api/players",auth,async(req,res)=>{
  await ensurePlayer(req.user);
  const q=await pool.query("SELECT telegram_id,first_name,username,country_name,country_code,country_flag FROM players WHERE country_code IS NOT NULL AND telegram_id<>$1 ORDER BY first_name LIMIT 300",[String(req.user.id)]);
  res.json({ok:true,players:q.rows});
});
app.get("/api/announcements",auth,async(req,res)=>{
  const q=await pool.query("SELECT a.id,a.telegram_id,a.caption,a.image_data,a.created_at,p.first_name,p.country_name FROM announcements a JOIN players p ON p.telegram_id=a.telegram_id ORDER BY a.id DESC LIMIT 40");
  res.json({ok:true,items:q.rows});
});
app.post("/api/announcements/:id/delete",auth,ownerOnly,async(req,res)=>{
  const id=String(req.params.id||"");
  if(!/^\d+$/.test(id))return res.status(400).json({ok:false,error:"شناسه بیانیه معتبر نیست."});
  const q=await pool.query("DELETE FROM announcements WHERE id=$1 RETURNING id",[id]);
  if(!q.rowCount)return res.status(404).json({ok:false,error:"بیانیه پیدا نشد."});
  res.json({ok:true,id:q.rows[0].id});
});
app.post("/api/announcements",auth,async(req,res)=>{
  const caption=String(req.body?.caption||"").trim(), image=String(req.body?.image||"");
  if(!image.startsWith("data:image/")||image.length>6100000)return res.status(400).json({ok:false,error:"عکس معتبر نیست یا حجمش زیاده (حداکثر حدود 4 مگابایت)."});
  if(caption.length>1200)return res.status(400).json({ok:false,error:"متن بیانیه خیلی طولانیه."});
  const q=await pool.query("INSERT INTO announcements(telegram_id,caption,image_data) VALUES($1,$2,$3) RETURNING id",[String(req.user.id),caption,image]);
  const author=await pool.query("SELECT country_name,first_name,country_flag FROM players WHERE telegram_id=$1",[String(req.user.id)]);
  await publishWorldEvent("📣 "+(author.rows[0]?.country_flag?String.fromCodePoint(127397+author.rows[0].country_flag.charCodeAt(0),127397+author.rows[0].country_flag.charCodeAt(1))+" ":"🌍 ")+(author.rows[0]?.country_name||author.rows[0]?.first_name)+" بیانیه تازه‌ای منتشر کرد، فرمانده.","announcements",{report:q.rows[0].id});
  res.json({ok:true,id:q.rows[0].id});
});
app.get("/api/groups",auth,async(req,res)=>{
  const q=await pool.query("SELECT g.id,g.name,g.owner_id,(SELECT COUNT(*)::int FROM group_members gm WHERE gm.group_id=g.id) AS members FROM game_groups g JOIN group_members m ON m.group_id=g.id WHERE m.telegram_id=$1 ORDER BY g.id DESC",[String(req.user.id)]);
  res.json({ok:true,groups:q.rows});
});
app.post("/api/groups",auth,async(req,res)=>{
  const name=String(req.body?.name||"").trim();
  if(name.length<2||name.length>48)return res.status(400).json({ok:false,error:"نام گروه باید بین ۲ تا ۴۸ کاراکتر باشه."});
  const client=await pool.connect();
  try{await client.query("BEGIN");const g=await client.query("INSERT INTO game_groups(name,owner_id) VALUES($1,$2) RETURNING id,name,owner_id",[name,String(req.user.id)]);await client.query("INSERT INTO group_members(group_id,telegram_id) VALUES($1,$2)",[g.rows[0].id,String(req.user.id)]);await client.query("COMMIT");res.json({ok:true,group:g.rows[0]})}catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
});
app.post("/api/groups/:id/members",auth,async(req,res)=>{
  const id=Number(req.params.id), target=String(req.body?.telegram_id||"");
  if(!Number.isSafeInteger(id)||id<=0||!target||target===String(req.user.id))return res.status(400).json({ok:false,error:"بازیکن یا گروه معتبر نیست."});
  const g=await pool.query("SELECT owner_id,name FROM game_groups WHERE id=$1",[id]);
  if(!g.rowCount)return res.status(404).json({ok:false,error:"گروه پیدا نشد."});
  if(String(g.rows[0].owner_id)!==String(req.user.id))return res.status(403).json({ok:false,error:"فقط سازنده گروه می‌تونه دعوت بفرسته."});
  const p=await pool.query("SELECT telegram_id FROM players WHERE telegram_id=$1 AND country_code IS NOT NULL",[target]);
  if(!p.rowCount)return res.status(404).json({ok:false,error:"بازیکن پیدا نشد."});
  const member=await pool.query("SELECT 1 FROM group_members WHERE group_id=$1 AND telegram_id=$2",[id,target]);
  if(member.rowCount)return res.status(409).json({ok:false,error:"این بازیکن از قبل عضو گروهه."});
  const pending=await pool.query("SELECT id FROM group_invitations WHERE group_id=$1 AND telegram_id=$2 AND status='pending'",[id,target]);
  if(pending.rowCount)return res.status(409).json({ok:false,error:"درخواست این بازیکن قبلاً ارسال شده و هنوز پاسخ نداده."});
  const invitation=await pool.query("INSERT INTO group_invitations(group_id,telegram_id,invited_by) VALUES($1,$2,$3) RETURNING id",[id,target,String(req.user.id)]);
  const inviter=await pool.query("SELECT country_name,first_name FROM players WHERE telegram_id=$1",[String(req.user.id)]);
  await notifyPlayer(target,"👥 "+(inviter.rows[0]?.country_name||inviter.rows[0]?.first_name)+" تو را به گروه «"+g.rows[0].name+"» دعوت کرده. از بخش ارتباطات درخواست رو قبول یا رد کن.","groups",{group:id});
  res.json({ok:true,invitation_id:invitation.rows[0].id});
});
app.get("/api/group-invitations",auth,async(req,res)=>{
  const q=await pool.query("SELECT i.id,i.group_id,i.created_at,g.name AS group_name,p.first_name AS inviter_name,p.country_name AS inviter_country FROM group_invitations i JOIN game_groups g ON g.id=i.group_id JOIN players p ON p.telegram_id=i.invited_by WHERE i.telegram_id=$1 AND i.status='pending' ORDER BY i.created_at DESC",[String(req.user.id)]);
  res.json({ok:true,invitations:q.rows});
});
app.post("/api/group-invitations/:id/respond",auth,async(req,res)=>{
  const invitationId=Number(req.params.id), action=String(req.body?.action||"");
  if(!Number.isSafeInteger(invitationId)||invitationId<=0||!["accept","reject"].includes(action))return res.status(400).json({ok:false,error:"درخواست یا پاسخ معتبر نیست."});
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const q=await client.query("SELECT id,group_id,telegram_id,status FROM group_invitations WHERE id=$1 FOR UPDATE",[invitationId]);
    if(!q.rowCount){await client.query("ROLLBACK");return res.status(404).json({ok:false,error:"درخواست پیدا نشد."})}
    const inv=q.rows[0];
    if(String(inv.telegram_id)!==String(req.user.id)){await client.query("ROLLBACK");return res.status(403).json({ok:false,error:"این درخواست برای حساب تو نیست."})}
    if(inv.status!=="pending"){await client.query("ROLLBACK");return res.status(409).json({ok:false,error:"این درخواست قبلاً پاسخ داده شده."})}
    if(action==="accept"){
      await client.query("INSERT INTO group_members(group_id,telegram_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[inv.group_id,String(req.user.id)]);
      await client.query("UPDATE group_invitations SET status='accepted',responded_at=NOW() WHERE id=$1",[invitationId]);
    }else{
      await client.query("UPDATE group_invitations SET status='rejected',responded_at=NOW() WHERE id=$1",[invitationId]);
    }
    await client.query("COMMIT");
    res.json({ok:true,accepted:action==="accept",group_id:inv.group_id});
  }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
});
app.get("/api/groups/:id/manage",auth,async(req,res)=>{
  const id=Number(req.params.id),uid=String(req.user.id);
  if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({ok:false,error:"گروه معتبر نیست."});
  const g=await pool.query("SELECT id,name,owner_id FROM game_groups WHERE id=$1",[id]);
  if(!g.rowCount)return res.status(404).json({ok:false,error:"گروه پیدا نشد."});
  const mem=await pool.query("SELECT 1 FROM group_members WHERE group_id=$1 AND telegram_id=$2",[id,uid]);
  if(!mem.rowCount)return res.status(403).json({ok:false,error:"عضو گروه نیستی."});
  const owner=String(g.rows[0].owner_id)===uid;
  const adm=await pool.query("SELECT 1 FROM group_admins WHERE group_id=$1 AND telegram_id=$2",[id,uid]);
  const members=await pool.query("SELECT p.telegram_id,p.first_name,p.country_name,p.country_flag,(p.telegram_id=g.owner_id) AS is_owner,EXISTS(SELECT 1 FROM group_admins a WHERE a.group_id=g.id AND a.telegram_id=p.telegram_id) AS is_admin FROM group_members m JOIN players p ON p.telegram_id=m.telegram_id JOIN game_groups g ON g.id=m.group_id WHERE m.group_id=$1 ORDER BY is_owner DESC,is_admin DESC,p.first_name",[id]);
  res.json({ok:true,group:g.rows[0],members:members.rows,is_owner:owner,is_admin:!!adm.rowCount});
});
app.post("/api/groups/:id/manage",auth,async(req,res)=>{
  const id=Number(req.params.id),uid=String(req.user.id),action=String(req.body?.action||""),target=String(req.body?.telegram_id||"");
  if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({ok:false,error:"گروه معتبر نیست."});
  const c=await pool.connect();
  try{
    await c.query("BEGIN");
    const q=await c.query("SELECT id,name,owner_id FROM game_groups WHERE id=$1 FOR UPDATE",[id]);
    if(!q.rowCount){await c.query("ROLLBACK");return res.status(404).json({ok:false,error:"گروه پیدا نشد."})}
    const owner=String(q.rows[0].owner_id)===uid;
    const mem=await c.query("SELECT 1 FROM group_members WHERE group_id=$1 AND telegram_id=$2",[id,uid]);
    const adm=await c.query("SELECT 1 FROM group_admins WHERE group_id=$1 AND telegram_id=$2",[id,uid]);
    if(!mem.rowCount){await c.query("ROLLBACK");return res.status(403).json({ok:false,error:"عضو گروه نیستی."})}
    if(action==="rename"){
      const name=String(req.body?.name||"").trim();
      if(!owner||name.length<2||name.length>48){await c.query("ROLLBACK");return res.status(owner?400:403).json({ok:false,error:owner?"نام گروه باید ۲ تا ۴۸ کاراکتر باشد.":"فقط مالک می‌تواند نام گروه را تغییر دهد."})}
      await c.query("UPDATE game_groups SET name=$1 WHERE id=$2",[name,id]);
    }else if(action==="delete"){
      if(!owner){await c.query("ROLLBACK");return res.status(403).json({ok:false,error:"فقط مالک می‌تواند گروه را حذف کند."})}
      await c.query("DELETE FROM game_groups WHERE id=$1",[id]);
    }else if(action==="transfer"){
      if(!owner||!target||target===uid){await c.query("ROLLBACK");return res.status(403).json({ok:false,error:"فقط مالک می‌تواند مالکیت را منتقل کند."})}
      const m=await c.query("SELECT 1 FROM group_members WHERE group_id=$1 AND telegram_id=$2",[id,target]);
      if(!m.rowCount){await c.query("ROLLBACK");return res.status(400).json({ok:false,error:"مالک جدید باید عضو گروه باشد."})}
      await c.query("UPDATE game_groups SET owner_id=$1 WHERE id=$2",[target,id]);
      await c.query("DELETE FROM group_admins WHERE group_id=$1 AND telegram_id=$2",[id,target]);
    }else if(["promote","demote","kick"].includes(action)){
      if(!owner&&!adm.rowCount){await c.query("ROLLBACK");return res.status(403).json({ok:false,error:"اجازه مدیریت اعضا را نداری."})}
      if(!target||target===String(q.rows[0].owner_id)||target===uid){await c.query("ROLLBACK");return res.status(400).json({ok:false,error:"این عضو قابل تغییر نیست."})}
      const m=await c.query("SELECT 1 FROM group_members WHERE group_id=$1 AND telegram_id=$2",[id,target]);
      if(!m.rowCount){await c.query("ROLLBACK");return res.status(404).json({ok:false,error:"عضو پیدا نشد."})}
      const ta=await c.query("SELECT 1 FROM group_admins WHERE group_id=$1 AND telegram_id=$2",[id,target]);
      if(action==="promote"){if(!owner){await c.query("ROLLBACK");return res.status(403).json({ok:false,error:"فقط مالک می‌تواند مدیر تعیین کند."})}await c.query("INSERT INTO group_admins(group_id,telegram_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[id,target])}
      if(action==="demote"){if(!owner){await c.query("ROLLBACK");return res.status(403).json({ok:false,error:"فقط مالک می‌تواند مدیر را عزل کند."})}await c.query("DELETE FROM group_admins WHERE group_id=$1 AND telegram_id=$2",[id,target])}
      if(action==="kick"){if(ta.rowCount&&!owner){await c.query("ROLLBACK");return res.status(403).json({ok:false,error:"مدیر فقط توسط مالک قابل حذف است."})}await c.query("DELETE FROM group_members WHERE group_id=$1 AND telegram_id=$2",[id,target]);await c.query("DELETE FROM group_admins WHERE group_id=$1 AND telegram_id=$2",[id,target])}
    }else if(action==="leave"){
      if(owner){await c.query("ROLLBACK");return res.status(400).json({ok:false,error:"ابتدا مالکیت را منتقل کن یا گروه را حذف کن."})}
      await c.query("DELETE FROM group_members WHERE group_id=$1 AND telegram_id=$2",[id,uid]);
      await c.query("DELETE FROM group_admins WHERE group_id=$1 AND telegram_id=$2",[id,uid]);
    }else{await c.query("ROLLBACK");return res.status(400).json({ok:false,error:"عملیات نامعتبر است."})}
    await c.query("COMMIT");res.json({ok:true,deleted:action==="delete",left:action==="leave"});
  }catch(e){await c.query("ROLLBACK");throw e}finally{c.release()}
});
app.post("/api/groups/:id/messages/:mid/action",auth,async(req,res)=>{
  const id=Number(req.params.id),mid=Number(req.params.mid),uid=String(req.user.id),action=String(req.body?.action||""),body=String(req.body?.body||"").trim();
  if(!Number.isSafeInteger(id)||!Number.isSafeInteger(mid)||!["edit","delete"].includes(action))return res.status(400).json({ok:false,error:"درخواست معتبر نیست."});
  if(action==="edit"&&(!body||body.length>2000))return res.status(400).json({ok:false,error:"متن پیام معتبر نیست."});
  const g=await pool.query("SELECT owner_id FROM game_groups WHERE id=$1",[id]);if(!g.rowCount)return res.status(404).json({ok:false,error:"گروه پیدا نشد."});
  const mm=await pool.query("SELECT 1 FROM group_members WHERE group_id=$1 AND telegram_id=$2",[id,uid]);if(!mm.rowCount)return res.status(403).json({ok:false,error:"عضو گروه نیستی."});
  const a=await pool.query("SELECT 1 FROM group_admins WHERE group_id=$1 AND telegram_id=$2",[id,uid]);
  const m=await pool.query("SELECT telegram_id FROM group_messages WHERE id=$1 AND group_id=$2",[mid,id]);if(!m.rowCount)return res.status(404).json({ok:false,error:"پیام پیدا نشد."});
  if(String(m.rows[0].telegram_id)!==uid&&String(g.rows[0].owner_id)!==uid&&!a.rowCount)return res.status(403).json({ok:false,error:"فقط نویسنده یا مدیر گروه مجاز است."});
  if(action==="edit")await pool.query("UPDATE group_messages SET body=$1 WHERE id=$2",[body,mid]);else await pool.query("DELETE FROM group_messages WHERE id=$1",[mid]);
  res.json({ok:true});
});
app.post("/api/dm/:peer/:mid/action",auth,async(req,res)=>{
  const peer=String(req.params.peer),mid=Number(req.params.mid),uid=String(req.user.id),action=String(req.body?.action||""),body=String(req.body?.body||"").trim();
  if(!Number.isSafeInteger(mid)||!["edit","delete"].includes(action))return res.status(400).json({ok:false,error:"درخواست معتبر نیست."});
  if(action==="edit"&&(!body||body.length>2000))return res.status(400).json({ok:false,error:"متن پیام معتبر نیست."});
  const m=await pool.query("SELECT sender_id FROM direct_messages WHERE id=$1 AND ((sender_id=$2 AND receiver_id=$3) OR (sender_id=$3 AND receiver_id=$2))",[mid,uid,peer]);
  if(!m.rowCount)return res.status(404).json({ok:false,error:"پیام پیدا نشد."});
  if(String(m.rows[0].sender_id)!==uid)return res.status(403).json({ok:false,error:"فقط فرستنده می‌تواند پیام خودش را ویرایش یا حذف کند."});
  if(action==="edit")await pool.query("UPDATE direct_messages SET body=$1 WHERE id=$2",[body,mid]);else await pool.query("DELETE FROM direct_messages WHERE id=$1",[mid]);
  res.json({ok:true});
});
app.get("/api/groups/:id/messages",auth,async(req,res)=>{
  const id=Number(req.params.id), member=await pool.query("SELECT 1 FROM group_members WHERE group_id=$1 AND telegram_id=$2",[id,String(req.user.id)]);
  if(!member.rowCount)return res.status(403).json({ok:false,error:"عضو این گروه نیستی."});
  const q=await pool.query("SELECT m.id,m.telegram_id,m.body,m.created_at,p.first_name FROM group_messages m JOIN players p ON p.telegram_id=m.telegram_id WHERE m.group_id=$1 ORDER BY m.id DESC LIMIT 80",[id]);
  res.json({ok:true,messages:q.rows.reverse()});
});
app.post("/api/groups/:id/messages",auth,async(req,res)=>{
  const id=Number(req.params.id), body=String(req.body?.body||"").trim();
  if(!body||body.length>2000)return res.status(400).json({ok:false,error:"پیام خالی یا بیش از حد طولانیه."});
  const member=await pool.query("SELECT 1 FROM group_members WHERE group_id=$1 AND telegram_id=$2",[id,String(req.user.id)]);
  if(!member.rowCount)return res.status(403).json({ok:false,error:"عضو این گروه نیستی."});
  await pool.query("INSERT INTO group_messages(group_id,telegram_id,body) VALUES($1,$2,$3)",[id,String(req.user.id),body]);
  const recipients=await pool.query("SELECT p.chat_id,g.name FROM group_members gm JOIN players p ON p.telegram_id=gm.telegram_id JOIN game_groups g ON g.id=gm.group_id WHERE gm.group_id=$1 AND gm.telegram_id<>$2 AND p.chat_id IS NOT NULL",[id,String(req.user.id)]);
  await Promise.allSettled(recipients.rows.map(p=>telegramApi("sendMessage",{chat_id:p.chat_id,text:"💬 در گروه «"+p.name+"» پیام تازه‌ای دریافت کردی.",reply_markup:{inline_keyboard:[[{text:"نمایش گزارش",web_app:{url:APP_LINK("groups",{group:id})}}]]}})));
  res.json({ok:true});
});
app.get("/api/dm/:id",auth,async(req,res)=>{
  const other=String(req.params.id);
  const q=await pool.query("SELECT d.id,d.sender_id,d.receiver_id,d.body,d.created_at,p.first_name FROM direct_messages d JOIN players p ON p.telegram_id=d.sender_id WHERE (d.sender_id=$1 AND d.receiver_id=$2) OR (d.sender_id=$2 AND d.receiver_id=$1) ORDER BY d.id DESC LIMIT 80",[String(req.user.id),other]);
  res.json({ok:true,messages:q.rows.reverse()});
});
app.post("/api/dm/:id",auth,async(req,res)=>{
  const other=String(req.params.id),body=String(req.body?.body||"").trim();
  if(!body||body.length>2000)return res.status(400).json({ok:false,error:"پیام خالی یا خیلی طولانیه."});
  if(other===String(req.user.id))return res.status(400).json({ok:false,error:"نمی‌تونی به خودت پیام بدی."});
  const p=await pool.query("SELECT 1 FROM players WHERE telegram_id=$1 AND country_code IS NOT NULL",[other]);
  if(!p.rowCount)return res.status(404).json({ok:false,error:"بازیکن پیدا نشد."});
  await pool.query("INSERT INTO direct_messages(sender_id,receiver_id,body) VALUES($1,$2,$3)",[String(req.user.id),other,body]);
  const sender=await pool.query("SELECT country_name,first_name FROM players WHERE telegram_id=$1",[String(req.user.id)]);
  await notifyPlayer(other,"✉️ "+(sender.rows[0]?.country_name||sender.rows[0]?.first_name||"یک فرمانده")+" برایت پیام خصوصی فرستاد.","private",{peer:req.user.id});
  res.json({ok:true});
});
app.get("/api/shop",auth,async(req,res)=>{
  res.set("Cache-Control","no-store").json({ok:true,items:[
    {id:"oil",name:"نفت",icon:"🛢️",amount:100,price:1000,incomeBonus:0},
    {id:"steel",name:"فولاد",icon:"🔩",amount:100,price:14000,incomeBonus:0},
    {id:"food",name:"غذا",icon:"🌾",amount:250,price:9000,incomeBonus:0},
    {id:"energy",name:"انرژی",icon:"⚡",amount:100,price:16000,incomeBonus:0},
    {id:"industry",name:"کارخانه",icon:"🏭",amount:1,price:120000,incomeBonus:0},
    {id:"agriculture",name:"مرکز کشاورزی",icon:"🚜",amount:1,price:85000,incomeBonus:0},
    {id:"technology",name:"مرکز فناوری",icon:"🧬",amount:1,price:180000,incomeBonus:0}
  ]});
});
app.post("/api/shop/buy",auth,async(req,res)=>{
  const catalog={oil:{price:1000,amount:100,column:"oil",incomeBonus:0},steel:{price:14000,amount:100,column:"steel",incomeBonus:0},food:{price:9000,amount:250,column:"food",incomeBonus:0},energy:{price:16000,amount:100,column:"energy",incomeBonus:0},industry:{price:120000,amount:1,column:"industry",incomeBonus:0},agriculture:{price:85000,amount:1,column:"agriculture",incomeBonus:0},technology:{price:180000,amount:1,column:"technology",incomeBonus:0}};
  const item=catalog[req.body?.item],rawQuantity=String(req.body?.quantity??"1");
  const quantityText=rawQuantity.replace(/[۰-۹]/g,d=>String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g,d=>String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[٬,\s]/g,"");
  if(!item)return res.status(400).json({ok:false,error:"کالای نامعتبر."});
  if(!/^\d+$/.test(quantityText))return res.status(400).json({ok:false,error:"تعداد خرید معتبر نیست."});
  let quantity;try{quantity=BigInt(quantityText)}catch{return res.status(400).json({ok:false,error:"تعداد خرید معتبر نیست."})}
  if(quantity<1n||quantity.toString().length>100000)
    return res.status(400).json({ok:false,error:"تعداد باید مثبت باشد و از ظرفیت پردازش درخواست بیشتر نشود."});
  const price=BigInt(item.price),amount=BigInt(item.amount),income=BigInt(item.incomeBonus);
  const totalPrice=(price*quantity).toString(),totalAmount=(amount*quantity).toString(),totalIncome=(income*quantity).toString();
  const q=await pool.query("UPDATE players SET coins=coins-$1::numeric,"+item.column+"="+item.column+"+$2::numeric,shop_income=shop_income+$3::numeric,updated_at=NOW() WHERE telegram_id=$4 AND country_code IS NOT NULL AND coins >= $1::numeric RETURNING coins::text AS coins",[totalPrice,totalAmount,totalIncome,String(req.user.id)]);
  if(!q.rowCount){
    const state=await pool.query("SELECT coins,country_code FROM players WHERE telegram_id=$1",[String(req.user.id)]);
    if(!state.rowCount||!state.rows[0].country_code)return res.status(400).json({ok:false,error:"اول باید کشور انتخاب کنی."});
    return res.status(400).json({ok:false,error:"پول کافی نداری."});
  }
  await pool.query("INSERT INTO transactions(telegram_id,kind,resource,amount) VALUES($1,'purchase',$2,$3::numeric)",[String(req.user.id),item.column,totalAmount]);
  res.set("Cache-Control","no-store").json({ok:true,coins:String(q.rows[0].coins),quantity:quantity.toString(),totalPrice,totalAmount,totalIncome});
});
app.post("/telegram/webhook",async(req,res)=>{
  if(WEBHOOK_SECRET && req.get("x-telegram-bot-api-secret-token")!==WEBHOOK_SECRET) return res.sendStatus(403);
  const m=req.body?.message;if(!m)return res.json({ok:true});
  const txt=m.text||"",chat=m.chat.id;
  if(m.from?.id) await pool.query("INSERT INTO players(telegram_id,username,first_name,chat_id) VALUES($1,$2,$3,$4) ON CONFLICT(telegram_id) DO UPDATE SET username=EXCLUDED.username,first_name=EXCLUDED.first_name,chat_id=EXCLUDED.chat_id,updated_at=NOW()",[String(m.from.id),m.from.username||"",m.from.first_name||"Commander",String(chat)]);
  if(txt.startsWith("/start") || txt.startsWith("/game")){
    const text="💥 به radinwar خوش اومدی فرمانده!\n\n🌍 اول یک کشور آزاد انتخاب کن؛ هر کشور فقط یک فرمانده داره و انتخابت قابل تغییر نیست.\n💰 با ۱۰ میلیون سرمایه شروع می‌کنی.\n🏗️ اقتصاد و زیرساختت رو توسعه بده.\n🤝 با فرمانده‌های دیگه گفت‌وگو و گروه تشکیل بده.\n📣 بیانیه منتشر کن و رویدادهای داخل بازی رو دنبال کن.\n\n📜 قوانین: احترام به بازیکن‌ها، ممنوعیت اسپم و جعل خبر واقعی، و رعایت مالکیت دائمی کشورها.";
    await telegramApi("sendMessage",{chat_id:chat,text,reply_markup:{inline_keyboard:[[{text:"🚀 ورود به بازی",web_app:{url:MINI_APP_URL}}]]}});
  } else if(txt.startsWith("/help")){
    await telegramApi("sendMessage",{chat_id:chat,text:"📘 راهنمای radinwar💥\n/start یا /game: ورود به بازی\nکشور: انتخاب دائمی یک کشور آزاد\nاقتصاد: خرید منابع و توسعه زیرساخت\nارتباطات: چت خصوصی و گروه‌ها\nبیانیه‌ها: انتشار پیام و تصویر\nبازار جهانی: رویدادهای داخل بازی\n/help: نمایش همین راهنما\n\nقوانین: احترام، عدم اسپم، عدم جعل خبر واقعی و رعایت انتخاب دائمی کشور.",reply_markup:{inline_keyboard:[[{text:"🌍 باز کردن Mini App",web_app:{url:MINI_APP_URL}}]]}});
  } else if(txt && !txt.startsWith("/") && String(m.from?.id)!==OWNER_ID){
    await telegramApi("sendMessage",{chat_id:OWNER_ID,text:"📩 پیام تازه به ربات از "+(m.from?.first_name||"کاربر")+" (@"+(m.from?.username||"بدون نام کاربری")+"):\n\n"+txt,reply_markup:{inline_keyboard:[[{text:"🌍 باز کردن بازی",web_app:{url:APP_LINK("market")}}]]}});
    await telegramApi("sendMessage",{chat_id:chat,text:"پیامت به مرکز فرماندهی رسید. 📡"});
  } else if(txt.startsWith("/about")){
    await telegramApi("sendMessage",{chat_id:chat,text:"💥 radinwar یک بازی استراتژیک آنلاین برای انتخاب کشور، مدیریت اقتصاد، ارتباط با فرمانده‌ها و رقابت در جهان شبیه‌سازی‌شده است.",reply_markup:{inline_keyboard:[[{text:"🚀 ورود به بازی",web_app:{url:MINI_APP_URL}}]]}});
  }
  res.json({ok:true});
});
app.use("/api",(req,res)=>res.status(404).set("Cache-Control","no-store").json({ok:false,error:"مسیر API پیدا نشد",path:req.originalUrl}));
app.get("*",(req,res)=>res.sendFile(process.cwd()+"/public/index.html"));
const port=process.env.PORT||3000;
initDb().then(()=>app.listen(port,async()=>{
  console.log("radinwar💥 online on "+port);
  await configureTelegramBot();
})).catch(e=>{console.error("Database initialization failed",e);process.exit(1)});
