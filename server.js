import express from "express";
import pg from "pg";
import crypto from "node:crypto";

const { Pool } = pg;
const app = express();
app.use(express.json({ limit: "32kb" }));
app.use(express.static("public"));
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL?.includes("railway") || process.env.PGSSL === "true" ? { rejectUnauthorized: false } : undefined });
const OWNER_ID = "1852348620";
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const MINI_APP_URL = process.env.MINI_APP_URL || "";

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      telegram_id BIGINT PRIMARY KEY, username TEXT DEFAULT '', first_name TEXT DEFAULT 'Commander',
      coins BIGINT NOT NULL DEFAULT 12000, level INT NOT NULL DEFAULT 1,
      country_code TEXT UNIQUE, country_name TEXT,
      oil BIGINT NOT NULL DEFAULT 300, steel BIGINT NOT NULL DEFAULT 500,
      food BIGINT NOT NULL DEFAULT 900, energy BIGINT NOT NULL DEFAULT 400,
      technology INT NOT NULL DEFAULT 1, industry INT NOT NULL DEFAULT 1,
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
app.get("/health", async (_req,res)=>res.json({ok:true,service:"robot-world-war",database:"connected"}));
app.get("/api/profile",auth,async(req,res)=>{
  await ensurePlayer(req.user);
  const q=await pool.query("SELECT * FROM players WHERE telegram_id=$1",[String(req.user.id)]);
  const p=q.rows[0]; p.income=Number(120+ p.industry*75 + p.agriculture*45 + p.level*30);p.gdp=Number(p.coins)*4+p.industry*25000;p.population=Number(p.agriculture)*850000+p.industry*120000;
  res.json({ok:true,profile:p});
});
app.get("/api/world",auth,async(_req,res)=>{
  const [claims,news]=await Promise.all([pool.query("SELECT country_code,telegram_id,country_name FROM players WHERE country_code IS NOT NULL"),pool.query("SELECT message FROM world_news ORDER BY id DESC LIMIT 12")]);
  const claimed={};for(const r of claims.rows)claimed[r.country_code]=r.country_name;
  res.json({ok:true,claimed,news:news.rows.map(x=>x.message)});
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
  }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
});
app.post("/api/upgrade",auth,async(req,res)=>{
  const {kind}=req.body||{}, costs={industry:{coins:1800,steel:120},energy:{coins:1500,oil:80},technology:{coins:3000,steel:180},agriculture:{coins:1300,food:100}};
  if(!costs[kind])return res.status(400).json({ok:false,error:"ارتقای نامعتبر"});
  const c=costs[kind],col=kind;
  const q=await pool.query(`UPDATE players SET coins=coins-$1, ${col}=${col}+1, updated_at=NOW() WHERE telegram_id=$2 AND coins >= $1 AND ${Object.keys(c).filter(k=>k!=="coins").map(k=>k+" >= "+c[k]).join(" AND ")||"TRUE"} RETURNING telegram_id`,[c.coins,String(req.user.id)]);
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
app.post("/telegram/webhook",async(req,res)=>{
  const m=req.body?.message;if(!m)return res.json({ok:true});
  const txt=m.text||"",chat=m.chat.id;
  if(txt.startsWith("/start")){const text="به مرکز فرماندهی ROBOT WORLD WAR خوش آمدی 🌍🤖";
    const payload={chat_id:chat,text,reply_markup:{inline_keyboard:[[{text:"🚀 ورود به بازی",web_app:{url:MINI_APP_URL}}]]}};
    if(BOT_TOKEN&&MINI_APP_URL)await fetch("https://api.telegram.org/bot"+BOT_TOKEN+"/sendMessage",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
  }else if(txt==="/help"&&BOT_TOKEN){await fetch("https://api.telegram.org/bot"+BOT_TOKEN+"/sendMessage",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({chat_id:chat,text:"/start ورود به بازی"})})}
  res.json({ok:true});
});
app.get("*",(req,res)=>res.sendFile(process.cwd()+"/public/index.html"));
const port=process.env.PORT||3000;
initDb().then(()=>app.listen(port,()=>console.log("ROBOT WORLD WAR online on "+port))).catch(e=>{console.error("Database initialization failed",e);process.exit(1)});
