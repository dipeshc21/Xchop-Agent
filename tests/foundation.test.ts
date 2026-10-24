import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults,settingsSchema} from '../lib/schema';
import {demoLeads,metrics} from '../lib/demo';
test('safe defaults: approval mode, automation off, India excluded',()=>{assert.equal(defaults.automation,false);assert.equal(defaults.mode,'approval');assert.equal(defaults.excludeIndia,true);});
test('settings reject invalid email, URL and out-of-range sending limit',()=>{for(const invalid of [{ownerEmail:'bad'},{website:'javascript:alert(1)'},{dailyLimit:31},{dailyLimit:0},{businessName:''}]){assert.equal(settingsSchema.safeParse({...defaults,...invalid}).success,false,JSON.stringify(invalid));}});
test('seed data is fictional, unique and outside India',()=>{assert.equal(demoLeads.length,20);assert.equal(new Set(demoLeads.map(l=>l.email)).size,20);assert.ok(demoLeads.every(l=>l.email.endsWith('.example')&&l.country!=='India'));});
test('pipeline excludes won, delivered and lost amounts',()=>{const first=demoLeads[0];const result=metrics([{...first,stage:'New',value:200},{...first,stage:'Won',value:300},{...first,stage:'Lost',value:400}]);assert.equal(result.pipeline,200);assert.equal(result.revenue,300);assert.equal(result.won,1);});
