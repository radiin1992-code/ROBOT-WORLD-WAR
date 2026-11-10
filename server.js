import express from "express";
import pg from "pg";
import crypto from "node:crypto";

const { Pool } = pg;
const app = express();
app.use(express.json({ limit: "7mb" }));
app.use(express.static("public"));
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : undefined, max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 });
const OWNER_ID = "1852348620";
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const PUBLIC_URL = process.env.RENDER_EXTERNAL_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? "https://" + process.env.RAILWAY_PUBLIC_DOMAIN : "");
const MINI_APP_URL = process.env.MINI_APP_URL || PUBLIC_URL;
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || "";
const APP_LINK = (view, extra={}) => { const u=new URL(MINI_APP_URL);u.searchParams.set("view",view);for(const [k,v] of Object.entries(extra))u.searchParams.set(k,String(v));return u.toString(); };
async function notifyPlayer(id,message,view,extra={}) { const q=await pool.query("SELECT chat_id FROM players WHERE telegram_id=$1 AND chat_id IS NOT NULL",[String(id)]); if(!q.rowCount)return; await telegramApi("sendMessage",{chat_id:q.rows[0].chat_id,text:message,reply_markup:{inline_keyboard:[[{text:"📄 نمایش گزارش",web_app:{url:APP_LINK(view,extra)}}]]}}); }
async function publishWorldEvent(message,view="market",extra={}) { const q=await pool.query("INSERT INTO world_news(message) VALUES($1) RETURNING id",[message]); const id=q.rows[0].id; const users=await pool.query("SELECT chat_id FROM players WHERE chat_id IS NOT NULL"); await Promise.allSettled(users.rows.map(p=>telegramApi("sendMessage",{chat_id:p.chat_id,text:"🌍 خبر تازه از بازار جهانی\n\n"+message,reply_markup:{inline_keyboard:[[{text:"📄 نمایش گزارش",web_app:{url:APP_LINK(view,{...extra,report:id})}}]]}}))); return id; }

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
  await Promise.all([
    telegramApi("setMyName", { name: "ROBOT WORLD WAR" }),
    telegramApi("setMyDescription", { description: "فرماندهی کشور خودت را به دست بگیر، اقتصاد بساز، با دیگر کشورها مذاکره کن و در نقشه زنده جهان رقابت کن." }),
    telegramApi("setMyShortDescription", { short_description: "بازی استراتژیک آنلاین مدیریت کشور و رقابت جهانی 🌍" }),
    telegramApi("setMyCommands", { commands: [
      { command: "start", description: "شروع بازی و ورود به نقشه جهان" },
      { command: "game", description: "نمایش دکمه ورود به بازی" },
      { command: "help", description: "راهنمای بازی و دستورها" },
      { command: "about", description: "درباره ROBOT WORLD WAR" }
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
      country_code TEXT UNIQUE, country_name TEXT,
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
  `);
  await pool.query("ALTER TABLE players ADD COLUMN IF NOT EXISTS energy_level INT NOT NULL DEFAULT 1");
  await pool.query("ALTER TABLE players ADD COLUMN IF NOT EXISTS chat_id BIGINT");
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
  if (!n.rows[0].n) await pool.query("INSERT INTO world_news(message) VALUES ($1),($2),($3)", ["شبکه جهانی ROBOT WORLD WAR راه‌اندازی شد.", "بازار جهانی آماده معامله است.", "فرماندهان جدید می‌توانند کشور خود را انتخاب کنند."]);
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
  await pool.query(`INSERT INTO players(telegram_id,username,first_name) VALUES($1,$2,$3)
    ON CONFLICT(telegram_id) DO UPDATE SET username=EXCLUDED.username,first_name=EXCLUDED.first_name,updated_at=NOW()`,
    [String(user.id),user.username||"",user.first_name||"Commander"]);
}
app.get("/health", async (_req,res)=>{ try { await pool.query("SELECT 1"); res.status(200).json({ok:true,service:"robot-world-war",database:"connected"}); } catch { res.status(503).json({ok:false,service:"robot-world-war",database:"disconnected"}); } });
app.get("/api/profile",auth,async(req,res)=>{
  await ensurePlayer(req.user);
  const q=await pool.query("SELECT * FROM players WHERE telegram_id=$1",[String(req.user.id)]);
  const p=q.rows[0]; p.income=Number(Math.max(0,(p.industry-1)*75+(p.agriculture-1)*45+(p.level-1)*30));p.gdp=Number(p.coins)*4;p.population=0;
  res.json({ok:true,profile:p});
});
app.get("/api/news",auth,async(_req,res)=>{const q=await pool.query("SELECT id,message FROM world_news ORDER BY id DESC LIMIT 60");res.json({ok:true,items:q.rows});});
app.get("/api/world",auth,async(_req,res)=>{
  const [claims,news]=await Promise.all([pool.query("SELECT country_code,telegram_id,country_name FROM players WHERE country_code IS NOT NULL"),pool.query("SELECT id,message FROM world_news ORDER BY id DESC LIMIT 40")]);
  const claimed={};for(const r of claims.rows)claimed[r.country_code]=r.country_name;
  res.json({ok:true,claimed,news:news.rows});
});
app.post("/api/select-country",auth,async(req,res)=>{
  const {code,name}=req.body||{};
  if(!/^[A-Z]{3}$/.test(code||"")||typeof name!=="string"||name.length>90)return res.status(400).json({ok:false,error:"کشور معتبر نیست"});
  const client=await pool.connect();
  try{await client.query("BEGIN");const own=await client.query("SELECT country_code FROM players WHERE telegram_id=$1 FOR UPDATE",[String(req.user.id)]);
    if(own.rows[0]?.country_code){await client.query("ROLLBACK");return res.status(409).json({ok:false,error:"شما قبلاً کشور انتخاب کرده‌ای."});}
    const taken=await client.query("SELECT telegram_id FROM players WHERE country_code=$1",[code]);
    if(taken.rowCount){await client.query("ROLLBACK");return res.status(409).json({ok:false,error:"این کشور قبلاً انتخاب شده است."});}
    await client.query("UPDATE players SET country_code=$1,country_name=$2,updated_at=NOW() WHERE telegram_id=$3",[code,name,String(req.user.id)]);
    await client.query("INSERT INTO world_news(message) VALUES($1)",[`کشور ${name} وارد رقابت جهانی شد.`]);await client.query("COMMIT");res.json({ok:true});
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
  res.json({ok:true});
});
async function ownerOnly(req,res,next){if(String(req.user.id)!==OWNER_ID)return res.status(403).json({ok:false,error:"دسترسی غیرمجاز"});next()}
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

app.get("/api/players",auth,async(req,res)=>{
  await ensurePlayer(req.user);
  const q=await pool.query("SELECT telegram_id,first_name,username,country_name,country_code FROM players WHERE country_code IS NOT NULL AND telegram_id<>$1 ORDER BY first_name LIMIT 300",[String(req.user.id)]);
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
  res.json({ok:true,coins:q.rows[0].coins});
});
app.post("/telegram/webhook",async(req,res)=>{
  if(WEBHOOK_SECRET && req.get("x-telegram-bot-api-secret-token")!==WEBHOOK_SECRET) return res.sendStatus(403);
  const m=req.body?.message;if(!m)return res.json({ok:true});
  const txt=m.text||"",chat=m.chat.id;
  if(txt.startsWith("/start") || txt.startsWith("/game")){
    const text="به مرکز فرماندهی ROBOT WORLD WAR خوش آمدی 🌍🤖\n\nکشورت را انتخاب کن، اقتصاد بساز و وارد رقابت جهانی شو.";
    await telegramApi("sendMessage",{chat_id:chat,text,reply_markup:{inline_keyboard:[[{text:"🚀 ورود به بازی",web_app:{url:MINI_APP_URL}}]]}});
  } else if(txt.startsWith("/help")){
    await telegramApi("sendMessage",{chat_id:chat,text:"راهنمای ROBOT WORLD WAR\n/start یا /game : ورود به بازی\n/about : درباره بازی\n/help : راهنما",reply_markup:{inline_keyboard:[[{text:"🌍 باز کردن Mini App",web_app:{url:MINI_APP_URL}}]]}});
  } else if(txt.startsWith("/about")){
    await telegramApi("sendMessage",{chat_id:chat,text:"ROBOT WORLD WAR یک بازی استراتژیک آنلاین با نقشه جهان، مدیریت اقتصاد و رقابت میان کشورهاست.",reply_markup:{inline_keyboard:[[{text:"🚀 ورود به بازی",web_app:{url:MINI_APP_URL}}]]}});
  }
  res.json({ok:true});
});
app.get("*",(req,res)=>res.sendFile(process.cwd()+"/public/index.html"));
const port=process.env.PORT||3000;
initDb().then(()=>app.listen(port,async()=>{
  console.log("ROBOT WORLD WAR online on "+port);
  await configureTelegramBot();
})).catch(e=>{console.error("Database initialization failed",e);process.exit(1)});
