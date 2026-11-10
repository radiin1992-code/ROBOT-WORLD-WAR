# ROBOT WORLD WAR

Global strategy Telegram Mini App. Independent of JOJO UNIVERSE and Cloudflare.

## Hosting
Deploy this repository to Railway and attach a PostgreSQL service. Railway supplies DATABASE_URL. Set these private variables:
- BOT_TOKEN
- MINI_APP_URL (the public Railway URL)

The server initializes PostgreSQL tables automatically. Configure the Telegram webhook to:
`https://YOUR-APP.up.railway.app/telegram/webhook`

## Security
Telegram Mini App initData is validated server-side. Owner authorization is enforced on the server for Telegram ID 1852348620. Never commit bot tokens or database credentials.

## Current modules
World map, country selection, persistent player profiles, resources, economy overview, country upgrades, owner money/resource controls, Telegram /start webhook.
