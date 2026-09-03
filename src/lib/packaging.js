import { createHash } from 'node:crypto';

export function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}

export function stableRecordKey(prefix, value) {
    return `${prefix}_${sha256(String(value)).slice(0, 32)}`;
}

export function storeName(monitorKey) {
    return `youtube-packaging-${monitorKey.slice(0, 30)}-${sha256(monitorKey).slice(0, 8)}`;
}

export function selectBestThumbnail(thumbnails = {}) {
    for (const quality of ['maxres', 'standard', 'high', 'medium', 'default']) {
        if (thumbnails[quality]?.url) return thumbnails[quality].url;
    }
    return null;
}

export function calculateViewsPerHour(previousViews, currentViews, previousTime, currentTime) {
    const elapsedHours = (new Date(currentTime).getTime() - new Date(previousTime).getTime()) / 3_600_000;
    if (!Number.isFinite(elapsedHours) || elapsedHours <= 0) return null;

    const delta = Number(currentViews) - Number(previousViews);
    if (!Number.isFinite(delta)) return null;
    return round(Math.max(0, delta) / elapsedHours, 3);
}

export function calculateEngagementRate(views, likes, comments) {
    if (!Number.isFinite(views) || views <= 0) return null;
    if (!Number.isFinite(likes) && !Number.isFinite(comments)) return null;
    return round((((Number(likes) || 0) + (Number(comments) || 0)) / views) * 100, 4);
}

export function hoursBetween(start, end) {
    const hours = (new Date(end).getTime() - new Date(start).getTime()) / 3_600_000;
    return Number.isFinite(hours) && hours >= 0 ? round(hours, 2) : null;
}

export function detectPackagingChange(previous, current) {
    if (!previous) return null;

    const titleChanged = previous.title !== current.title;
    const thumbnailChanged = Boolean(previous.thumbnailHash)
        && Boolean(current.thumbnailHash)
        && previous.thumbnailHash !== current.thumbnailHash;

    if (titleChanged && thumbnailChanged) return 'TITLE_AND_THUMBNAIL_CHANGED';
    if (titleChanged) return 'TITLE_CHANGED';
    if (thumbnailChanged) return 'THUMBNAIL_CHANGED';
    return null;
}

export function createChangeRecord({ previous, current, observedAt, beforeVelocity }) {
    const eventType = detectPackagingChange(previous, current);
    if (!eventType) return null;

    const fingerprint = sha256([
        current.videoId,
        eventType,
        previous.title,
        current.title,
        previous.thumbnailHash,
        current.thumbnailHash,
        observedAt,
    ].join('|'));

    const history = previous.variantHistory?.length
        ? previous.variantHistory
        : [variantFromObservation(previous, 1, previous.variantStartedAt ?? previous.observedAt)];
    const variantSequenceNumber = history.length + 1;
    const rotationCount = variantSequenceNumber - 1;
    const variantReused = history.some((variant) => (
        variant.title === current.title && variant.thumbnailHash === current.thumbnailHash
    ));
    const hoursSincePublishAtChange = current.publishedAt
        ? hoursBetween(current.publishedAt, observedAt)
        : null;
    const isLikelyPackagingTest = rotationCount >= 2
        && (hoursSincePublishAtChange == null || hoursSincePublishAtChange <= 168);
    const signalScore = calculateSignalScore({
        eventType,
        rotationCount,
        variantReused,
        isLikelyPackagingTest,
        beforeVelocity,
    });

    return {
        recordType: 'packaging-change',
        eventType,
        channelId: current.channelId,
        videoId: current.videoId,
        videoUrl: `https://www.youtube.com/watch?v=${current.videoId}`,
        changeTimestampWindow: {
            earliest: previous.observedAt,
            latest: observedAt,
        },
        oldTitle: previous.title,
        newTitle: current.title,
        oldThumbnail: thumbnailReference(previous),
        newThumbnail: thumbnailReference(current),
        viewsAtPreviousObservation: previous.views,
        viewsAtDetection: current.views,
        likesAtDetection: current.likes ?? null,
        commentsAtDetection: current.comments ?? null,
        engagementRateAtDetection: calculateEngagementRate(current.views, current.likes, current.comments),
        viewsPerHourBeforeChange: beforeVelocity,
        viewsPerHourAfterChange: null,
        velocityChangePercent: null,
        analysisStatus: 'awaiting-post-change-observation',
        variantSequenceNumber,
        rotationCount,
        variantReused,
        isLikelyPackagingTest,
        hoursSincePublishAtChange,
        hoursOnPreviousVariant: hoursBetween(previous.variantStartedAt ?? previous.observedAt, observedAt),
        signalScore,
        priority: priorityFromScore(signalScore),
        detectedAt: observedAt,
        observationalNotCausal: true,
        caveat: 'Public view velocity is observational. A title or thumbnail change may correlate with performance but is not proven to cause it.',
        fingerprint,
    };
}

