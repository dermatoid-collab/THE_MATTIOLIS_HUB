export function googleMailUrl(env){try{const u=new URL(env.MAIL_GOOGLE_URL);return u.protocol==='https:'&&u.hostname==='script.google.com'&&/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(u.pathname)&&!u.search&&!u.hash&&!u.username&&!u.password&&!u.port?u.href:null;}catch{return null;}}
export const mailConfigured=env=>!!((googleMailUrl(env)&&typeof env.MAIL_GOOGLE_TOKEN==='string'&&env.MAIL_GOOGLE_TOKEN.length>=32)||(env.RESEND_API_KEY&&env.MAIL_FROM&&!env.MAIL_FROM.includes('INSERIRE')));
export async function sendMail(env,{to,subject,text,id=crypto.randomUUID()}){
 const url=googleMailUrl(env);
 if(url&&typeof env.MAIL_GOOGLE_TOKEN==='string'&&env.MAIL_GOOGLE_TOKEN.length>=32){
  const payload=JSON.stringify({to,subject,text,id,sentAt:Date.now()});const encoder=new TextEncoder();const key=await crypto.subtle.importKey('raw',encoder.encode(env.MAIL_GOOGLE_TOKEN),{name:'HMAC',hash:'SHA-256'},false,['sign']);const signature=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(payload))),n=>n.toString(16).padStart(2,'0')).join('');
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({payload,signature}),redirect:'follow',signal:AbortSignal.timeout(15000)});
  if(!response.ok)return new Response(null,{status:response.status});
  let result;try{result=await response.json();}catch{return new Response(null,{status:502});}
  return new Response(null,{status:result.ok===true?200:[400,401,403,429,503].includes(result.code)?result.code:502,headers:result.code===429?{'Retry-After':'21600'}:{}});
 }
 if(!env.RESEND_API_KEY||!env.MAIL_FROM||env.MAIL_FROM.includes('INSERIRE'))return new Response(null,{status:503});
 return fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':id},signal:AbortSignal.timeout(8000),body:JSON.stringify({from:env.MAIL_FROM,to:[to],subject,text})});
}
