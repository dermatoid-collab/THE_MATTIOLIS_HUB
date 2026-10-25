import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);
let html=readFileSync(new URL('public/index.html',root),'utf8');
const css=readFileSync(new URL('public/style.css',root),'utf8');
const shopping=readFileSync(new URL('public/shopping.js',root),'utf8').replace('export function createShopping','function createShopping');
const notifications=readFileSync(new URL('public/notifications.js',root),'utf8').replace('export function createNotifications','function createNotifications');
const audit=readFileSync(new URL('public/audit.js',root),'utf8').replace('export function createAudit','function createAudit');
const covers=readFileSync(new URL('public/covers.js',root),'utf8').replace('export function createCovers','function createCovers');
const deliveryStatus=readFileSync(new URL('public/delivery-status.js',root),'utf8').replace('export function createDeliveryStatus','function createDeliveryStatus');
const contentTools=readFileSync(new URL('public/content-tools.js',root),'utf8').replaceAll('export function','function');
let js=contentTools+'\n'+deliveryStatus+'\n'+covers+'\n'+audit+'\n'+notifications+'\n'+shopping+'\n'+readFileSync(new URL('public/app.js',root),'utf8').replace("import {matchesContent,sortContents,sortOptions} from './content-tools.js';",'').replace("import {createDeliveryStatus} from './delivery-status.js';",'').replace("import {createCovers} from './covers.js';",'').replace("import {createAudit} from './audit.js';",'').replace("import {createNotifications} from './notifications.js';",'').replace("import {createShopping} from './shopping.js';",'');
// This artifact intentionally starts the demo even inside an HTML preview service.
js=js.replace("if(location.protocol==='file:'||new URLSearchParams(location.search).has('demo'))", "if(true)");
const favicon='data:image/svg+xml,'+encodeURIComponent(readFileSync(new URL('public/favicon.svg',root),'utf8'));
js=js.replaceAll('/brand-icon.svg?v=casa-b',favicon);
html=html.replace(/href="\/favicon\.svg(?:\?[^"]*)?"/,`href="${favicon}"`).replace('<link rel="stylesheet" href="/style.css">',`<style>${css}</style>`).replace('<script type="module" src="/app.js"></script>',`<script type="module">${js.replaceAll('</script','<\\/script')}</script>`);
const output=new URL('../Punto_Anteprima.html',root);writeFileSync(output,html);console.log(fileURLToPath(output));