export function createImpactRecord({
    pendingChange,
    current,
    observedAt,
    sampleNumber = 1,
    isFinalSample = false,
}) {
    const afterVelocity = calculateViewsPerHour(
        pendingChange.viewsAtDetection,
        current.views,
        pendingChange.detectedAt,
        observedAt,
    );
    if (afterVelocity === null) return null;

    const beforeVelocity = pendingChange.viewsPerHourBeforeChange;
    const velocityChangePercent = Number.isFinite(beforeVelocity) && beforeVelocity > 0
        ? round(((afterVelocity - beforeVelocity) / beforeVelocity) * 100, 2)
        : null;

    const signalScore = Math.min(100, (pendingChange.signalScore ?? 40)
        + (Math.abs(velocityChangePercent ?? 0) >= 25 ? 15 : 5));

    return {
        recordType: 'packaging-impact',
        eventType: 'PACKAGING_IMPACT_UPDATED',
        channelId: current.channelId,
        videoId: current.videoId,
        videoUrl: `https://www.youtube.com/watch?v=${current.videoId}`,
        sourceChangeEventType: pendingChange.eventType,
        sourceChangeFingerprint: pendingChange.fingerprint,
        oldTitle: pendingChange.oldTitle,
        newTitle: pendingChange.newTitle,
        oldThumbnail: pendingChange.oldThumbnail,
        newThumbnail: pendingChange.newThumbnail,
        viewsAtDetection: pendingChange.viewsAtDetection,
        viewsAtFollowUp: current.views,
        likesAtFollowUp: current.likes ?? null,
        commentsAtFollowUp: current.comments ?? null,
        engagementRateAtFollowUp: calculateEngagementRate(current.views, current.likes, current.comments),
        viewsPerHourBeforeChange: beforeVelocity,
        viewsPerHourAfterChange: afterVelocity,
        velocityChangePercent,
        measurementHours: hoursBetween(pendingChange.detectedAt, observedAt),
        sampleNumber,
        isFinalSample,
        variantSequenceNumber: pendingChange.variantSequenceNumber,
        rotationCount: pendingChange.rotationCount,
        isLikelyPackagingTest: pendingChange.isLikelyPackagingTest,
        signalScore,
        priority: priorityFromScore(signalScore),
        detectedAt: pendingChange.detectedAt,
        measuredAt: observedAt,
        observationalNotCausal: true,
        caveat: 'Public view velocity is observational. A title or thumbnail change may correlate with performance but is not proven to cause it.',
        fingerprint: sha256(`${pendingChange.fingerprint}|impact|${sampleNumber}|${observedAt}|${current.views}`),
    };
}

export function variantFromObservation(observation, sequenceNumber, startedAt) {
    return {
        sequenceNumber,
        title: observation.title,
        thumbnailHash: observation.thumbnailHash,
        thumbnailUrl: observation.thumbnailUrl,
        thumbnailRecordKey: observation.thumbnailRecordKey,
        startedAt,
        viewsAtStart: observation.views,
    };
}

export function calculateSignalScore({
    eventType,
    rotationCount = 0,
    variantReused = false,
    isLikelyPackagingTest = false,
    beforeVelocity = null,
}) {
    const base = {
        TITLE_CHANGED: 45,
        THUMBNAIL_CHANGED: 55,
        TITLE_AND_THUMBNAIL_CHANGED: 70,
        NEW_VIDEO: 30,
    }[eventType] ?? 25;
    return Math.min(100,
        base
        + Math.min(rotationCount * 5, 15)
        + (variantReused ? 10 : 0)
        + (isLikelyPackagingTest ? 10 : 0)
        + (Number.isFinite(beforeVelocity) && beforeVelocity >= 1_000 ? 5 : 0));
}

export function priorityFromScore(score) {
    if (score >= 75) return 'HIGH';
    if (score >= 50) return 'MEDIUM';
    return 'LOW';
}

function thumbnailReference(value) {
    return {
        sourceUrl: value.thumbnailUrl ?? null,
        contentHash: value.thumbnailHash ?? null,
        keyValueStoreRecord: value.thumbnailRecordKey ?? null,
    };
}

function round(value, decimals) {
    const factor = 10 ** decimals;
    return Math.round((value + Number.EPSILON) * factor) / factor;
}
