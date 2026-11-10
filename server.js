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
app.use(express.static("public"));
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : undefined, max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 });
const OWNER_ID = "1852348620";
const BUILD_VERSION = "rw-20261110-02";
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
      coins BIGINT NOT NULL DEFAULT 10000000, level INT NOT NULL DEFAULT 1,
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
      resource TEXT NOT NULL, amount BIGINT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

  `);
  await pool.query("ALTER TABLE players ADD COLUMN IF NOT EXISTS energy_level INT NOT NULL DEFAULT 1");
  await pool.query("ALTER TABLE players ADD COLUMN IF NOT EXISTS chat_id BIGINT");
  await pool.query("ALTER TABLE players ADD COLUMN IF NOT EXISTS country_flag TEXT");
  await pool.query("ALTER TABLE players ADD COLUMN IF NOT EXISTS production_at TIMESTAMPTZ NOT NULL DEFAULT NOW()");
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
    CREATE INDEX IF NOT EXISTS group_messages_group_id_id_idx ON group_messages(group_id,id);
    CREATE INDEX IF NOT EXISTS direct_messages_pair_idx ON direct_messages(sender_id,receiver_id,id);
    CREATE INDEX IF NOT EXISTS announcements_id_idx ON announcements(id DESC);
  `);
  await pool.query("ALTER TABLE players ALTER COLUMN coins SET DEFAULT 10000000");
  await pool.query("ALTER TABLE players ALTER COLUMN oil SET DEFAULT 0, ALTER COLUMN steel SET DEFAULT 0, ALTER COLUMN food SET DEFAULT 0, ALTER COLUMN energy SET DEFAULT 0");
  await pool.query("UPDATE players SET coins=10000000,oil=0,steel=0,food=0,energy=0 WHERE country_code IS NULL");

  const n = await pool.query("SELECT COUNT(*)::int AS n FROM world_news");
  if (!n.rows[0].n) await pool.query("INSERT INTO world_news(message) VALUES ($1),($2),($3)", ["شبکه جهانی radinwar💥 راه‌اندازی شد.", "بازار جهانی آماده معامله است.", "فرماندهان جدید می‌توانند کشور خود را انتخاب کنند."]);
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
  const military=await pool.query("SELECT COALESCE(SUM(m.quantity * CASE m.unit_type WHEN 'infantry' THEN 100 WHEN 'armor' THEN 180 WHEN 'air' THEN 260 WHEN 'navy' THEN 230 ELSE 0 END),0)::bigint AS power FROM military_units m WHERE m.telegram_id=$1",[String(req.user.id)]);
  p.military_power=Number(military.rows[0]?.power||0);
  p.income=Number(Math.max(0,(p.industry-1)*75+(p.agriculture-1)*45+(p.level-1)*30));p.gdp=Number(p.coins)*4;p.population=0;
  res.json({ok:true,profile:p});
});
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
  const {kind}=req.body||{}, costs={industry:{coins:1800,steel:120},energy:{coins:1500,oil:80},technology:{coins:3000,steel:180},agriculture:{coins:1300,food:100}};
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
  const commander=await pool.query("SELECT country_name,first_name FROM players WHERE telegram_id=$1",[String(req.user.id)]);
  await publishWorldEvent("🏗️ "+(commander.rows[0]?.country_name||commander.rows[0]?.first_name)+" یکی از زیرساخت‌های ملی خود را ارتقا داد.");
  res.json({ok:true});
});
async function ownerOnly(req,res,next){if(String(req.user.id)!==OWNER_ID)return res.status(403).json({ok:false,error:"دسترسی غیرمجاز"});next()}
app.post("/api/owner/release-country",auth,ownerOnly,async(req,res)=>{
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const current=await client.query("SELECT country_code,country_name FROM players WHERE telegram_id=$1 FOR UPDATE",[OWNER_ID]);
    if(!current.rowCount||!current.rows[0].country_code){await client.query("ROLLBACK");return res.status(409).json({ok:false,error:"در حال حاضر کشوری به حساب مالک وصل نیست."});}
    const released=current.rows[0];
    await client.query("UPDATE players SET country_code=NULL,country_name=NULL,country_flag='',updated_at=NOW() WHERE telegram_id=$1",[OWNER_ID]);
    await client.query("INSERT INTO admin_logs(owner_id,target_id,action,details) VALUES($1,$1,'release_own_country',$2)",[OWNER_ID,JSON.stringify({country_code:released.country_code,country_name:released.country_name})]);
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
  await pool.query("INSERT INTO admin_logs(owner_id,target_id,action,details) VALUES($1,$2,'add_money',$3)",[OWNER_ID,target,JSON.stringify({amount})]);
  await pool.query("INSERT INTO transactions(telegram_id,kind,resource,amount) VALUES($1,'admin','coins',$2)",[target,amount]);res.json({ok:true});
});
app.post("/api/owner/resource",auth,ownerOnly,async(req,res)=>{
  const target=String(req.body?.targetId||""),resource=req.body?.resource,amount=Number(req.body?.amount);
  if(!/^\d{5,20}$/.test(target)||!["oil","steel","food","energy"].includes(resource)||!Number.isSafeInteger(amount)||amount<1||amount>1000000000)return res.status(400).json({ok:false,error:"مقادیر نامعتبر"});
  const q=await pool.query(`UPDATE players SET ${resource}=${resource}+$1,updated_at=NOW() WHERE telegram_id=$2 RETURNING telegram_id`,[amount,target]);
  if(!q.rowCount)return res.status(404).json({ok:false,error:"بازیکن پیدا نشد"});
  await pool.query("INSERT INTO admin_logs(owner_id,target_id,action,details) VALUES($1,$2,'add_resource',$3)",[OWNER_ID,target,JSON.stringify({resource,amount})]);
  await pool.query("INSERT INTO transactions(telegram_id,kind,resource,amount) VALUES($1,'admin',$2,$3)",[target,resource,amount]);res.json({ok:true});
});


