# Store listing: YouTube Title & Thumbnail Change Intelligence

## Search title

YouTube Title & Thumbnail Change Intelligence

## Short description

Preserve competitor title and thumbnail variants, detect likely packaging tests, and rank public view-velocity signals from channel URLs or @handles.

## Opening pitch

YouTube shows the current packaging; this Actor preserves what was overwritten. Paste competitor channels once, schedule the Actor, and receive a ranked machine-readable record of title switches, thumbnail swaps, reused variants, likely tests, and the observed public response curve.

## Outcome-led use cases

1. Catch the thumbnail and title rotations successful competitors make after publishing.
2. Identify videos undergoing active packaging tests instead of reviewing every upload.
3. Preserve before/after creative assets and variant order for agency research.
4. Feed high-signal events into Sheets, BI, Slack, n8n/Make, or an AI workflow.

## Recommended pricing

- `video-observation`: $0.001 per previously baselined observation
- `packaging-signal`: $0.02 per new video, packaging event, or impact curve point
- First baseline: free

Disable the automatic `apify-default-dataset-item` event before launch to prevent double charging.

## First-run expectation

The first run quietly captures a baseline. Later scheduled runs emit only new or changed packaging evidence plus a ranked run digest.

## Suggested categories and search terms

Social media; Marketing; Automation; YouTube competitor monitor; thumbnail tracker; title change tracker; YouTube A/B test; view velocity; creator intelligence.

## Publication gate

Configure a developer-owned `YOUTUBE_API_KEY` so ordinary buyers do not need one. Test two controlled runs and one known title or thumbnail change; verify that the old/new thumbnail files and response-curve rows are retained before publication.
