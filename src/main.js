import { Actor, log } from 'apify';
import {
    calculateSignalScore,
    calculateViewsPerHour,
    createChangeRecord,
    createImpactRecord,
    detectPackagingChange,
    priorityFromScore,
    selectBestThumbnail,
    sha256,
    stableRecordKey,
    storeName,
    variantFromObservation,
} from './lib/packaging.js';
import {
    fetchVideoObservations,
    listRecentVideoIds,
    resolveChannels,
} from './lib/youtube-api.js';

await Actor.init();

try {
    const input = await Actor.getInput() ?? {};
    const channels = input.channels ?? input.channelIds ?? [];
    const youtubeApiKey = input.youtubeApiKey || process.env.YOUTUBE_API_KEY;

    if (!youtubeApiKey || !Array.isArray(channels) || channels.length === 0) {
        const missing = [
            ...(!youtubeApiKey ? ['youtubeApiKey'] : []),
            ...(!Array.isArray(channels) || channels.length === 0 ? ['channels'] : []),
        ];
        await Actor.pushData({
            recordType: 'configuration-required',
            eventType: 'CONFIGURATION_REQUIRED',
            ready: false,
            missing,
            setup: 'Add a YouTube Data API v3 key and at least one public channel URL, @handle, or channel ID, then run again.',
            documentation: 'https://github.com/pdrucker48-lab/youtube-packaging-change-monitor#quick-start',
            observationalNotCausal: true,
        });
        log.info(`Configuration required: ${missing.join(', ')}`);
    } else {
        validateInput({ ...input, channels, youtubeApiKey });

    const {
        recentVideosPerChannel = 5,
        monitorKey = 'default',
        changeWindowDays = 7,
        impactSamplesPerChange = 3,
        publishedWithinDays = 30,
        minimumViews = 0,
        minimumSignalScore = 0,
        emitBaseline = false,
        webhookUrl = null,
        requestTimeoutSecs = 25,
    } = input;

    const store = await Actor.openKeyValueStore(storeName(monitorKey));
    const observedAt = new Date().toISOString();
    const timeoutMs = requestTimeoutSecs * 1000;
    const output = [];
    const failures = [];
    let videosObserved = 0;
    let baselineVideos = 0;

    const resolvedChannels = await resolveChannels([...new Set(channels)], youtubeApiKey, timeoutMs);

    for (const channel of resolvedChannels) {
        const { channelId } = channel;
        const manifestKey = stableRecordKey('CHANNEL', channelId);
        const manifest = await store.getValue(manifestKey);
        const channelWasInitialized = Boolean(manifest?.initializedAt);

        try {
            const videoIds = await listRecentVideoIds(
                channel.uploadsPlaylistId,
                recentVideosPerChannel,
                youtubeApiKey,
                timeoutMs,
            );
            const fetched = await fetchVideoObservations(videoIds, youtubeApiKey, timeoutMs);
            const observations = fetched.filter((video) => {
                const ageDays = video.publishedAt
                    ? (new Date(observedAt).getTime() - new Date(video.publishedAt).getTime()) / 86_400_000
                    : 0;
                return ageDays <= publishedWithinDays && video.views >= minimumViews;
            });

            for (const observation of observations) {
                const thumbnail = await captureThumbnail(observation.thumbnails, store, timeoutMs);
                const current = {
                    ...observation,
                    channelTitle: observation.channelTitle ?? channel.channelTitle,
                    observedAt,
                    thumbnailUrl: thumbnail?.sourceUrl ?? null,
                    thumbnailHash: thumbnail?.contentHash ?? null,
                    thumbnailRecordKey: thumbnail?.recordKey ?? null,
                };
                const stateKey = stableRecordKey('VIDEO', observation.videoId);
                const previous = await store.getValue(stateKey);
                videosObserved += 1;

                if (!previous) {
                    baselineVideos += 1;
                    const newState = {
                        schemaVersion: 2,
                        ...current,
                        lastVelocityViewsPerHour: null,
                        variantStartedAt: observedAt,
                        variantHistory: [variantFromObservation(current, 1, observedAt)],
                        pendingChange: null,
                    };
                    if (channelWasInitialized && !(manifest?.seenVideoIds ?? []).includes(current.videoId)) {
                        const newVideo = createNewVideoRecord(current, observedAt);
                        if (newVideo.signalScore >= minimumSignalScore) {
                            output.push(newVideo);
                            await safeCharge('packaging-signal');
                        }
                    } else if (emitBaseline) {
                        output.push(createBaselineRecord(current, observedAt));
                    }
                    await store.setValue(stateKey, newState);
                    continue;
                }

                await safeCharge('video-observation');
                const intervalVelocity = calculateViewsPerHour(
                    previous.views,
                    current.views,
                    previous.observedAt,
                    observedAt,
                );
                const beforeVelocity = previous.lastVelocityViewsPerHour ?? intervalVelocity;
                const changeEventType = detectPackagingChange(previous, current);
                let pendingChange = previous.pendingChange ?? null;
                let variantStartedAt = previous.variantStartedAt ?? previous.observedAt;
                let variantHistory = previous.variantHistory?.length
                    ? previous.variantHistory
                    : [variantFromObservation(previous, 1, variantStartedAt)];

                if (changeEventType) {
                    const change = createChangeRecord({ previous, current, observedAt, beforeVelocity });
                    pendingChange = { ...change, viewsAtDetection: current.views, samplesEmitted: 0 };
                    variantStartedAt = observedAt;
                    variantHistory = [
                        ...variantHistory,
                        variantFromObservation(current, variantHistory.length + 1, observedAt),
                    ].slice(-100);
                    if (change.signalScore >= minimumSignalScore) {
                        output.push(change);
                        await safeCharge('packaging-signal');
                    }
                } else if (pendingChange) {
                    const ageMs = new Date(observedAt).getTime() - new Date(pendingChange.detectedAt).getTime();
                    const sampleNumber = (pendingChange.samplesEmitted ?? 0) + 1;
                    const isFinalSample = sampleNumber >= impactSamplesPerChange;
                    if (ageMs <= changeWindowDays * 86_400_000) {
                        const impact = createImpactRecord({
                            pendingChange,
                            current,
                            observedAt,
                            sampleNumber,
                            isFinalSample,
                        });
                        if (impact && impact.signalScore >= minimumSignalScore) {
                            output.push(impact);
                            await safeCharge('packaging-signal');
                        }
                        pendingChange = isFinalSample
                            ? null
                            : { ...pendingChange, samplesEmitted: sampleNumber };
                    } else {
                        pendingChange = null;
                    }
                }

                await store.setValue(stateKey, {
                    schemaVersion: 2,
                    ...current,
                    lastVelocityViewsPerHour: intervalVelocity,
                    variantStartedAt,
                    variantHistory,
                    pendingChange,
                });
            }

            await store.setValue(manifestKey, {
                schemaVersion: 2,
                channelId,
                channelTitle: channel.channelTitle,
                initializedAt: manifest?.initializedAt ?? observedAt,
                updatedAt: observedAt,
                seenVideoIds: [...new Set([...(manifest?.seenVideoIds ?? []), ...videoIds])].slice(-500),
            });
        } catch (error) {
            failures.push({ channelId, error: error.message });
            log.error(`Failed channel ${channelId}: ${error.message}`);
        }
    }

    const rankedSignals = [...output]
        .filter((item) => Number.isFinite(item.signalScore))
        .sort((a, b) => b.signalScore - a.signalScore);
    const summary = {
        recordType: 'run-summary',
        eventType: 'RUN_SUMMARY',
        monitorKey,
        observedAt,
        channelReferencesRequested: new Set(channels).size,
        channelsResolved: resolvedChannels.length,
        channelsSucceeded: resolvedChannels.length - failures.length,
        channelsFailed: failures.length,
        videosObserved,
        baselineVideos,
        newVideos: output.filter((item) => item.eventType === 'NEW_VIDEO').length,
        packagingChanges: output.filter((item) => [
            'TITLE_CHANGED',
            'THUMBNAIL_CHANGED',
            'TITLE_AND_THUMBNAIL_CHANGED',
        ].includes(item.eventType)).length,
        likelyPackagingTests: output.filter((item) => item.isLikelyPackagingTest).length,
        impactUpdates: output.filter((item) => item.eventType === 'PACKAGING_IMPACT_UPDATED').length,
        highPrioritySignals: rankedSignals.filter((item) => item.priority === 'HIGH').length,
        topSignals: rankedSignals.slice(0, 10).map((item) => ({
            eventType: item.eventType,
            videoId: item.videoId,
            videoUrl: item.videoUrl,
            signalScore: item.signalScore,
            priority: item.priority,
        })),
        failures,
        observationalNotCausal: true,
    };

    await Actor.pushData([...output, summary]);
    await store.setValue('LATEST_RUN_SUMMARY', summary);
    if (webhookUrl) await postWebhook(webhookUrl, { signals: rankedSignals, summary }, timeoutMs);

        log.info(`Observed ${videosObserved} videos and emitted ${output.length} signals.`);
    }
} finally {
    await Actor.exit();
}

