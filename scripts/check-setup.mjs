import {existsSync,readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';

const file='.env.local';
let local={};
try{if(existsSync(file))local=parseEnv(readFileSync(file,'utf8'));}catch{console.error('Could not read .env.local. Check its KEY=value format. No values were printed.');process.exit(1);}
const get=name=>process.env[name]??local[name]??'';
const url=get('NEXT_PUBLIC_SUPABASE_URL').trim();
const key=(get('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')||get('NEXT_PUBLIC_SUPABASE_ANON_KEY')).trim();
let validUrl=false;
try{const parsed=new URL(url);validUrl=['https:','http:'].includes(parsed.protocol)&&!parsed.username&&!parsed.password&&!parsed.search&&!parsed.hash&&['','/'].includes(parsed.pathname)&&!/your[-_ ]?project/i.test(url);}catch{}
const keyPresent=Boolean(key)&&!/your[-_ ]?(publishable|anon)[-_ ]?key/i.test(key);
const privateKey=key.startsWith('sb_secret_')||key.toLowerCase().includes('service_role');
let serviceRole=false;
if(key.split('.').length===3){try{serviceRole=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString('utf8')).role==='service_role';}catch{}}
console.log(`Supabase project URL: ${validUrl?'ready':'missing or invalid'}`);
console.log(`Browser-safe Supabase key: ${keyPresent&&!privateKey&&!serviceRole?'present':'missing, invalid, or a private administrative key'}`);
console.log('No configuration values or keys were printed.');
if(!validUrl||!keyPresent||privateKey||serviceRole){console.error('Open README.md → Connect your app privately, complete .env.local, then rerun npm run setup:check.');process.exitCode=1;}else{console.log('Local configuration is ready. Start the app and verify your real sign-in, migrations, and account privacy. This check does not contact Supabase.');}
