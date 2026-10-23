/** The Mattioli's Hub — Google Apps Script mail bridge.
 * No inbox access: MailApp only needs script.send_mail.
 * Never paste HUB_MAIL_TOKEN in the repository or in chat.
 */
function initializeMailer() {
  const p = PropertiesService.getScriptProperties();
  if (!p.getProperty('HUB_MAIL_TOKEN')) {
    p.setProperty('HUB_MAIL_TOKEN', (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''));
  }
  // Triggers Google's send-mail authorization. Sends no test email.
  console.log('Invio autorizzato. Quota destinatari residua: ' + MailApp.getRemainingDailyQuota());
  console.log('Il token è nelle Impostazioni progetto → Proprietà script → HUB_MAIL_TOKEN.');
}
function doGet() {
  return hubReply({ok: false, code: 405});
}
function doPost(e) {
  let lock;
  try {
    if (!e || !e.postData || e.postData.contents.length > 24000) return hubReply({ok:false,code:400});
    const request = JSON.parse(e.postData.contents);
    const properties = PropertiesService.getScriptProperties();
    const token = properties.getProperty('HUB_MAIL_TOKEN');
    if (!token || typeof request.payload !== 'string' || request.payload.length > 16000 || !/^[a-f0-9]{64}$/.test(request.signature || '')) return hubReply({ok:false,code:403});
    const expected = Utilities.computeHmacSha256Signature(request.payload, token, Utilities.Charset.UTF_8).map(function(n){return ('0'+((n+256)%256).toString(16)).slice(-2);}).join('');
    let difference = 0;
    for (let i=0;i<64;i++) difference |= expected.charCodeAt(i)^request.signature.charCodeAt(i);
    if (difference) return hubReply({ok:false,code:403});
    const message = JSON.parse(request.payload);
    if (!Number.isSafeInteger(message.sentAt) || Math.abs(Date.now()-message.sentAt)>300000 || typeof message.to!=='string' || message.to.length>254 || !/^[A-Za-z0-9.!#$%&'*+\-/=?^_`{|}~]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(message.to) || typeof message.id!=='string' || message.id.length>200 || typeof message.subject!=='string' || message.subject.length>200 || /[\r\n]/.test(message.subject) || typeof message.text!=='string' || message.text.length>12000) return hubReply({ok:false,code:400});
    lock = LockService.getScriptLock();
    if (!lock.tryLock(3000)) return hubReply({ok:false,code:503});
    const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, message.to+'\n'+message.id).map(function(n){return ('0'+((n+256)%256).toString(16)).slice(-2);}).join('');
    const key = 'sent_'+hash;
    if (properties.getProperty(key)) return hubReply({ok:true,duplicate:true});
    if (MailApp.getRemainingDailyQuota()<1) return hubReply({ok:false,code:429});
    MailApp.sendEmail({to:message.to,subject:message.subject,body:message.text,name:'The Mattioli’s Hub'});
    properties.setProperty(key,String(Date.now()));
    // Bound the duplicate registry: retain the most recent 1000 entries, up to 7 days.
    const all=properties.getProperties();
    const entries=Object.keys(all).filter(function(k){return k.indexOf('sent_')===0;}).sort(function(a,b){return Number(all[b])-Number(all[a]);});
    entries.forEach(function(k,i){if(i>=1000||Number(all[k])<Date.now()-7*86400000)properties.deleteProperty(k);});
    return hubReply({ok:true});
  } catch (error) {
    // Do not disclose token, recipients, message content or Google errors to callers.
    return hubReply({ok:false,code:503});
  } finally {
    if (lock && lock.hasLock()) lock.releaseLock();
  }
}
function hubReply(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
