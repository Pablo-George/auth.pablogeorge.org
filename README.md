# AuthServer

A self-hosted OAuth2 identity provider built with Node.js and Express. Lets you centralise authentication across your apps — users register once and sign in through AuthServer, which issues tokens your apps can verify.

Think Auth0, but running on your own machine.

---

## Features

- User registration and login
- Developer dashboard to register applications and manage credentials
- OAuth2 Authorization Code Flow (`/oauth/authorize`, `/oauth/token`)
- OpenID Connect userinfo endpoint (`/oauth/userinfo`)
- JWT access tokens and ID tokens (HS256)
- Refresh tokens
- Persistent sessions and database via SQLite (no external services needed)

---

## Getting Started

**Requirements:** Node.js 18+

```bash
# 1. Install dependencies
npm install

# 2. Copy and edit config
cp .env.example .env
# Edit .env — at minimum change SESSION_SECRET and JWT_SECRET

# 3. Start the server
npm run dev       # development (auto-restart on changes)
npm start         # production
```

Server starts at `http://localhost:3000`.

### Configuration (`.env`)

| Variable         | Default                   | Description                          |
|------------------|---------------------------|--------------------------------------|
| `PORT`           | `3000`                    | Port to listen on                    |
| `HOST`           | `127.0.0.1`               | Host to bind to                      |
| `SESSION_SECRET` | *(required)*              | Secret for signing session cookies   |
| `JWT_SECRET`     | *(required)*              | Secret for signing JWTs              |
| `JWT_ISSUER`     | `http://localhost:3000`   | Issuer claim in tokens               |
| `BASE_URL`       | `http://localhost:3000`   | Public base URL (used in UI)         |
| `NODE_ENV`       | `development`             | Set to `production` to hide errors   |

---

## Usage

### As a user

1. Go to `http://localhost:3000/register` and create an account
2. Sign in at `/login`
3. Your dashboard is at `/dashboard`

### As a developer

1. Sign in and go to **Dashboard → New Application**
2. Enter your app's name and its callback URL(s), e.g. `http://localhost:4000/callback`
3. Copy the `client_id` and `client_secret` — the secret is only shown in full once
4. Integrate using the OAuth2 flow — see [INTEGRATION.md](./INTEGRATION.md)

---

## How It Works

AuthServer implements the **OAuth2 Authorization Code Flow**:

```
Your App          AuthServer            User
   |                   |                  |
   |-- redirect ------>|                  |
   |   /oauth/authorize|                  |
   |                   |-- login page --->|
   |                   |<-- credentials --|
   |                   |-- consent ------>|
   |                   |<-- allow --------|
   |<-- redirect with code ---------------|
   |                   |
   |-- POST /oauth/token (code + secret) ->|
   |<-- access_token, id_token, refresh ---|
   |                   |
   |-- GET /oauth/userinfo (Bearer token) ->|
   |<-- { sub, email, name } --------------|
```

---

## Project Structure

```
src/
├── server.js              # Entry point
├── app.js                 # Express setup and middleware
├── db/
│   └── index.js           # SQLite connection + schema migrations
├── routes/
│   ├── auth.js            # /register /login /logout
│   ├── oauth.js           # /oauth/authorize /oauth/token /oauth/userinfo
│   └── dashboard.js       # /dashboard/** — app management
├── middleware/
│   └── requireAuth.js     # Session guard
├── utils/
│   ├── jwt.js             # Sign and verify JWTs
│   └── password.js        # bcrypt helpers
└── views/                 # EJS templates
    ├── login.ejs
    ├── register.ejs
    ├── authorize.ejs      # OAuth consent screen
    ├── error.ejs
    └── dashboard/
        ├── index.ejs
        ├── new-app.ejs
        └── app-detail.ejs
```

Data is stored in `auth.db` and `sessions.db` (SQLite files created automatically on first run).

---

## Integrating Another App

See **[INTEGRATION.md](./INTEGRATION.md)** for the full API reference and a minimal working client example. That file is also designed to be pasted into an AI conversation to help wire up integrations automatically.

Quick version — in your other app:

```javascript
// Redirect user to log in
res.redirect(`http://localhost:3000/oauth/authorize?` + new URLSearchParams({
  client_id: process.env.AUTH_CLIENT_ID,
  redirect_uri: 'http://localhost:4000/callback',
  response_type: 'code',
  scope: 'openid profile email',
  state: generateRandomState(),
}));

// Handle callback — exchange code for tokens
const { access_token } = await fetch('http://localhost:3000/oauth/token', {
  method: 'POST',
  body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri, client_id, client_secret }),
}).then(r => r.json());

// Get user profile
const user = await fetch('http://localhost:3000/oauth/userinfo', {
  headers: { Authorization: `Bearer ${access_token}` },
}).then(r => r.json());
```
