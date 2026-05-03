# Auth Server — Integration Reference

Self-hosted OAuth2 identity provider. Implements the **Authorization Code Flow** (RFC 6749).

**Default base URL:** `http://localhost:3000`  
Set `AUTH_BASE_URL` in your app's environment to override.

---

## 1. Register Your Application

Visit `http://localhost:3000/dashboard/apps/new` while logged into the auth server.

- Enter your app's name
- Enter one or more allowed **Redirect URIs** (one per line), e.g. `http://localhost:4000/callback`
- Save your `CLIENT_ID` and `CLIENT_SECRET` — secret is only shown in full once

Store them as environment variables in your app:
```
AUTH_BASE_URL=http://localhost:3000
AUTH_CLIENT_ID=<your client_id>
AUTH_CLIENT_SECRET=<your client_secret>
AUTH_REDIRECT_URI=http://localhost:4000/callback
```

---

## 2. OAuth2 Authorization Code Flow

### Step 1 — Redirect user to auth server

```javascript
const crypto = require('crypto');

app.get('/login', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;

  const params = new URLSearchParams({
    client_id: process.env.AUTH_CLIENT_ID,
    redirect_uri: process.env.AUTH_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid profile email',
    state,
  });

  res.redirect(`${process.env.AUTH_BASE_URL}/oauth/authorize?${params}`);
});
```

### Step 2 — Handle the callback

