import { createServerClient } from '@supabase/ssr';
import type { CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const ALLOWED_DOMAIN = '@iimu.ac.in';

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        }
      }
    }
  );

  const {
    data: { user }
  } = await supabase.auth.getUser();

  // Public paths: no login required to reach these.
  // /api/sync-timetable is included because it's called two ways that never
  // have a logged-in user session — Vercel's own Cron job (authenticates via
  // a CRON_SECRET header) and manual testing via a ?secret= query param. Both
  // checks live inside that route itself; middleware must let the request
  // through to it rather than redirecting to /login first.
  const isPublicPath = request.nextUrl.pathname.startsWith('/login') ||
    request.nextUrl.pathname.startsWith('/auth') ||
    request.nextUrl.pathname.startsWith('/api/sync-timetable');

  if (!user && !isPublicPath) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Defense-in-depth: Google's "Internal" app type already restricts sign-in to
  // @iimu.ac.in accounts, but we check again here in case that ever changes.
  if (user && !user.email?.endsWith(ALLOWED_DOMAIN)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL('/login?error=domain', request.url));
  }

  return response;
}

export const config = {
  // Static asset extensions (png, jpg, svg, etc.) are excluded here alongside
  // _next/static, _next/image, and favicon.ico. Without this, any public/
  // image referenced on a page a logged-out user can see (e.g. the logo on
  // /login itself) gets redirected to /login instead of loading — exactly
  // the bug that broke the login-page logo.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'
  ]
};
