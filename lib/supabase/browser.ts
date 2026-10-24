import {createBrowserClient} from '@supabase/ssr';
import {publicConfig} from '@/lib/config';
export function supabaseBrowser(){const {url,key}=publicConfig();return createBrowserClient(url,key);}
