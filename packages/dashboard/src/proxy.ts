import NextAuth from 'next-auth';
import { authConfig } from './lib/auth.config';

// Middleware gate runs ONLY the edge-safe config (no db/bcrypt). See
// lib/auth.config.ts.
export const { auth: proxy } = NextAuth(authConfig);

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
