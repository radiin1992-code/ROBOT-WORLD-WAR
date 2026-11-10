# ROBOT WORLD WAR

Global strategy Telegram Mini App. Independent of JOJO UNIVERSE and Cloudflare.

## Hosting on Render

This repository is configured for Render Blueprint deployment in Frankfurt with:
- Node.js Express web service
- PostgreSQL database
- Automatic deploys from the `main` branch
- Database-backed `/health` check
- Telegram webhook registration using Render's public service URL

Open the Render Blueprint after `render.yaml` is committed and review the resources before applying.

## Required secret

Set `BOT_TOKEN` in the Render service Environment page. Never put the Telegram bot token in GitHub or in this file. The webhook is registered automatically after the token is configured and the service restarts.

The app uses Render's `RENDER_EXTERNAL_URL` automatically for the Mini App URL and webhook URL.

## Important free-tier limits

The Blueprint uses free resources to avoid starting paid services without your approval. Render free web services sleep after 15 minutes without traffic and can take about a minute to wake up. **Render free PostgreSQL expires 30 days after creation**, then has a 14-day upgrade grace period before deletion. Free databases have no backups. Do not keep important game progress in the free database beyond its expiry; upgrade or migrate it before then.

## Security

Telegram Mini App initData is validated server-side. Owner authorization is enforced on the server for Telegram ID `1852348620`. Secrets and database credentials must remain in Render environment settings, never in source control.

## Current implemented modules

- World map and one-time country selection
- Persistent player profiles and starting resources
- Economy overview and country upgrades
- World news feed
- Owner-only money/resource grants
- Telegram `/start` webhook and Mini App launch button

Diplomacy, trade contracts, route restrictions, and turn-based conflict are not yet implemented in the current application code. They must be added and tested before describing the game as feature-complete.
