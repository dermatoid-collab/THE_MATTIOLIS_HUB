import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);
let html=readFileSync(new URL('public/index.html',root),'utf8');
const css=readFileSync(new URL('public/style.css',root),'utf8');
let js=readFileSync(new URL('public/app.js',root),'utf8');
// This artifact intentionally starts the demo even inside an HTML preview service.
js=js.replace("if(location.protocol==='file:'||new URLSearchParams(location.search).has('demo'))", "if(true)");
const favicon='data:image/svg+xml,'+encodeURIComponent(readFileSync(new URL('public/favicon.svg',root),'utf8'));
html=html.replace('href="/favicon.svg"',`href="${favicon}"`).replace('<link rel="stylesheet" href="/style.css">',`<style>${css}</style>`).replace('<script type="module" src="/app.js"></script>',`<script type="module">${js.replaceAll('</script','<\\/script')}</script>`);
const output=new URL('../Punto_Anteprima.html',root);writeFileSync(output,html);console.log(fileURLToPath(output));
