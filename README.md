# YouTube Title & Thumbnail Change Intelligence

Track the packaging decisions competitor channels make after publishing. Paste normal channel URLs or `@handles`; the Actor preserves overwritten title and thumbnail variants, identifies repeated rotations, and ranks the strongest public performance signals for creators, agencies, and media teams.

## What buyers receive

- `NEW_VIDEO`
- `TITLE_CHANGED`
- `THUMBNAIL_CHANGED`
- `TITLE_AND_THUMBNAIL_CHANGED`
- `PACKAGING_IMPACT_UPDATED`

Every packaging event includes the old/new creative evidence, observed change-time window, variant number, rotation count, time on the previous variant, time since publication, public views/likes/comments, view velocity before and after, and a deterministic `signalScore` with `HIGH`, `MEDIUM`, or `LOW` priority.

Repeated or reused variants are flagged. Two or more early rotations can be labeled `isLikelyPackagingTest`, while every record remains explicitly `observationalNotCausal: true`.

## Conversion-first setup

Users can paste any of these forms:

- `https://www.youtube.com/@GoogleDevelopers`
- `@GoogleDevelopers`
- `UC_x5XG1OV2P6uZZ5FSM9Ttw`

For the lowest-friction Store experience, configure a developer-owned `YOUTUBE_API_KEY` secret in the Actor environment. The optional encrypted `youtubeApiKey` input remains available for high-volume customers who prefer their own quota.

## Why it is different from another YouTube scraper

A scraper returns the current title, thumbnail, and view count. This Actor preserves information YouTube overwrites, reconstructs the variant sequence, associates each observed switch with a public response window, and emits an exception-only intelligence feed suitable for Sheets, BI, n8n/Make, Slack, webhooks, or AI agents.

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

## Recommended Store pricing

Configure two pay-per-event charges:

- `video-observation` — **$0.001 per previously baselined video observation**;
- `packaging-signal` — **$0.02 per new video, packaging change, or post-change impact record**.

Remove the automatic `apify-default-dataset-item` event in the pricing setup so run summaries and evidence rows are not double-charged.

At the default five recent videos and one daily run, 100 channels cost about $15/month before occasional signal charges—close to specialist SaaS pricing while providing API-native data and preserved creative assets. The first baseline is not charged.

## Output and storage

Each run writes ranked signal rows plus one `RUN_SUMMARY` with the top ten signals. Content-addressed thumbnail files, channel manifests, variant history, and video observations live in a named key-value store derived from `monitorKey`.

## Local development

```bash
npm install
export YOUTUBE_API_KEY="YOUR_KEY"
npm test
npm start
```

This v1 uses only the official YouTube Data API and public thumbnail URLs. It does not read private analytics, comments content, transcripts, or account credentials beyond the optional API key.
