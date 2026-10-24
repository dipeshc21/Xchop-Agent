import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'XHTMLChop Growth Agent',description:'Your agency growth workspace. Find opportunities, build relationships, and deliver great work.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>;}
