export const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE !== 'false';
export function publicConfig() { const url=process.env.NEXT_PUBLIC_SUPABASE_URL; const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; if(!url||!key) throw new Error('Supabase is not configured. Follow Setup for Non-Coders or enable Demo Mode.'); return {url,key}; }
