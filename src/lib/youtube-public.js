import { parseChannelReference } from './youtube-api.js';

const YOUTUBE_ORIGIN = 'https://www.youtube.com';
const PUBLIC_FEED_LIMIT = 15;

export async function resolvePublicChannels(references, timeoutMs) {
    const resolved = [];
    for (const reference of references) {
        const parsed = parseChannelReference(reference);
        if (parsed.channelId) {
            resolved.push({
                channelId: parsed.channelId,
                channelTitle: null,
                channelHandle: null,
                dataSource: 'youtube-public-feed',
            });
            continue;
        }

        const handleUrl = `${YOUTUBE_ORIGIN}/@${encodeURIComponent(parsed.handle)}`;
        const response = await youtubePublicRequest(handleUrl, timeoutMs, 'text/html');
        const html = await response.text();
        const channelId = parseChannelIdFromHtml(html);
        if (!channelId) throw new Error(`Could not resolve YouTube handle @${parsed.handle}`);
        resolved.push({
            channelId,
            channelTitle: parseMetaContent(html, 'og:title'),
            channelHandle: `@${parsed.handle}`,
            dataSource: 'youtube-public-feed',
        });
    }

    const unique = new Map(resolved.map((channel) => [channel.channelId, channel]));
    if (!unique.size) throw new Error('None of the supplied channel URLs, handles, or IDs could be resolved');
    return [...unique.values()];
}

export async function fetchPublicVideoObservations(channel, maxResults, timeoutMs) {
    const feedUrl = `${YOUTUBE_ORIGIN}/feeds/videos.xml?channel_id=${encodeURIComponent(channel.channelId)}`;
    const response = await youtubePublicRequest(feedUrl, timeoutMs, 'application/atom+xml,text/xml');
    const xml = await response.text();
    return parseYouTubeFeed(xml)
        .slice(0, Math.min(PUBLIC_FEED_LIMIT, maxResults))
        .map((video) => ({
            ...video,
            channelTitle: video.channelTitle ?? channel.channelTitle,
            dataSource: 'youtube-public-feed',
        }));
}

export function parseChannelIdFromHtml(html) {
    const canonical = String(html).match(/<link\s+rel=["']canonical["']\s+href=["']https:\/\/www\.youtube\.com\/channel\/(UC[A-Za-z0-9_-]{20,})["']/i)?.[1];
    if (canonical) return canonical;
    return String(html).match(/["']channelId["']\s*:\s*["'](UC[A-Za-z0-9_-]{20,})["']/i)?.[1] ?? null;
}

export function parseYouTubeFeed(xml) {
    const entries = String(xml).match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
    return entries.map((entry) => {
        const videoId = readTag(entry, 'yt:videoId');
        const channelId = readTag(entry, 'yt:channelId');
        if (!videoId || !channelId) return null;

        const thumbnailUrl = readAttribute(entry, 'media:thumbnail', 'url');
        const views = parseNullableInteger(readAttribute(entry, 'media:statistics', 'views')) ?? 0;
        const likes = parseNullableInteger(readAttribute(entry, 'media:starRating', 'count'));
        return {
            videoId,
            channelId,
            channelTitle: readTag(entry, 'name'),
            title: readTag(entry, 'title') ?? '',
            publishedAt: readTag(entry, 'published'),
            updatedAt: readTag(entry, 'updated'),
            thumbnails: thumbnailUrl ? { high: { url: thumbnailUrl } } : {},
            views,
            likes,
            comments: null,
            duration: null,
        };
    }).filter(Boolean);
}

async function youtubePublicRequest(url, timeoutMs, accept) {
    const response = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
            Accept: accept,
            'Accept-Language': 'en-US,en;q=0.9',
            'User-Agent': 'Mozilla/5.0 (compatible; Apify YouTube Packaging Monitor/1.0)',
        },
    });
    if (!response.ok) throw new Error(`YouTube public metadata request failed: ${response.status} ${response.statusText}`);
    const length = Number(response.headers.get('content-length') ?? 0);
    if (length > 5_000_000) throw new Error('YouTube public metadata response exceeded 5 MB');
    return response;
}

function readTag(xml, tagName) {
    const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = String(xml).match(new RegExp(`<${escaped}>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
    return match ? decodeXml(match[1].trim()) : null;
}

function readAttribute(xml, tagName, attributeName) {
    const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedAttribute = attributeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tag = String(xml).match(new RegExp(`<${escapedTag}\\s+[^>]*>`, 'i'))?.[0];
    if (!tag) return null;
    const match = tag.match(new RegExp(`${escapedAttribute}=["']([^"']*)["']`, 'i'));
    return match ? decodeXml(match[1]) : null;
}

function parseMetaContent(html, property) {
    const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = String(html).match(new RegExp(`<meta\\s+property=["']${escaped}["']\\s+content=["']([^"']*)["']`, 'i'));
    return match ? decodeXml(match[1]) : null;
}

function decodeXml(value) {
    return String(value)
        .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
        .replace(/&#([0-9]+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}

function parseNullableInteger(value) {
    if (value == null || value === '') return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
}

