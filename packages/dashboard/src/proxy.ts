import NextAuth from 'next-auth';
import { authConfig } from './lib/auth.config';

// Middleware gate runs ONLY the edge-safe config (no db/bcrypt). See
// lib/auth.config.ts.
// Next 16's proxy loader only recognizes a function exported directly or via
// an `export { x as proxy }` binding — a destructured `export const { auth:
// proxy }` is seen as a non-function const and silently disables the gate.
const { auth } = NextAuth(authConfig);
export { auth as proxy };

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
