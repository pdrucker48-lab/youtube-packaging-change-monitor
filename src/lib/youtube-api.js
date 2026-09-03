const API_ROOT = 'https://www.googleapis.com/youtube/v3';

export async function resolveChannels(references, apiKey, timeoutMs) {
    const parsed = references.map(parseChannelReference);
    const resolved = [];
    const ids = [...new Set(parsed.filter((item) => item.channelId).map((item) => item.channelId))];

    for (let index = 0; index < ids.length; index += 50) {
        const batch = ids.slice(index, index + 50);
        const data = await youtubeRequest('/channels', {
            part: 'contentDetails,snippet',
            id: batch.join(','),
            key: apiKey,
        }, timeoutMs);
        for (const channel of data.items ?? []) resolved.push(normalizeChannel(channel));
    }

    for (const handle of [...new Set(parsed.filter((item) => item.handle).map((item) => item.handle))]) {
        const data = await youtubeRequest('/channels', {
            part: 'contentDetails,snippet',
            forHandle: handle,
            key: apiKey,
        }, timeoutMs);
        if (data.items?.[0]) resolved.push(normalizeChannel(data.items[0]));
    }

    const unique = new Map(resolved.map((channel) => [channel.channelId, channel]));
    if (!unique.size) throw new Error('None of the supplied channel URLs, handles, or IDs could be resolved');
    return [...unique.values()];
}

export function parseChannelReference(reference) {
    const value = String(reference ?? '').trim();
    if (/^UC[A-Za-z0-9_-]{20,}$/.test(value)) return { channelId: value, handle: null };
    if (/^@[A-Za-z0-9._-]{3,}$/.test(value)) return { channelId: null, handle: value.slice(1) };
    try {
        const url = new URL(value.startsWith('http') ? value : `https://www.youtube.com/${value}`);
        const id = url.pathname.match(/\/channel\/(UC[A-Za-z0-9_-]{20,})/i)?.[1];
        const handle = url.pathname.match(/\/@([A-Za-z0-9._-]{3,})/)?.[1];
        if (id) return { channelId: id, handle: null };
        if (handle) return { channelId: null, handle };
    } catch {
        // The validation error below is more useful than a URL parser error.
    }
    if (/^[A-Za-z0-9._-]{3,}$/.test(value)) return { channelId: null, handle: value };
    throw new Error(`Unsupported channel reference: ${value}`);
}

function normalizeChannel(channel) {
    const uploadsPlaylistId = channel?.contentDetails?.relatedPlaylists?.uploads;
    if (!channel?.id || !uploadsPlaylistId) throw new Error('Resolved channel has no public uploads playlist');
    return {
        channelId: channel.id,
        channelTitle: channel.snippet?.title ?? null,
        channelHandle: channel.snippet?.customUrl ?? null,
        uploadsPlaylistId,
    };
}

export async function listRecentVideoIds(playlistId, maxResults, apiKey, timeoutMs) {
    const data = await youtubeRequest('/playlistItems', {
        part: 'contentDetails',
        playlistId,
        maxResults: Math.min(50, maxResults),
        key: apiKey,
    }, timeoutMs);

    return (data.items ?? [])
        .map((item) => item.contentDetails?.videoId)
        .filter(Boolean);
}

export async function fetchVideoObservations(videoIds, apiKey, timeoutMs) {
    if (videoIds.length === 0) return [];

    const data = await youtubeRequest('/videos', {
        part: 'snippet,statistics,contentDetails',
        id: videoIds.join(','),
        key: apiKey,
    }, timeoutMs);

    return (data.items ?? []).map((item) => ({
        videoId: item.id,
        channelId: item.snippet?.channelId,
        channelTitle: item.snippet?.channelTitle ?? null,
        title: item.snippet?.title ?? '',
        publishedAt: item.snippet?.publishedAt ?? null,
        thumbnails: item.snippet?.thumbnails ?? {},
        views: Number.parseInt(item.statistics?.viewCount ?? '0', 10),
        likes: item.statistics?.likeCount == null ? null : Number.parseInt(item.statistics.likeCount, 10),
        comments: item.statistics?.commentCount == null ? null : Number.parseInt(item.statistics.commentCount, 10),
        duration: item.contentDetails?.duration ?? null,
    }));
}

async function youtubeRequest(path, query, timeoutMs) {
    const url = new URL(`${API_ROOT}${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));

    const response = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const reason = body.error?.message ?? `${response.status} ${response.statusText}`;
        throw new Error(`YouTube Data API request failed: ${reason}`);
    }
    return response.json();
}