```javascript
app.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) return res.status(400).send(`Auth error: ${error}`);
  if (state !== req.session.oauthState) return res.status(400).send('State mismatch — possible CSRF');
  delete req.session.oauthState;

  // Exchange code for tokens
  const tokenRes = await fetch(`${process.env.AUTH_BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.AUTH_REDIRECT_URI,
      client_id: process.env.AUTH_CLIENT_ID,
      client_secret: process.env.AUTH_CLIENT_SECRET,
    }),
  });

  const tokens = await tokenRes.json();
  if (tokens.error) return res.status(400).send(tokens.error);

  // Fetch user profile
  const userRes = await fetch(`${process.env.AUTH_BASE_URL}/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const user = await userRes.json();

  // Store in session
  req.session.user = user;
  req.session.accessToken = tokens.access_token;
  req.session.refreshToken = tokens.refresh_token;

  res.redirect('/');
});
```

### Step 3 — Protect routes

```javascript
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

app.get('/profile', requireLogin, (req, res) => {
  res.json(req.session.user);
});
```

---

## 3. API Reference

### `GET /oauth/authorize`

Initiates the login flow. Redirect the user's browser here.

| Parameter      | Required | Description                                      |
|----------------|----------|--------------------------------------------------|
| `client_id`    | yes      | Your app's client ID                             |
| `redirect_uri` | yes      | Must exactly match a registered URI              |
| `response_type`| yes      | Must be `code`                                   |
| `scope`        | yes      | Space-separated: `openid`, `profile`, `email`    |
| `state`        | yes      | Random value for CSRF protection — you verify it |

**Error behavior:**
- If `client_id` or `redirect_uri` is invalid → renders an error page (no redirect)
- All other errors → redirects to `redirect_uri?error=<code>&state=<state>`

Error codes: `unsupported_response_type`, `invalid_request`, `access_denied`

---

### `POST /oauth/token`

Server-to-server call. Exchange an authorization code for tokens.

**Request** (`application/x-www-form-urlencoded`):

| Field           | Value                        |
|-----------------|------------------------------|
| `grant_type`    | `authorization_code`         |
| `code`          | The code from the callback   |
| `redirect_uri`  | Must match what was used in step 1 |
| `client_id`     | Your client ID               |
| `client_secret` | Your client secret           |

Also accepts HTTP Basic auth: `Authorization: Basic base64(client_id:client_secret)`

**Success response** (`200 application/json`):

```json
{
  "access_token": "<jwt>",
  "id_token": "<jwt>",
  "refresh_token": "<opaque string>",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "openid profile email"
}
```

**Error responses:**

| HTTP | `error`                  | Cause                                    |
|------|--------------------------|------------------------------------------|
| 401  | `invalid_client`         | Bad client_id or client_secret           |
| 400  | `invalid_grant`          | Code not found, expired, used, or redirect_uri mismatch |
| 400  | `invalid_request`        | Missing required field                   |
| 400  | `unsupported_grant_type` | grant_type not recognized                |

---

### `POST /oauth/token` (refresh)

Exchange a refresh token for a new access token.

**Request** (`application/x-www-form-urlencoded`):

| Field           | Value              |
|-----------------|--------------------|
| `grant_type`    | `refresh_token`    |
| `refresh_token` | Your refresh token |
| `client_id`     | Your client ID     |
| `client_secret` | Your client secret |

Returns the same shape as the authorization_code grant (without a new refresh token).

---

### `GET /oauth/userinfo`

Returns the authenticated user's profile. Requires a valid access token.

**Request header:** `Authorization: Bearer <access_token>`

**Success response** (`200 application/json`):

```json
{
  "sub": 1,
  "email": "alice@example.com",
  "name": "Alice",
  "created_at": 1714000000
}
```

**Error responses:**

| HTTP | `error`          | Cause                          |
|------|------------------|--------------------------------|
| 401  | `invalid_token`  | Missing, expired, or bad token |
| 404  | `user_not_found` | User was deleted               |

---

## 4. Token Details

- **Access token:** JWT signed with HS256. Payload: `{ sub, email, scope, type: "access", iss, iat, exp }`. Valid for **1 hour**.
- **ID token:** JWT signed with HS256. Payload: `{ sub, email, name, aud: client_id, iss, iat, exp }`. Valid for **1 hour**.
- **Refresh token:** Opaque random string. Valid for **30 days**.
- **Authorization code:** Valid for **10 minutes**, single-use.

The JWT secret is `JWT_SECRET` in the auth server's `.env`. If you need to verify tokens server-side in your app without calling `/oauth/userinfo`, share that secret via environment variable.

---

## 5. Minimal Working Example

A complete Express app that authenticates users via the auth server:

```javascript
// app.js — minimal OAuth2 client
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const crypto = require('crypto');

const app = express();
app.use(session({ secret: 'local-secret', resave: false, saveUninitialized: false }));

const AUTH = process.env.AUTH_BASE_URL || 'http://localhost:3000';
const CLIENT_ID = process.env.AUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.AUTH_CLIENT_SECRET;
const REDIRECT_URI = process.env.AUTH_REDIRECT_URI || 'http://localhost:4000/callback';

app.get('/login', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.state = state;
  const params = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code', scope: 'openid profile email', state });
  res.redirect(`${AUTH}/oauth/authorize?${params}`);
});

app.get('/callback', async (req, res) => {
  if (req.query.error) return res.send(`Error: ${req.query.error}`);
  if (req.query.state !== req.session.state) return res.status(400).send('State mismatch');

  const tokenRes = await fetch(`${AUTH}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: req.query.code, redirect_uri: REDIRECT_URI, client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
  });
  const { access_token, refresh_token, error } = await tokenRes.json();
  if (error) return res.send(`Token error: ${error}`);

  const user = await fetch(`${AUTH}/oauth/userinfo`, { headers: { Authorization: `Bearer ${access_token}` } }).then(r => r.json());
  req.session.user = user;
  req.session.accessToken = access_token;
  req.session.refreshToken = refresh_token;
  res.redirect('/');
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

app.get('/', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.send(`Hello ${req.session.user.name} — <a href="/logout">logout</a>`);
});

app.listen(4000, () => console.log('Client app on http://localhost:4000'));
```

```
# .env for the client app
AUTH_BASE_URL=http://localhost:3000
AUTH_CLIENT_ID=<from dashboard>
AUTH_CLIENT_SECRET=<from dashboard>
AUTH_REDIRECT_URI=http://localhost:4000/callback
```
