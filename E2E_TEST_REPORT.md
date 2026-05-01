# E2E Test Report STM Creator App

**URL tested:** `https://stm-8nizc.ondigitalocean.app/`
**Backend:** `https://hammerhead-app-t8l9y.ondigitalocean.app`
**Tool:** Playwright (Chromium headless)
**Date:** 2026-03-26
**Result: 34/34 tests PASSED**

---

## 1. App Routes Discovered

| Route | Result | Content |
|-------|--------|---------|
| `/` | Landing page | Marketing page with features, tech stack, CTA |
| `/editor` | Main app | Login/Signup form + editor (after auth or guest) |
| `/login` | Redirects to `/editor` | Shows login form |
| `/signup`, `/register`, `/dashboard`, `/models` | Redirects to `/notfound` | 404 page |
| `/nonexistent` | 404 page | Clean 404 with "Return Home" and "Try the Editor" |

---

## 2. Backend API Connectivity

| Endpoint | Status | Result |
|----------|--------|--------|
| `GET /auth/health` | 200 | `{"status":"Auth service is healthy"}` |
| `GET /models/health` | 401 | `{"error":"Missing token"}` (auth required, correct) |
| `GET /models/all` (no token) | 401 | Correctly blocked |
| `POST /auth/login` (wrong creds) | 401 | `AUTH_INVALID_CREDENTIALS` with requestId |
| `POST /auth/signup` (weak pass) | 400 | `VALIDATION_ERROR` with details: "min 8 chars", "must contain a digit", "must contain a special char" |
| `GET /openapi.json` | 200 | API docs accessible |

---

## 3. Login Form (`/editor`)

- **Form fields:** Email, Password, Login button
- **Tabs:** Login / Sign Up toggle
- **Guest option:** "Continue as Guest" button present
- **Empty form submission:** No client-side validation errors shown (form submits silently)
- **Invalid email:** No visible error message on the UI
- **Wrong credentials:** No API call was made to backend, no visible error message

### Issues Found

- **The login form does NOT appear to call the backend API.** When submitting wrong credentials (`wrong@example.com` / `WrongPassword1!`), zero network requests were made to the backend. The form seems to either validate client-side only or have a disconnected submit handler.
- **No visible validation error messages** for empty fields, invalid email, or wrong credentials. The form just sits there silently.
- **No localStorage/sessionStorage tokens** were found before or after login attempts — storage is completely empty.

---

## 4. Sign Up Form

- **Fields:** Name (text), Email (email), Password (password), Role (optional select)
- **Role options:** Viewer, Editor, Admin
- **Submit button:** "Create account"
- **Weak password submission:** No visible error message on the UI

### Issues Found

- Same as login — **no API calls observed** during signup attempts and **no validation feedback** shown to user.

---

## 5. Guest Mode (Editor)

Guest mode works well. After clicking "Continue as Guest":

- **Full editor loads** with React Flow canvas, toolbar, sidebar
- **Toolbar buttons:** Add Node, Create Edge, Load All Edges, Save Model, Milestone, Import EKS, Export EKS
- **Layout options:** Layered, Grid, Force, Heuristic, Re-layout
- **Other controls:** Show Self-Trans, Open Model, New Model, Delete, Sign in, Help, Comment
- **Right panel:** Classes (Reference, Class II–VI), Transition Filters, Tips
- **Model loaded:** "BMRG Rainforests" (0 states, 0/0 transitions)
- **Add Node works:** Clicking "Add Node" created a node on the canvas
- **Double-click on canvas:** Works (creates node)
- **Save in guest mode:** Correctly shows "Sign in" prompt (auth required)
- **No WebSocket connection** established in guest mode (expected — no auth token)

---

## 6. Landing Page Navigation

| Link | Result |
|------|--------|
| Features (`#features`) | Scrolls correctly |
| How it works (`#how`) | Scrolls correctly |
| Tech (`#tech`) | Scrolls correctly |
| Get Started | Navigates to `/editor` |
| Try the demo | Navigates to `/editor` |
| 404 "Return Home" | Returns to `/` |
| 404 "Try the Editor" | Available |

---

## 7. Performance

| Metric | Value |
|--------|-------|
| Page load (network idle) | **1,747ms** |
| Time to First Byte (TTFB) | **63ms** |
| DOM Content Loaded | **493ms** |
| DOM Complete | **493ms** |
| Console errors | **0** |
| Page errors | **0** |
| Failed requests on load | **0** |
| API calls on homepage load | **0** (no unnecessary calls) |

---

## 8. Security Headers

### Backend (Excellent)

| Header | Value |
|--------|-------|
| `x-frame-options` | `SAMEORIGIN` |
| `x-content-type-options` | `nosniff` |
| `strict-transport-security` | `max-age=31536000; includeSubDomains; preload` |
| `content-security-policy` | Full CSP policy set |
| `x-powered-by` | NOT SET (good — hidden) |

### Frontend (Missing)

| Header | Status |
|--------|--------|
| `x-frame-options` | NOT SET |
| `x-content-type-options` | NOT SET |
| `strict-transport-security` | NOT SET |
| `content-security-policy` | NOT SET |

> The frontend is served by DigitalOcean's static hosting, which doesn't add security headers by default. Configure these in DigitalOcean App Platform or add a `_headers` file.

---

## 9. CORS

- `access-control-allow-origin: https://stm-8nizc.ondigitalocean.app` — correctly set for the frontend origin.

---

## 10. Accessibility

| Check | Result |
|-------|--------|
| Images with alt text | 1/1 (100%) |
| ARIA landmarks | 3 (banner, main, contentinfo) |
| Heading hierarchy | H1 > H3 > H2 (minor: skips H2 before H3s) |
| Unlabeled form inputs | 0 |
| Keyboard navigation | Tab order works through form |
| Responsive design | Desktop, tablet, mobile all render properly |

---

## Critical Issues to Fix

1. **Login/Signup forms don't call the backend API** — The most critical issue. Form submissions produce zero network requests. The frontend submit handlers may be broken or the API URL may be misconfigured.

2. **No form validation feedback** — Users get no visual feedback when submitting empty/invalid data.

3. **Frontend security headers are missing** — While the backend has excellent security headers, the frontend has none. Consider adding them via DigitalOcean config.

4. **Heading hierarchy** — Minor: jumps from H1 to H3 (skipping H2) on the landing page.
