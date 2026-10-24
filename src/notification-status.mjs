import {ensureNotifications,mailConfigured} from './notifications.mjs';
const all=async(env,sql,...args)=>(await env.DB.prepare(sql).bind(...args).all()).results;
export function notificationReason(user,event,channel){if(!user.active)return 'account_disabled';if(!event)return 'no_event';if(!user[channel+'_enabled'])return 'channel_disabled';if(!user[event.category])return 'category_disabled';if(user.ignore_own&&event.actor_id===user.id)return 'own_change';if(channel==='push'&&!user.devices)return 'no_device';return 'eligible';}
export async function notificationStatus(req,env,{json,fail}){
 if(req.method!=='GET')fail(405,'Diagnostica in sola lettura.');await ensureNotifications(env);
 const [users,events,deliveries,health]=await Promise.all([
 all(env,'SELECT u.id,u.name,u.active,COALESCE(p.email_enabled,1) email_enabled,COALESCE(p.push_enabled,1) push_enabled,COALESCE(p.links,1) links,COALESCE(p.shopping,1) shopping,COALESCE(p.releases,1) releases,COALESCE(p.ignore_own,1) ignore_own,(SELECT count(*) FROM push_subscriptions s WHERE s.user_id=u.id) devices FROM users u LEFT JOIN notification_preferences p ON p.user_id=u.id ORDER BY u.name'),
 all(env,'SELECT e.id,e.category,e.title,e.body,e.actor_id,e.created_at,u.name actor_name,(SELECT count(*) FROM notification_jobs j WHERE j.event_id=e.id) job_count FROM notification_events e LEFT JOIN users u ON u.id=e.actor_id ORDER BY e.created_at DESC LIMIT 15'),
 all(env,'SELECT j.event_id,u.name recipient,j.channel,j.status,j.attempts,j.available_at,j.lease_until,j.last_error FROM notification_jobs j JOIN users u ON u.id=j.user_id JOIN notification_events e ON e.id=j.event_id WHERE j.event_id IN (SELECT id FROM notification_events ORDER BY created_at DESC LIMIT 15) ORDER BY e.created_at DESC LIMIT 500'),
 all(env,"SELECT key,value FROM notification_config WHERE key IN ('last_dispatch','last_cron','last_event_error')")
 ]);
 const activity=(await all(env,'SELECT title,created_at,updated_at FROM links ORDER BY updated_at DESC LIMIT 5'));
 const config=Object.fromEntries(health.map(x=>{try{return [x.key,JSON.parse(x.value)];}catch{return [x.key,null];}}));const latest=events.find(e=>e.category==='links')||events[0];
 return json({referenceEventId:latest?.id||null,mailConfigured:mailConfigured(env),events,deliveries,health:config,recentLinks:activity,recipients:users.map(u=>({id:u.id,name:u.name,devices:u.devices,emailReason:notificationReason(u,latest,'email'),pushReason:notificationReason(u,latest,'push')})),checkedAt:Date.now()});
}
