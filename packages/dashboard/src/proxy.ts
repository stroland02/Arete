// Next.js 16 renamed Middleware to Proxy (same file convention, same
// runtime). Re-exporting NextAuth's `auth` wrapper here runs the
// `authorized` callback from lib/auth.ts on every request matched below,
// redirecting anyone without a session to /login before any page or
// route handler executes.
export { auth as proxy } from './lib/auth';

export const config = {
  // Skip static assets; everything else (including "/") goes through auth.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