function validateInput(input) {
    if (!input.youtubeApiKey || typeof input.youtubeApiKey !== 'string') {
        throw new Error('No YouTube Data API key is configured. Provide youtubeApiKey or set the Actor YOUTUBE_API_KEY environment variable.');
    }
    if (!Array.isArray(input.channels) || input.channels.length === 0) {
        throw new Error('channels must contain at least one YouTube channel URL, @handle, or ID');
    }
    if (input.webhookUrl) {
        const webhook = new URL(input.webhookUrl);
        if (webhook.protocol !== 'https:') throw new Error('webhookUrl must use HTTPS');
    }
}

async function captureThumbnail(thumbnails, store, timeoutMs) {
    const sourceUrl = selectBestThumbnail(thumbnails);
    if (!sourceUrl) return null;

    const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`Thumbnail request failed: ${response.status} ${response.statusText}`);
    const content = Buffer.from(await response.arrayBuffer());
    if (content.length > 10_000_000) throw new Error('Thumbnail exceeds the 10 MB safety limit');
    const contentHash = sha256(content);
    const recordKey = `THUMBNAIL_${contentHash}`;

    if (!(await store.getValue(recordKey))) {
        await store.setValue(recordKey, content, {
            contentType: response.headers.get('content-type') ?? 'image/jpeg',
        });
    }
    return { sourceUrl, contentHash, recordKey };
}

