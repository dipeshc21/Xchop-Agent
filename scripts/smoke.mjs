import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';

// For an unconfigured production build. This check never contacts a real Supabase project.
const origin='http://127.0.0.1:3210';
const child=spawn(process.execPath,[
  'node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3210',
],{stdio:['ignore','pipe','pipe'],env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:'',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'',NEXT_PUBLIC_SUPABASE_ANON_KEY:''}});
let output='';
child.stdout.on('data',data=>output+=data);
child.stderr.on('data',data=>output+=data);
let childExited=false;
child.on('exit',()=>{childExited=true;});
try{
  let ready=false;
  for(let i=0;i<60;i++){
    if(childExited)break;
    try{const response=await fetch(origin+'/setup',{redirect:'manual'});if(response.ok){ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  assert.ok(ready,output||'Temporary server did not become ready.');
  const res=await fetch(origin,{redirect:'manual'});
  assert.equal(res.status,307,'Build without Supabase configuration must redirect to setup.');
  assert.ok(res.headers.get('location')?.endsWith('/setup'));
  assert.equal(res.headers.get('x-content-type-options'),'nosniff');
  const setup=await fetch(origin+'/setup');
  const html=await setup.text();
  assert.ok(html.includes('Supabase')&&html.includes('.env.local'));
  assert.ok(!html.includes('Studio North')&&!html.includes('Demo workspace'));
  const css=html.match(/href="([^"]+\.css[^\"]*)"/);
  assert.ok(css,'Setup page must include a stylesheet.');
  assert.equal((await fetch(origin+css[1].replaceAll('&amp;','&'))).status,200);
  assert.equal((await fetch(origin+'/login')).status,200);
  const settingsPage=await fetch(origin+'/settings',{redirect:'manual'});
  assert.equal(settingsPage.status,307);
  assert.ok(settingsPage.headers.get('location')?.endsWith('/setup'));

  const health=await fetch(origin+'/api/setup');
  assert.equal(health.status,200);
  const healthData=await health.json();
  assert.equal(healthData.configured,false);
  assert.equal(healthData.authenticated,false);
  assert.equal(healthData.database,'not-checked');
  assert.ok(Array.isArray(healthData.checks));
  assert.equal(healthData.checks.find(check=>check.id==='configuration')?.status,'blocked');
  assert.equal(healthData.checks.find(check=>check.id==='dashboard')?.status,'not-checked');
  const put=await fetch(origin+'/api/workspace',{method:'PUT',headers:{'content-type':'application/json',origin},body:'{}'});
  assert.equal(put.status,503);
  console.log('PASS: missing-config redirect, setup instructions, stylesheet, login boundary, secret-free readiness response, and guarded settings endpoint.');
}finally{
  if(!childExited){
    const exit=new Promise(resolve=>child.once('exit',resolve));
    child.kill('SIGTERM');
    await exit;
  }
}
