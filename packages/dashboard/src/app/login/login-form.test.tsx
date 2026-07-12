import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// The form is presentational; its server actions transitively import
// lib/db (which requires DATABASE_URL at import time). Mock them out —
// these tests only assert the rendered markup.
vi.mock('./actions', () => ({
  loginWithPassword: async () => ({ error: null }),
  googleSignIn: async () => {},
}));

import { LoginForm } from './login-form';

describe('LoginForm', () => {
  it('renders email, password, and Google option', () => {
    const html = renderToStaticMarkup(<LoginForm />);
    expect(html).toContain('type="email"');
    expect(html).toContain('type="password"');
    expect(html.toLowerCase()).toContain('google');
    expect(html).toContain('/signup'); // link to sign-up
  });
});