function createNewVideoRecord(current, observedAt) {
    const signalScore = calculateSignalScore({ eventType: 'NEW_VIDEO' });
    return {
        recordType: 'new-video',
        eventType: 'NEW_VIDEO',
        channelId: current.channelId,
        channelTitle: current.channelTitle,
        videoId: current.videoId,
        videoUrl: `https://www.youtube.com/watch?v=${current.videoId}`,
        publishedAt: current.publishedAt,
        newTitle: current.title,
        newThumbnail: {
            sourceUrl: current.thumbnailUrl,
            contentHash: current.thumbnailHash,
            keyValueStoreRecord: current.thumbnailRecordKey,
        },
        viewsAtDetection: current.views,
        likesAtDetection: current.likes,
        commentsAtDetection: current.comments,
        variantSequenceNumber: 1,
        rotationCount: 0,
        isLikelyPackagingTest: false,
        signalScore,
        priority: priorityFromScore(signalScore),
        detectedAt: observedAt,
        observationalNotCausal: true,
        fingerprint: sha256(`${current.videoId}|NEW_VIDEO|${observedAt}`),
    };
}

function createBaselineRecord(current, observedAt) {
    return {
        ...createNewVideoRecord(current, observedAt),
        recordType: 'baseline-video',
        eventType: 'BASELINE_VIDEO',
        signalScore: 0,
        priority: 'INFO',
        fingerprint: sha256(`${current.videoId}|BASELINE_VIDEO|${observedAt}`),
    };
}

async function safeCharge(eventName) {
    if (!process.env.APIFY_IS_AT_HOME && !process.env.ACTOR_TEST_PAY_PER_EVENT) return;
    try {
        await Actor.charge({ eventName });
    } catch (error) {
        log.warning(`Could not charge ${eventName}: ${error.message}`);
    }
}

async function postWebhook(webhookUrl, payload, timeoutMs) {
    const response = await fetch(webhookUrl, {
        method: 'POST',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`Webhook failed: ${response.status} ${response.statusText}`);
}
