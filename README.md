# ROBOT WORLD WAR

A Telegram Mini App strategy game with a persistent world map, country ownership, economy, resource production, infrastructure, army management, diplomacy, battles, announcements, groups, private messages, and owner tools.

## Stack

- Node.js 20+
- Express 4
- PostgreSQL
- Telegram Mini App authentication
- World map data from `world-atlas`

## Run

1. Install dependencies: `npm install`
2. Configure the environment variables in `.env` or your hosting dashboard.
3. Start: `npm start`

Run the source checks before starting:

```bash
npm test
```

The checks validate the server JavaScript, the Mini App's inline JavaScript, static HTML IDs, CSS brace balance, and matching client/server build versions. They are syntax and consistency checks, not a substitute for end-to-end testing against a live Telegram session and PostgreSQL database.

## Required environment

- `DATABASE_URL`: PostgreSQL connection string
- `BOT_TOKEN`: Telegram bot token
- `TELEGRAM_WEBHOOK_SECRET`: optional webhook secret (recommended)
- `MINI_APP_URL`: optional override for the Mini App URL
- `PGSSL`: set to `true` only if the database provider requires SSL

Never commit real tokens or database credentials.

## Deploy

The Render service uses the `main` branch, `npm install`, and `npm start`. The `/health` endpoint checks database connectivity. After a commit, verify the resulting deployment in Render before announcing that the new version is live.

## Player systems

- One-time country selection and world map
- Resource balances and passive production
- Buildings, upgrades, and shop
- Army catalog and recruitment
- Diplomacy, war declarations, battle reports, and in-game victory rewards
- World announcements and news
- Group rooms, invitations, group management, and private messages
- Telegram bot commands: `/start`, `/game`, `/help`, and `/about`

Owner-only operations are authorized server-side for the configured owner IDs. Do not rely on client-side UI visibility for access control.

## Free-tier data warning

Render free PostgreSQL databases have a limited lifetime and may not include backups. Check the current Render plan and database expiry before using this as the only copy of persistent player data.
