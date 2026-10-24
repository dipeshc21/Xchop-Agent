'use client';
export default function ErrorPage({reset}:{reset:()=>void}){return <main className="login"><section className="panel"><h1>We couldn’t load your workspace.</h1><p>Check your Supabase settings and run the database setup in the guide.</p><button onClick={reset}>Try again</button></section></main>;}
