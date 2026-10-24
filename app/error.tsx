'use client';
import Link from 'next/link';
export default function ErrorPage({reset}:{reset:()=>void}){return <main className="login"><section className="panel login-panel"><h1>We couldn’t load your workspace.</h1><p>Check your connection and database setup, then try again.</p><div className="setup-actions"><button className="button primary" onClick={reset}>Try again</button><Link className="button outline" href="/setup">Open setup guide</Link></div></section></main>;}
