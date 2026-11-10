const JSON_HEADERS={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:JSON_HEADERS})}
async function verifyTelegram(initData,token,maxAge=86400){
 if(!initData||!token)return null;
 const p=new URLSearchParams(initData),hash=p.get("hash");if(!hash)return null;p.delete("hash");
 const pairs=[...p.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+"="+v).join("\n");
 const enc=new TextEncoder(),secretKey=await crypto.subtle.importKey("raw",enc.encode("WebAppData"),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const secret=await crypto.subtle.sign("HMAC",secretKey,enc.encode(token));
 const key=await crypto.subtle.importKey("raw",secret,{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const sig=await crypto.subtle.sign("HMAC",key,enc.encode(pairs));
 const hex=[...new Uint8Array(sig)].map(b=>b.toString(16).padStart(2,"0")).join("");
 if(hex.length!==hash.length||![...hex].every((c,i)=>c===hash[i]))return null;
 const authDate=Number(p.get("auth_date"));if(!authDate||Date.now()/1000-authDate>maxAge)return null;
 try{return JSON.parse(p.get("user")||"null")}catch{return null}
}
async function telegram(env,method,payload){if(!env.BOT_TOKEN)return;await fetch("https://api.telegram.org/bot"+env.BOT_TOKEN+"/"+method,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)})}
async function handleApi(req,env){
 const url=new URL(req.url),initData=req.headers.get("x-telegram-init-data")||"";
 const user=await verifyTelegram(initData,env.BOT_TOKEN);
 if(!user)return json({ok:false,error:"تلگرام معتبر نیست. مینی‌اپ رو از داخل ربات باز کن."},401);
 if(req.method==="GET"&&url.pathname==="/api/profile"){
  let row=await env.DB.prepare("SELECT telegram_id,username,first_name,coins,level,wins,losses,selected_robot FROM players WHERE telegram_id=?").bind(user.id).first();
  if(!row){await env.DB.prepare("INSERT INTO players (telegram_id,username,first_name) VALUES (?,?,?)").bind(user.id,user.username||"",user.first_name||"Commander").run();row=await env.DB.prepare("SELECT telegram_id,username,first_name,coins,level,wins,losses,selected_robot FROM players WHERE telegram_id=?").bind(user.id).first()}
  return json({ok:true,profile:row});
 }
 if(req.method==="POST"&&url.pathname==="/api/select-robot"){
  const body=await req.json(),allowed=["aegis","volt","titan"];if(!allowed.includes(body.robot))return json({ok:false,error:"ربات نامعتبر"},400);
  await env.DB.prepare("INSERT INTO players (telegram_id,username,first_name,selected_robot) VALUES (?,?,?,?) ON CONFLICT(telegram_id) DO UPDATE SET selected_robot=excluded.selected_robot").bind(user.id,user.username||"",user.first_name||"Commander",body.robot).run();
  return json({ok:true,selected:body.robot});
 }
 if(req.method==="POST"&&url.pathname==="/api/result"){
  const body=await req.json();if(typeof body.win!=="boolean"||!["aegis","volt","titan"].includes(body.robot))return json({ok:false,error:"نتیجه نامعتبر"},400);
  const result=await env.DB.prepare("INSERT INTO battles (telegram_id,robot,result,rounds) VALUES (?,?,?,?)").bind(user.id,body.robot,body.win?"win":"loss",Math.max(1,Math.min(100,Number(body.rounds)||1))).run();
  await env.DB.prepare("INSERT INTO players (telegram_id,username,first_name,coins,wins,losses) VALUES (?,?,?,?,?,?) ON CONFLICT(telegram_id) DO UPDATE SET coins=players.coins+excluded.coins,wins=players.wins+excluded.wins,losses=players.losses+excluded.losses").bind(user.id,user.username||"",user.first_name||"Commander",body.win?50:0,body.win?1:0,body.win?0:1).run();
  return json({ok:true,reward:body.win?50:0});
 }
 return json({ok:false,error:"مسیر پیدا نشد"},404);
}
async function handleTelegram(req,env){
 const update=await req.json();
 if(update.message){
  const m=update.message,chatId=m.chat.id,text=m.text||"";
  if(text.startsWith("/start")){
   const url=env.MINI_APP_URL;
   if(url)await telegram(env,"sendMessage",{chat_id:chatId,text:"به مرکز فرماندهی جنگ ربات‌ها خوش اومدی 🤖\nبرای ورود به بازی دکمه زیر رو بزن.",reply_markup:{inline_keyboard:[[{text:"🚀 ورود به بازی",web_app:{url}}]]}});
   else await telegram(env,"sendMessage",{chat_id:chatId,text:"ربات فعاله، اما آدرس مینی‌اپ هنوز تنظیم نشده. مدیر باید MINI_APP_URL رو تنظیم کنه."});
  }else if(text==="/help"){await telegram(env,"sendMessage",{chat_id:chatId,text:"دستورها:\n/start شروع بازی\n/help راهنما"});}
 }
 return json({ok:true});
}
export default {async fetch(req,env){
 const url=new URL(req.url);
 if(url.pathname==="/telegram/webhook"&&req.method==="POST")return handleTelegram(req,env);
 if(url.pathname.startsWith("/api/"))return handleApi(req,env);
 if(url.pathname==="/health")return json({ok:true,service:"robot-world-war"});
 return env.ASSETS.fetch(req);
}};