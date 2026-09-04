# YouTube Title & Thumbnail Change Intelligence

Track the packaging decisions competitor channels make after publishing—with no API key required. Paste normal channel URLs or `@handles`; the Actor preserves overwritten title and thumbnail variants, identifies repeated rotations, and ranks public performance signals for creators, agencies, and media teams.

## What buyers receive

- `NEW_VIDEO`
- `TITLE_CHANGED`
- `THUMBNAIL_CHANGED`
- `TITLE_AND_THUMBNAIL_CHANGED`
- `PACKAGING_IMPACT_UPDATED`

Every packaging event includes the old/new creative evidence, observed change-time window, variant number, rotation count, time on the previous variant, time since publication, available public engagement data, view velocity before and after, and a deterministic `signalScore` with `HIGH`, `MEDIUM`, or `LOW` priority.

Repeated or reused variants are flagged. Two or more early rotations can be labeled `isLikelyPackagingTest`, while every record remains explicitly `observationalNotCausal: true`.

## Conversion-first setup

Users can paste any of these forms:

- `https://www.youtube.com/@GoogleDevelopers`
- `@GoogleDevelopers`
- `UC_x5XG1OV2P6uZZ5FSM9Ttw`

That is enough to start. Keyless mode uses YouTube's public channel feed plus content-hashed public thumbnails to monitor up to 15 recent videos per channel. It includes current titles, publication dates, public views and likes, and supports normal channel IDs and `@handles`.

The encrypted `youtubeApiKey` field is optional. Customers who already have a key restricted to **YouTube Data API v3** can supply it to use the official API path, inspect up to 50 recent videos per channel, and receive additional metadata where YouTube exposes it. The Actor never needs YouTube account access, OAuth, or private analytics.

## Why it is different from another YouTube scraper

A snapshot tool returns the current title, thumbnail, and view count. This Actor preserves information YouTube overwrites, reconstructs the variant sequence, associates each observed switch with a public response window, and emits an exception-only intelligence feed suitable for Sheets, BI, n8n/Make, Slack, webhooks, or AI agents.

## Spend and noise controls

- `recentVideosPerChannel` limits tracked uploads.
- `publishedWithinDays` focuses on videos still likely to be actively packaged.
- `minimumViews` skips immaterial videos.
- `minimumSignalScore` suppresses weak events.
- `changeWindowDays` and `impactSamplesPerChange` control the multi-point post-change response curve.

The first channel baseline is quiet and free. Set `emitBaseline` only when raw baseline rows are useful.

## Recommended schedules

- Daily: broad competitor watchlists.
- Every 4–6 hours: active launches and agency research.
- Hourly: short, time-bounded monitoring of priority videos.

Keep the same `monitorKey` across runs. Changing it deliberately creates a new baseline.

## Transparent usage-based pricing

There is no subscription or setup fee. The first baseline for each channel is free.

- Routine monitoring costs **$0.001 per previously baselined video observation**.
- New uploads, title or thumbnail changes, and follow-up impact records cost **$0.02 each**.

At five recent videos and one daily run, monitoring 100 channels costs about $15/month before occasional change alerts. Use the video-age, minimum-view, and signal-score controls to focus the watchlist and manage spend.

## Output and storage

Each run writes ranked signal rows plus one `RUN_SUMMARY` with the top ten signals. Content-addressed thumbnail files, channel manifests, variant history, and video observations live in a named key-value store derived from `monitorKey`.

## Local development

```bash
npm install
npm test
npm start
```

The default mode uses public YouTube channel feeds and public thumbnail URLs. An optional supplied key is used only for official read-only YouTube Data API requests. The Actor does not read private analytics, comment content, transcripts, or YouTube account credentials.
