import crypto from "node:crypto";

const TECH = [
  {id:"industry",name:"صنعت هوشمند",icon:"🏭",description:"درآمد پولی کشور را تقویت می‌کند",effect:"هر سطح: ۴٪ پول بیشتر از تولید ساختمان‌ها",max:5,cost:{coins:4500,steel:90},requires:null},
  {id:"energy",name:"شبکه انرژی",icon:"⚡",description:"تولید خالص انرژی کشور را افزایش می‌دهد",effect:"هر سطح: ۵٪ انرژی بیشتر",max:5,cost:{coins:3800,steel:70},requires:null},
  {id:"agriculture",name:"زیست‌فناوری کشاورزی",icon:"🌾",description:"بازده تولید غذا را بالا می‌برد",effect:"هر سطح: ۶٪ غذای بیشتر",max:5,cost:{coins:3500,food:80},requires:null},
  {id:"materials",name:"متالورژی پیشرفته",icon:"🔩",description:"تولید فولاد کشور را تقویت می‌کند",effect:"هر سطح: ۵٪ فولاد بیشتر",max:5,cost:{coins:5200,steel:100},requires:"industry"},
  {id:"intelligence",name:"اطلاعات راهبردی",icon:"🛰️",description:"شانس موفقیت مأموریت‌های اطلاعاتی بیشتر می‌شود",effect:"هر سطح: ۵ واحد درصد شانس موفقیت بیشتر",max:5,cost:{coins:6000,energy:80},requires:"industry"},
  {id:"logistics",name:"لجستیک ملی",icon:"🚚",description:"تولید منابع و درآمد کشور را بهینه می‌کند",effect:"هر سطح: ۲٪ افزایش پول، نفت، فولاد، غذا و انرژی",max:5,cost:{coins:7000,oil:90},requires:"energy"},
  {id:"military",name:"مهندسی رزمی",icon:"⚔️",description:"قدرت تهاجمی یگان‌های زمینی را افزایش می‌دهد",effect:"هر سطح: ۶٪ قدرت حمله بیشتر برای نیروهای زمینی",max:5,cost:{coins:8500,steel:140,oil:45},requires:"industry"},
  {id:"aviation",name:"فناوری هوانوردی",icon:"✈️",description:"قدرت تهاجمی یگان‌های هوایی را افزایش می‌دهد",effect:"هر سطح: ۷٪ قدرت حمله بیشتر برای نیروهای هوایی",max:5,cost:{coins:10500,steel:120,energy:100,oil:100},requires:"military"},
  {id:"defense",name:"سامانه‌های دفاعی",icon:"🛡️",description:"قدرت دفاعی ارتش را در برابر حمله افزایش می‌دهد",effect:"هر سطح: ۷٪ قدرت دفاع بیشتر هنگام دفاع از کشور",max:5,cost:{coins:9000,steel:160,energy:90},requires:"energy"}
];
const CITIES = ["پایتخت","شهر صنعتی","بندر ملی"];
const EVENTS = [
  {id:"industry",title:"هفتهٔ جهش صنعتی",icon:"🏭",description:"کارخانه‌ها و مراکز درآمدزایی این هفته ۲۰٪ بازده بیشتری دارند",bonus:"industry"},
  {id:"energy",title:"هفتهٔ انرژی پاک",icon:"⚡",description:"تولید برق همهٔ کشورها این هفته ۲۵٪ افزایش دارد",bonus:"energy"},
  {id:"food",title:"هفتهٔ برداشت بزرگ",icon:"🌾",description:"تولید غذا در سراسر جهان این هفته ۲۵٪ بیشتر است",bonus:"food"},
  {id:"materials",title:"هفتهٔ مواد پیشرفته",icon:"🔩",description:"تولید فولاد همهٔ کشورها این هفته ۲۵٪ افزایش دارد",bonus:"steel"}
];
export function getCurrentWorldEvent(now = new Date()) {
  const week = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 604800000);
  const event = EVENTS[((week % EVENTS.length) + EVENTS.length) % EVENTS.length];
  const start = new Date(Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 604800000) * 604800000);
  const end = new Date(start.getTime() + 604800000);
  return {...event,week_key:String(week),starts_at:start.toISOString(),ends_at:end.toISOString()};
}
export async function initWorldSystems(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS player_technologies (
      telegram_id BIGINT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE,
      tech_id TEXT NOT NULL, level INT NOT NULL DEFAULT 0,
      PRIMARY KEY(telegram_id,tech_id)
    );
    CREATE TABLE IF NOT EXISTS player_cities (
      id BIGSERIAL PRIMARY KEY, telegram_id BIGINT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE,
      city_name TEXT NOT NULL, city_type TEXT NOT NULL DEFAULT 'urban',
      level INT NOT NULL DEFAULT 1, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(telegram_id,city_name)
    );
    CREATE INDEX IF NOT EXISTS player_cities_owner_idx ON player_cities(telegram_id,id);
    CREATE TABLE IF NOT EXISTS player_market_listings (
      id BIGSERIAL PRIMARY KEY, seller_id BIGINT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE,
      resource TEXT NOT NULL CHECK(resource IN ('coins','oil','steel','food','energy')),
      amount NUMERIC NOT NULL CHECK(amount>0), price NUMERIC NOT NULL CHECK(price>0),
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','filled','cancelled')),
      buyer_id BIGINT REFERENCES players(telegram_id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS player_market_open_idx ON player_market_listings(status,created_at DESC);
    CREATE TABLE IF NOT EXISTS espionage_cooldowns (
      telegram_id BIGINT PRIMARY KEY REFERENCES players(telegram_id) ON DELETE CASCADE,
      available_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS espionage_reports (
      id BIGSERIAL PRIMARY KEY, attacker_id BIGINT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE,
      target_id BIGINT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE,
      success BOOLEAN NOT NULL, report JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS espionage_reports_owner_idx ON espionage_reports(attacker_id,id DESC);
    CREATE TABLE IF NOT EXISTS season_points (season_key TEXT NOT NULL, telegram_id BIGINT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE, points INT NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(season_key,telegram_id));
    CREATE TABLE IF NOT EXISTS season_claims (
      season_key TEXT NOT NULL, telegram_id BIGINT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE,
      milestone INT NOT NULL, claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(season_key,telegram_id,milestone)
    );
  `);
  await pool.query(`INSERT INTO player_cities(telegram_id,city_name,city_type)
    SELECT p.telegram_id, v.city_name, v.city_type
    FROM players p
    CROSS JOIN (VALUES ('پایتخت','capital'),('شهر صنعتی','industrial'),('بندر ملی','port')) v(city_name,city_type)
    WHERE p.country_code IS NOT NULL
    ON CONFLICT(telegram_id,city_name) DO NOTHING`);
}
export function getSeasonKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const year = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year,0,1));
  const week = Math.ceil((((d-yearStart)/86400000)+1)/7);
  return year + "-W" + String(week).padStart(2,"0");
}
function scoreFrom(row) { return Number(row.points||0); }
async function addSeasonPoints(client,telegramId,points) { await client.query("INSERT INTO season_points(season_key,telegram_id,points) VALUES($1,$2,$3) ON CONFLICT(season_key,telegram_id) DO UPDATE SET points=season_points.points+EXCLUDED.points,updated_at=NOW()",[getSeasonKey(),String(telegramId),points]); }
export function registerWorldSystems(app,{pool,auth,applyProduction}) {
  app.get("/api/command-center",auth,async(req,res)=>{
    const id=String(req.user.id);
    await applyProduction(id);
    await pool.query("INSERT INTO player_cities(telegram_id,city_name,city_type) VALUES($1,$2,$3),($1,$4,$5),($1,$6,$7) ON CONFLICT(telegram_id,city_name) DO NOTHING",[id,"پایتخت","capital","شهر صنعتی","industrial","بندر ملی","port"]);
    const [tech,cities,spy,player]=await Promise.all([
      pool.query("SELECT tech_id,level FROM player_technologies WHERE telegram_id=$1",[id]),
      pool.query("SELECT id,city_name,city_type,level FROM player_cities WHERE telegram_id=$1 ORDER BY id",[id]),
      pool.query("SELECT available_at FROM espionage_cooldowns WHERE telegram_id=$1",[id]),
      pool.query("SELECT coins,oil,steel,food,energy,wins,losses,level FROM players WHERE telegram_id=$1",[id])
    ]);
    const levels=Object.fromEntries(tech.rows.map(x=>[x.tech_id,Number(x.level)]));
    const seasonScore=await pool.query("SELECT points FROM season_points WHERE season_key=$1 AND telegram_id=$2",[getSeasonKey(),id]);
    const points=Number(seasonScore.rows[0]?.points||0);
    const event=getCurrentWorldEvent();
    const cooldown=spy.rows[0]?.available_at||null;
    res.json({ok:true,technologies:TECH.map(t=>({...t,level:levels[t.id]||0,locked:t.requires&&(levels[t.requires]||0)<1,activeEffect:(levels[t.id]||0)>0?("اثر فعلی: "+(t.id==="industry"?((levels[t.id]||0)*4)+"٪ پول بیشتر":t.id==="energy"?((levels[t.id]||0)*5)+"٪ انرژی بیشتر":t.id==="agriculture"?((levels[t.id]||0)*6)+"٪ غذا بیشتر":t.id==="materials"?((levels[t.id]||0)*5)+"٪ فولاد بیشتر":t.id==="intelligence"?((levels[t.id]||0)*5)+" واحد درصد شانس اطلاعاتی بیشتر":t.id==="logistics"?((levels[t.id]||0)*2)+"٪ بازده بیشتر همه منابع":t.id==="military"?((levels[t.id]||0)*6)+"٪ قدرت حمله زمینی":t.id==="aviation"?((levels[t.id]||0)*7)+"٪ قدرت حمله هوایی":((levels[t.id]||0)*7)+"٪ قدرت دفاعی")) :("با تحقیق فعال می‌شود: "+t.effect)})),cities:cities.rows,resources:player.rows[0],event,season:{key:getSeasonKey(),points,rank:null},spy:{available_at:cooldown,reports:(await pool.query("SELECT r.id,r.success,r.report,r.created_at,p.country_name AS target_country FROM espionage_reports r JOIN players p ON p.telegram_id=r.target_id WHERE r.attacker_id=$1 ORDER BY r.id DESC LIMIT 8",[id])).rows}});
  });
  app.post("/api/research",auth,async(req,res)=>{
    const tech=TECH.find(x=>x.id===String(req.body?.tech_id||""));
    if(!tech)return res.status(400).json({ok:false,error:"فناوری انتخاب‌شده معتبر نیست."});
    const id=String(req.user.id),client=await pool.connect();
    try{
      await client.query("BEGIN");
      const current=await client.query("SELECT level FROM player_technologies WHERE telegram_id=$1 AND tech_id=$2 FOR UPDATE",[id,tech.id]);
      const level=Number(current.rows[0]?.level||0);
      if(level>=tech.max) {await client.query("ROLLBACK");return res.status(400).json({ok:false,error:"این فناوری به حداکثر سطح رسیده است."});}
      if(tech.requires){const reqTech=await client.query("SELECT level FROM player_technologies WHERE telegram_id=$1 AND tech_id=$2",[id,tech.requires]);if(Number(reqTech.rows[0]?.level||0)<1){await client.query("ROLLBACK");return res.status(400).json({ok:false,error:"ابتدا فناوری پیش‌نیاز را تحقیق کن."});}}
      const multiplier=1+level*.65;
      const costs=Object.entries(tech.cost).map(([k,v])=>[k,Math.ceil(v*multiplier)]);
      const p=await client.query("SELECT coins,oil,steel,food,energy FROM players WHERE telegram_id=$1 FOR UPDATE",[id]);
      const insufficient=costs.find(([k,v])=>Number(p.rows[0][k])<v);
      if(insufficient){await client.query("ROLLBACK");return res.status(400).json({ok:false,error:"منابع کافی نیست؛ هزینهٔ ارتقای بعدی بیشتر می‌شود."});}
      for(const [k,v] of costs)await client.query("UPDATE players SET "+k+"="+k+"-$1::numeric WHERE telegram_id=$2",[String(v),id]);
      await client.query("INSERT INTO player_technologies(telegram_id,tech_id,level) VALUES($1,$2,1) ON CONFLICT(telegram_id,tech_id) DO UPDATE SET level=player_technologies.level+1",[id,tech.id]);
      await addSeasonPoints(client,id,20);
      await client.query("COMMIT");
      res.json({ok:true,level:level+1});
    }catch(e){await client.query("ROLLBACK");throw e}finally{client.release();}
  });
  app.post("/api/cities/upgrade",auth,async(req,res)=>{
    const cityId=Number(req.body?.city_id);
    if(!Number.isSafeInteger(cityId)||cityId<1)return res.status(400).json({ok:false,error:"شهر معتبر نیست."});
    const id=String(req.user.id),client=await pool.connect();
    try{
      await client.query("BEGIN");
      const c=await client.query("SELECT id,level FROM player_cities WHERE id=$1 AND telegram_id=$2 FOR UPDATE",[cityId,id]);
      if(!c.rowCount){await client.query("ROLLBACK");return res.status(404).json({ok:false,error:"این شهر متعلق به تو نیست."});}
      const level=Number(c.rows[0].level);
      if(level>=10){await client.query("ROLLBACK");return res.status(400).json({ok:false,error:"شهر به بالاترین سطح رسیده است."});}
      const coins=3000+level*4200,steel=35+level*25,food=45+level*20;
      const p=await client.query("UPDATE players SET coins=coins-$1,steel=steel-$2,food=food-$3 WHERE telegram_id=$4 AND coins>=$1 AND steel>=$2 AND food>=$3 RETURNING telegram_id",[coins,steel,food,id]);
      if(!p.rowCount){await client.query("ROLLBACK");return res.status(400).json({ok:false,error:"برای توسعهٔ شهر پول، فولاد یا غذا کافی نیست."});}
      await client.query("UPDATE player_cities SET level=level+1 WHERE id=$1",[cityId]);
      await addSeasonPoints(client,id,15);
      await client.query("COMMIT");
      res.json({ok:true,level:level+1,bonus:"افزایش بازده تولید ملی"});
    }catch(e){await client.query("ROLLBACK");throw e}finally{client.release();}
  });
  app.get("/api/player-market",auth,async(req,res)=>{
    const [listings,mine]=await Promise.all([
      pool.query(`SELECT l.id,l.resource,l.amount::text,l.price::text,l.created_at,p.country_name,p.country_flag,p.first_name
        FROM player_market_listings l JOIN players p ON p.telegram_id=l.seller_id
        WHERE l.status='open' AND l.seller_id<>$1 ORDER BY l.created_at DESC LIMIT 60`,[String(req.user.id)]),
      pool.query("SELECT id,resource,amount::text,price::text,status,created_at FROM player_market_listings WHERE seller_id=$1 ORDER BY id DESC LIMIT 20",[String(req.user.id)])
    ]);
    res.json({ok:true,listings:listings.rows,mine:mine.rows});
  });
  app.post("/api/player-market/list",auth,async(req,res)=>{
    const resource=String(req.body?.resource||""),amount=Number(req.body?.amount),price=Number(req.body?.price),allowed=["coins","oil","steel","food","energy"];
    if(!allowed.includes(resource)||!Number.isSafeInteger(amount)||amount<1||amount>1000000000||!Number.isSafeInteger(price)||price<1||price>1000000000)return res.status(400).json({ok:false,error:"نوع منبع، تعداد یا قیمت معتبر نیست."});
    if(resource==="coins"&&amount<100)return res.status(400).json({ok:false,error:"حداقل سفارش پول ۱۰۰ واحد است."});
    const id=String(req.user.id),client=await pool.connect();
    try{
      await client.query("BEGIN");
      const p=await client.query("UPDATE players SET "+resource+"="+resource+"-$1::numeric WHERE telegram_id=$2 AND "+resource+">=$1::numeric RETURNING telegram_id",[String(amount),id]);
      if(!p.rowCount){await client.query("ROLLBACK");return res.status(400).json({ok:false,error:"موجودی منبع برای ثبت سفارش کافی نیست."});}
      const created=await client.query("INSERT INTO player_market_listings(seller_id,resource,amount,price) VALUES($1,$2,$3,$4) RETURNING id",[id,resource,String(amount),String(price)]);
      await client.query("COMMIT");res.json({ok:true,id:created.rows[0].id});
    }catch(e){await client.query("ROLLBACK");throw e}finally{client.release();}
  });
  app.post("/api/player-market/buy",auth,async(req,res)=>{
    const listingId=Number(req.body?.listing_id);
    if(!Number.isSafeInteger(listingId)||listingId<1)return res.status(400).json({ok:false,error:"سفارش معتبر نیست."});
    const id=String(req.user.id),client=await pool.connect();
    try{
      await client.query("BEGIN");
      const l=await client.query("SELECT * FROM player_market_listings WHERE id=$1 AND status='open' FOR UPDATE",[listingId]);
      if(!l.rowCount){await client.query("ROLLBACK");return res.status(404).json({ok:false,error:"این سفارش دیگر در دسترس نیست."});}
      const item=l.rows[0];if(String(item.seller_id)===id){await client.query("ROLLBACK");return res.status(400).json({ok:false,error:"نمی‌توانی سفارش خودت را بخری."});}
      const fee=Math.max(1,Math.floor(Number(item.price)*.02)),sellerReceives=Number(item.price)-fee;
      const buyer=await client.query("UPDATE players SET coins=coins-$1::numeric,"+item.resource+"="+item.resource+"+$2::numeric WHERE telegram_id=$3 AND coins>=$1::numeric RETURNING telegram_id",[item.price,item.amount,id]);
      if(!buyer.rowCount){await client.query("ROLLBACK");return res.status(400).json({ok:false,error:"پول کافی برای خرید این سفارش نداری."});}
      await client.query("UPDATE players SET coins=coins+$1::numeric WHERE telegram_id=$2",[String(sellerReceives),String(item.seller_id)]);
      await client.query("UPDATE player_market_listings SET status='filled',buyer_id=$1,completed_at=NOW() WHERE id=$2",[id,listingId]);
      await addSeasonPoints(client,id,5);
      await client.query("COMMIT");res.json({ok:true,fee});
    }catch(e){await client.query("ROLLBACK");throw e}finally{client.release();}
  });
  app.post("/api/player-market/cancel",auth,async(req,res)=>{
    const listingId=Number(req.body?.listing_id),id=String(req.user.id),client=await pool.connect();
    if(!Number.isSafeInteger(listingId)||listingId<1)return res.status(400).json({ok:false,error:"شناسه سفارش معتبر نیست."});
    try{
      await client.query("BEGIN");
      const l=await client.query("SELECT * FROM player_market_listings WHERE id=$1 AND seller_id=$2 AND status='open' FOR UPDATE",[listingId,id]);
      if(!l.rowCount){await client.query("ROLLBACK");return res.status(404).json({ok:false,error:"سفارش باز پیدا نشد."});}
      await client.query("UPDATE players SET "+l.rows[0].resource+"="+l.rows[0].resource+"+$1::numeric WHERE telegram_id=$2",[l.rows[0].amount,id]);
      await client.query("UPDATE player_market_listings SET status='cancelled',completed_at=NOW() WHERE id=$1",[listingId]);
      await client.query("COMMIT");res.json({ok:true});
    }catch(e){await client.query("ROLLBACK");throw e}finally{client.release();}
  });
  app.post("/api/espionage/launch",auth,async(req,res)=>{
    const target=String(req.body?.target_id||""),id=String(req.user.id);
    if(!/^\d{5,20}$/.test(target)||target===id)return res.status(400).json({ok:false,error:"هدف اطلاعاتی معتبر نیست."});
    const client=await pool.connect();
    try{
      await client.query("BEGIN");
      await client.query("INSERT INTO espionage_cooldowns(telegram_id,available_at) VALUES($1,NOW()) ON CONFLICT(telegram_id) DO NOTHING",[id]); const ready=await client.query("SELECT available_at FROM espionage_cooldowns WHERE telegram_id=$1 FOR UPDATE",[id]);
      if(ready.rowCount&&new Date(ready.rows[0].available_at)>new Date()){await client.query("ROLLBACK");return res.status(429).json({ok:false,error:"مأمور اطلاعاتی هنوز در حال آماده‌سازی است."});}
      const [attacker,targetPlayer,tech,cities]=await Promise.all([
        client.query("SELECT country_code FROM players WHERE telegram_id=$1 FOR UPDATE",[id]),
        client.query("SELECT telegram_id,country_name,coins,oil,steel,food,energy FROM players WHERE telegram_id=$1 FOR UPDATE",[target]),
        client.query("SELECT level FROM player_technologies WHERE telegram_id=$1 AND tech_id='intelligence'",[id]),
        client.query("SELECT COALESCE(SUM(level),0)::int AS total FROM player_cities WHERE telegram_id=$1",[target])
      ]);
      if(!attacker.rowCount||!targetPlayer.rowCount||!targetPlayer.rows[0].country_name){await client.query("ROLLBACK");return res.status(404).json({ok:false,error:"فرماندهٔ هدف پیدا نشد."});}
      const intelLevel=Number(tech.rows[0]?.level||0),defense=Number(cities.rows[0]?.total||0);
      const chance=Math.max(25,Math.min(85,58+intelLevel*5-defense*2));
      const success=crypto.randomInt(1,101)<=chance,report={target_country:targetPlayer.rows[0].country_name,success_chance:chance};
      if(success){
        const t=targetPlayer.rows[0],loot={};
        for(const resource of ["oil","steel","food","energy"]){const take=Math.floor(Number(t[resource])*.02);if(take>0){loot[resource]=take;await client.query("UPDATE players SET "+resource+"="+resource+"-$1::numeric WHERE telegram_id=$2",[String(take),target]);await client.query("UPDATE players SET "+resource+"="+resource+"+$1::numeric WHERE telegram_id=$2",[String(take),id]);}}
        report.intel={coins_band:Number(t.coins)<10000?"کم":Number(t.coins)<100000?"متوسط":"زیاد",resources:{oil:Number(t.oil),steel:Number(t.steel),food:Number(t.food),energy:Number(t.energy)},loot};
      }else report.alert="دفاع اطلاعاتی کشور هدف مأموریت را شناسایی کرد.";
      await client.query("INSERT INTO espionage_cooldowns(telegram_id,available_at) VALUES($1,NOW()+INTERVAL '60 minutes') ON CONFLICT(telegram_id) DO UPDATE SET available_at=EXCLUDED.available_at",[id]);
      const saved=await client.query("INSERT INTO espionage_reports(attacker_id,target_id,success,report) VALUES($1,$2,$3,$4::jsonb) RETURNING id",[id,target,success,JSON.stringify(report)]);
      if(success)await addSeasonPoints(client,id,10);
      await client.query("COMMIT");res.json({ok:true,success,report_id:saved.rows[0].id,report});
    }catch(e){await client.query("ROLLBACK");throw e}finally{client.release();}
  });
  app.get("/api/season",auth,async(req,res)=>{
    const key=getSeasonKey();
    const rows=await pool.query("SELECT p.telegram_id,p.first_name,p.country_name,p.country_flag,COALESCE(s.points,0)::int AS points FROM players p LEFT JOIN season_points s ON s.telegram_id=p.telegram_id AND s.season_key=$1 WHERE p.country_code IS NOT NULL ORDER BY s.points DESC NULLS LAST,s.updated_at ASC NULLS LAST LIMIT 50",[key]);
    const board=rows.rows.map((x,i)=>({rank:i+1,telegram_id:String(x.telegram_id),name:x.country_name||x.first_name,flag:x.country_flag,points:Number(x.points||0),is_me:String(x.telegram_id)===String(req.user.id)}));
    const mine=board.find(x=>x.is_me)||null;
    const claimed=(await pool.query("SELECT milestone FROM season_claims WHERE season_key=$1 AND telegram_id=$2",[key,String(req.user.id)])).rows.map(x=>Number(x.milestone));
    res.json({ok:true,season:key,board,mine,claimed,milestones:[{points:500,coins:5000,oil:50},{points:1500,coins:15000,steel:100},{points:3500,coins:35000,energy:150}]});
  });
  app.post("/api/season/claim",auth,async(req,res)=>{
    const milestone=Number(req.body?.milestone),rewards={500:{coins:5000,oil:50},1500:{coins:15000,steel:100},3500:{coins:35000,energy:150}};
    if(!rewards[milestone])return res.status(400).json({ok:false,error:"پاداش فصل معتبر نیست."});
    const id=String(req.user.id),key=getSeasonKey(),client=await pool.connect();
    try{
      await client.query("BEGIN");
      const score=await client.query("SELECT points FROM season_points WHERE season_key=$1 AND telegram_id=$2 FOR UPDATE",[key,id]);
      if(!score.rowCount||Number(score.rows[0].points)<milestone){await client.query("ROLLBACK");return res.status(400).json({ok:false,error:"امتیاز لازم برای این جایزه هنوز کامل نشده."});}
      const claim=await client.query("INSERT INTO season_claims(season_key,telegram_id,milestone) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING milestone",[key,id,milestone]);
      if(!claim.rowCount){await client.query("ROLLBACK");return res.status(409).json({ok:false,error:"این پاداش را قبلاً دریافت کرده‌ای."});}
      const r=rewards[milestone];
      await client.query("UPDATE players SET coins=coins+$1,oil=oil+$2,steel=steel+$3,energy=energy+$4 WHERE telegram_id=$5",[r.coins,r.oil||0,r.steel||0,r.energy||0,id]);
      await client.query("COMMIT");res.json({ok:true,reward:r});
    }catch(e){await client.query("ROLLBACK");throw e}finally{client.release();}
  });
}
