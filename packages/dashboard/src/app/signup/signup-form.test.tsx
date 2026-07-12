import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// The form is presentational; its server actions transitively import
// lib/db (which requires DATABASE_URL at import time). Mock them out —
// these tests only assert the rendered markup.
vi.mock('./actions', () => ({ signup: async () => ({ error: null }) }));
vi.mock('../login/actions', () => ({ googleSignIn: async () => {} }));

import { SignupForm } from './signup-form';

describe('SignupForm', () => {
  it('renders email, password, and Google option', () => {
    const html = renderToStaticMarkup(<SignupForm />);
    expect(html).toContain('type="email"');
    expect(html).toContain('type="password"');
    expect(html.toLowerCase()).toContain('google');
    expect(html).toContain('/login'); // link to sign-in
  });
});