const UNIT_CATALOG = {
  infantry:{name:"نیروی زمینی",icon:"🪖",quantity:100,cost:{coins:260000,steel:25,food:70,energy:15,oil:0},power:100},
  armor:{name:"یگان زرهی",icon:"🛡️",quantity:10,cost:{coins:720000,steel:100,food:25,energy:45,oil:70},power:180},
  air:{name:"یگان هوایی",icon:"✈️",quantity:5,cost:{coins:1250000,steel:90,food:15,energy:100,oil:110},power:260},
  navy:{name:"ناوگان دریایی",icon:"🚢",quantity:3,cost:{coins:1100000,steel:140,food:20,energy:65,oil:95},power:230}
};
const BUILDING_CATALOG = {
  power:{name:"نیروگاه برق",icon:"⚡",cost:{coins:650000,steel:90,oil:35,energy:0},output:"هر ساعت ۳۰ برق"},
  refinery:{name:"پالایشگاه نفت",icon:"🛢️",cost:{coins:820000,steel:100,oil:0,energy:120},output:"هر ساعت ۱۲ نفت",needs:"نیروگاه سطح ۱"},
  steelworks:{name:"کارخانه فولاد",icon:"🏭",cost:{coins:950000,steel:60,oil:45,energy:150},output:"هر ساعت ۱۰ فولاد",needs:"نیروگاه سطح ۱"},
  farm:{name:"مزرعه صنعتی",icon:"🌾",cost:{coins:480000,steel:35,oil:0,energy:55},output:"هر ساعت ۱۸ غذا",needs:"نیروگاه سطح ۱"}
};
async function applyProduction(id){
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const p=await client.query("SELECT energy,oil,steel,food,production_at FROM players WHERE telegram_id=$1 FOR UPDATE",[String(id)]);
    if(!p.rowCount){await client.query("ROLLBACK");return}
    const b=await client.query("SELECT building_type,level FROM national_buildings WHERE telegram_id=$1",[String(id)]);
    const levels=Object.fromEntries(b.rows.map(x=>[x.building_type,Number(x.level)]));
    const hours=Math.max(0,Math.min(24,(Date.now()-new Date(p.rows[0].production_at).getTime())/3600000));
    if(hours>=0.02){
      let energy=Number(p.rows[0].energy),oil=Number(p.rows[0].oil),steel=Number(p.rows[0].steel),food=Number(p.rows[0].food);
      energy+=hours*(levels.power||0)*30;
      const refinery=Math.min(levels.refinery||0,Math.floor(energy/(hours*4||1)));
      const steelworks=Math.min(levels.steelworks||0,Math.floor(energy/(hours*6||1)));
      const farm=Math.min(levels.farm||0,Math.floor(energy/(hours*3||1)));
      const used=hours*(refinery*4+steelworks*6+farm*3);
      energy=Math.max(0,energy-used);
      oil+=hours*refinery*12;steel+=hours*steelworks*10;food+=hours*farm*18;
      await client.query("UPDATE players SET energy=$1,oil=$2,steel=$3,food=$4,production_at=NOW() WHERE telegram_id=$5",[Math.floor(energy),Math.floor(oil),Math.floor(steel),Math.floor(food),String(id)]);
    }
    await client.query("COMMIT");
  }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
}
app.get("/api/army",auth,async(req,res)=>{
  await applyProduction(req.user.id);
  const [p,u,b]=await Promise.all([
    pool.query("SELECT coins,oil,steel,food,energy FROM players WHERE telegram_id=$1",[String(req.user.id)]),
    pool.query("SELECT unit_type,quantity FROM military_units WHERE telegram_id=$1",[String(req.user.id)]),
    pool.query("SELECT building_type,level FROM national_buildings WHERE telegram_id=$1",[String(req.user.id)])
  ]);
  const units=Object.fromEntries(u.rows.map(x=>[x.unit_type,Number(x.quantity)]));
  const buildings=Object.fromEntries(b.rows.map(x=>[x.building_type,Number(x.level)]));
  res.json({ok:true,resources:p.rows[0],units,buildings,unitCatalog:UNIT_CATALOG,buildingCatalog:BUILDING_CATALOG});
});
app.post("/api/army/recruit",auth,async(req,res)=>{
  const type=req.body?.type,item=UNIT_CATALOG[type];if(!item)return res.status(400).json({ok:false,error:"نوع یگان معتبر نیست."});
  const c=item.cost,client=await pool.connect();
  try{
    await client.query("BEGIN");
    const q=await client.query("UPDATE players SET coins=coins-$1,steel=steel-$2,food=food-$3,energy=energy-$4,oil=oil-$5,updated_at=NOW() WHERE telegram_id=$6 AND country_code IS NOT NULL AND coins >= $1 AND steel >= $2 AND food >= $3 AND energy >= $4 AND oil >= $5 RETURNING telegram_id",
      [c.coins,c.steel,c.food,c.energy,c.oil,String(req.user.id)]);
    if(!q.rowCount){await client.query("ROLLBACK");return res.status(400).json({ok:false,error:"منابع کافی نیست. هزینه و موجودی منابع را بررسی کن."})}
    await client.query("INSERT INTO military_units(telegram_id,unit_type,quantity) VALUES($1,$2,$3) ON CONFLICT(telegram_id,unit_type) DO UPDATE SET quantity=military_units.quantity+EXCLUDED.quantity",[String(req.user.id),type,item.quantity]);
    await client.query("INSERT INTO transactions(telegram_id,kind,resource,amount) VALUES($1,'recruit',$2,$3)",[String(req.user.id),type,item.quantity]);
    await client.query("COMMIT");
    await publishWorldEvent("🛡️ "+item.name+" به ساختار دفاعی یک کشور اضافه شد.");
    res.json({ok:true});
  }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
});
app.post("/api/army/build",auth,async(req,res)=>{
  const type=req.body?.type,item=BUILDING_CATALOG[type];if(!item)return res.status(400).json({ok:false,error:"نوع زیرساخت معتبر نیست."});
  const client=await pool.connect(),c=item.cost;
  try{
    await client.query("BEGIN");
    const levels=await client.query("SELECT level FROM national_buildings WHERE telegram_id=$1 AND building_type='power'",[String(req.user.id)]);
    if(type!=="power"&&Number(levels.rows[0]?.level||0)<1){await client.query("ROLLBACK");return res.status(400).json({ok:false,error:"اول باید نیروگاه بسازی تا برق موردنیاز زیرساخت فراهم شود."})}
    const q=await client.query("UPDATE players SET coins=coins-$1,steel=steel-$2,oil=oil-$3,energy=energy-$4,updated_at=NOW() WHERE telegram_id=$5 AND country_code IS NOT NULL AND coins >= $1 AND steel >= $2 AND oil >= $3 AND energy >= $4 RETURNING telegram_id",[c.coins,c.steel,c.oil,c.energy,String(req.user.id)]);
    if(!q.rowCount){await client.query("ROLLBACK");return res.status(400).json({ok:false,error:"منابع لازم برای ساخت این زیرساخت کافی نیست."})}
    await client.query("INSERT INTO national_buildings(telegram_id,building_type,level) VALUES($1,$2,1) ON CONFLICT(telegram_id,building_type) DO UPDATE SET level=national_buildings.level+1",[String(req.user.id),type]);
    await client.query("COMMIT");
    const p=await pool.query("SELECT country_name FROM players WHERE telegram_id=$1",[String(req.user.id)]);
    await publishWorldEvent("🏗️ "+(p.rows[0]?.country_name||"یک کشور")+" زیرساخت «"+item.name+"» را توسعه داد.");
    res.json({ok:true});
  }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
});
app.get("/api/diplomacy",auth,async(req,res)=>{
  const id=String(req.user.id);
  const q=await pool.query(`SELECT d.id,d.from_id,d.to_id,d.kind,d.status,d.created_at,
    a.country_name AS from_country,a.country_flag AS from_flag,b.country_name AS to_country,b.country_flag AS to_flag
    FROM diplomacy d JOIN players a ON a.telegram_id=d.from_id JOIN players b ON b.telegram_id=d.to_id
    WHERE (d.from_id=$1 OR d.to_id=$1) AND d.status IN ('pending','active')
    ORDER BY d.id DESC LIMIT 100`,[id]);
  const p=await pool.query("SELECT telegram_id,country_name,country_flag FROM players WHERE country_code IS NOT NULL AND telegram_id<>$1 ORDER BY country_name",[id]);
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
  const g=await pool.query("SELECT owner_id FROM game_groups WHERE id=$1",[id]);
  if(!g.rowCount)return res.status(404).json({ok:false,error:"گروه پیدا نشد."});
  if(String(g.rows[0].owner_id)!==String(req.user.id))return res.status(403).json({ok:false,error:"فقط سازنده گروه می‌تونه عضو اضافه کنه."});
  const p=await pool.query("SELECT telegram_id FROM players WHERE telegram_id=$1 AND country_code IS NOT NULL",[target]);
  if(!p.rowCount)return res.status(404).json({ok:false,error:"بازیکن پیدا نشد."});
  await pool.query("INSERT INTO group_members(group_id,telegram_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[id,target]);
  const inviter=await pool.query("SELECT country_name,first_name FROM players WHERE telegram_id=$1",[String(req.user.id)]);
  await notifyPlayer(target,"👥 "+(inviter.rows[0]?.country_name||inviter.rows[0]?.first_name)+" تو را به یک گروه در radinwar💥 دعوت کرد.","groups",{group:id});
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
  res.json({ok:true,items:[
    {id:"oil",name:"نفت",icon:"🛢️",amount:100,price:180000},
    {id:"steel",name:"فولاد",icon:"🔩",amount:100,price:140000},
    {id:"food",name:"غذا",icon:"🌾",amount:250,price:90000},
    {id:"energy",name:"انرژی",icon:"⚡",amount:100,price:160000},
    {id:"industry",name:"کارخانه",icon:"🏭",amount:1,price:1200000},
    {id:"agriculture",name:"مرکز کشاورزی",icon:"🚜",amount:1,price:850000},
    {id:"technology",name:"مرکز فناوری",icon:"🧬",amount:1,price:1800000}
  ]});
});
app.post("/api/shop/buy",auth,async(req,res)=>{
  const catalog={oil:{price:180000,amount:100,column:"oil"},steel:{price:140000,amount:100,column:"steel"},food:{price:90000,amount:250,column:"food"},energy:{price:160000,amount:100,column:"energy"},industry:{price:1200000,amount:1,column:"industry"},agriculture:{price:850000,amount:1,column:"agriculture"},technology:{price:1800000,amount:1,column:"technology"}};
  const item=catalog[req.body?.item];if(!item)return res.status(400).json({ok:false,error:"کالای نامعتبر."});
  const q=await pool.query(`UPDATE players SET coins=coins-$1,${item.column}=${item.column}+$2,updated_at=NOW() WHERE telegram_id=$3 AND country_code IS NOT NULL AND coins >= $1 RETURNING coins`,[item.price,item.amount,String(req.user.id)]);
  if(!q.rowCount)return res.status(400).json({ok:false,error:"پول کافی نداری."});
  await pool.query("INSERT INTO transactions(telegram_id,kind,resource,amount) VALUES($1,'purchase',$2,$3)",[String(req.user.id),item.column,item.amount]);
  const buyer=await pool.query("SELECT country_name,first_name FROM players WHERE telegram_id=$1",[String(req.user.id)]);
  await publishWorldEvent("🏪 "+(buyer.rows[0]?.country_name||buyer.rows[0]?.first_name)+" از بازار جهانی "+item.amount+" واحد "+item.column+" خریداری کرد.");
  res.json({ok:true,coins:q.rows[0].coins});
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
  } else if(txt && !txt.startsWith("/") && String(from?.id)!==OWNER_ID){
    await telegramApi("sendMessage",{chat_id:OWNER_ID,text:"📩 پیام تازه به ربات از "+(from?.first_name||"کاربر")+" (@"+(from?.username||"بدون نام کاربری")+"):\n\n"+txt,reply_markup:{inline_keyboard:[[{text:"🌍 باز کردن بازی",web_app:{url:APP_LINK("market")}}]]}});
    await telegramApi("sendMessage",{chat_id:chat,text:"پیامت به مرکز فرماندهی رسید. 📡"});
  } else if(txt.startsWith("/about")){
    await telegramApi("sendMessage",{chat_id:chat,text:"💥 radinwar یک بازی استراتژیک آنلاین برای انتخاب کشور، مدیریت اقتصاد، ارتباط با فرمانده‌ها و رقابت در جهان شبیه‌سازی‌شده است.",reply_markup:{inline_keyboard:[[{text:"🚀 ورود به بازی",web_app:{url:MINI_APP_URL}}]]}});
  }
  res.json({ok:true});
});
app.get("*",(req,res)=>res.sendFile(process.cwd()+"/public/index.html"));
const port=process.env.PORT||3000;
initDb().then(()=>app.listen(port,async()=>{
  console.log("radinwar💥 online on "+port);
  await configureTelegramBot();
})).catch(e=>{console.error("Database initialization failed",e);process.exit(1)});
