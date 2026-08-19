/**
 * Security response headers (Phase 2 hardening). Hand-rolled instead of
 * pulling in `helmet`: this app has an unusually simple, fixed asset graph —
 * one same-origin Express service serving its own built SPA, no CDN, no
 * external fonts, no third-party scripts (DEPLOY.md is explicit about this) —
 * so a general-purpose library's configurable defaults would need the same
 * tuning a five-line policy gets here for free, for a dependency that then
 * has to be kept current. Revisit if the asset graph ever grows a real
 * external dependency (a maps widget, an analytics script, anything CDN-hosted).
 */
import type { Request, Response, NextFunction } from 'express';

/**
 * script-src has no 'unsafe-inline': there is no inline <script> anywhere in
 * index.html or the built output (verified: Vite emits one <script type=module
 * src=/assets/...>). style-src DOES need 'unsafe-inline' — the app sets inline
 * style={{...}} on ~60 elements (chart geometry, segmented-control indicator
 * position), which CSP's style-src governs same as a <style> tag. Removing
 * that would mean rewriting every computed inline style as a CSS custom
 * property, which is a real refactor, not a header change.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function securityHeaders() {
  return (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY'); // belt-and-suspenders alongside frame-ancestors for older UAs
    res.setHeader('Referrer-Policy', 'no-referrer'); // nothing here needs to leak to any other origin, same-origin or not
    res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), payment=(), usb=()');
    // HSTS only makes sense — and is only safe — once TLS is actually real.
    // Sending it over the plain-HTTP intranet default (DEPLOY.md) would tell
    // browsers to *refuse* plain HTTP to this host for the max-age window,
    // which is the opposite of harmless on a deployment that has no cert.
    // req.secure reflects real TLS, or a trusted reverse proxy's X-Forwarded-Proto
    // once `trust proxy` is enabled for that proxy (see DEPLOY.md TLS section).
    if (req.secure) {
      res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    }
    next();
  };
}
