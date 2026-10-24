import {redirect} from 'next/navigation';
import {demoMode} from '@/lib/config';
import {supabaseServer} from '@/lib/supabase/server';
import {demoLeads,type Lead} from '@/lib/demo';
import {defaults,settingsSchema} from '@/lib/schema';
import Workspace from '@/components/workspace';
export default async function Page(){if(demoMode)return <Workspace demo initialLeads={demoLeads} initialSettings={defaults}/>;const db=await supabaseServer();const {data:{user}}=await db.auth.getUser();if(!user)redirect('/login');const [leads,settings]=await Promise.all([db.from('leads').select('*').order('created_at',{ascending:false}),db.from('settings').select('data').eq('owner_id',user.id).maybeSingle()]);if(leads.error||settings.error)throw new Error('Database unavailable. Check the Phase 1 setup guide and database migration.');const parsed=settingsSchema.safeParse({...defaults,...settings.data?.data});return <Workspace demo={false} initialLeads={(leads.data??[]) as Lead[]} initialSettings={parsed.success?parsed.data:defaults}/>;}
