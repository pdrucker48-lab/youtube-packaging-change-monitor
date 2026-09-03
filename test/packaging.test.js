import test from 'node:test';
import assert from 'node:assert/strict';
import {
    calculateViewsPerHour,
    createChangeRecord,
    createImpactRecord,
    detectPackagingChange,
    selectBestThumbnail,
} from '../src/lib/packaging.js';
import { parseChannelReference } from '../src/lib/youtube-api.js';

const previous = {
    channelId: 'UC123',
    videoId: 'abc123',
    title: 'Original title',
    thumbnailUrl: 'https://img.example/old.jpg',
    thumbnailHash: 'old-hash',
    thumbnailRecordKey: 'THUMBNAIL_old-hash',
    views: 100,
    observedAt: '2026-09-03T10:00:00.000Z',
};

test('detects combined title and thumbnail change', () => {
    const current = { ...previous, title: 'New title', thumbnailHash: 'new-hash' };
    assert.equal(detectPackagingChange(previous, current), 'TITLE_AND_THUMBNAIL_CHANGED');
});

test('ignores thumbnail URL churn when content hash is unchanged', () => {
    const current = { ...previous, thumbnailUrl: 'https://cdn.example/cache-bust.jpg' };
    assert.equal(detectPackagingChange(previous, current), null);
});

test('calculates non-negative view velocity', () => {
    assert.equal(calculateViewsPerHour(100, 340, '2026-09-03T10:00:00Z', '2026-09-03T12:00:00Z'), 120);
    assert.equal(calculateViewsPerHour(340, 320, '2026-09-03T10:00:00Z', '2026-09-03T12:00:00Z'), 0);
});

test('selects highest-quality available thumbnail', () => {
    assert.equal(selectBestThumbnail({ high: { url: 'high' }, maxres: { url: 'max' } }), 'max');
});

test('accepts normal channel URLs, handles, and canonical IDs', () => {
    assert.deepEqual(parseChannelReference('https://www.youtube.com/@GoogleDevelopers'), {
        channelId: null,
        handle: 'GoogleDevelopers',
    });
    assert.deepEqual(parseChannelReference('@GoogleDevelopers'), {
        channelId: null,
        handle: 'GoogleDevelopers',
    });
    assert.deepEqual(parseChannelReference('UC_x5XG1OV2P6uZZ5FSM9Ttw'), {
        channelId: 'UC_x5XG1OV2P6uZZ5FSM9Ttw',
        handle: null,
    });
});

test('creates a causal-safe change and follow-up impact record', () => {
    const current = {
        ...previous,
        title: 'New title',
        thumbnailHash: 'new-hash',
        thumbnailUrl: 'https://img.example/new.jpg',
        thumbnailRecordKey: 'THUMBNAIL_new-hash',
        views: 200,
    };
    const change = createChangeRecord({
        previous,
        current,
        observedAt: '2026-09-03T11:00:00Z',
        beforeVelocity: 50,
    });
    const impact = createImpactRecord({
        pendingChange: { ...change, viewsAtDetection: 200 },
        current: { ...current, views: 400 },
        observedAt: '2026-09-03T13:00:00Z',
        sampleNumber: 2,
        isFinalSample: true,
    });

    assert.equal(change.observationalNotCausal, true);
    assert.equal(change.analysisStatus, 'awaiting-post-change-observation');
    assert.equal(impact.viewsPerHourAfterChange, 100);
    assert.equal(impact.velocityChangePercent, 100);
    assert.equal(impact.sampleNumber, 2);
    assert.equal(impact.isFinalSample, true);
    assert.equal(impact.observationalNotCausal, true);
});

test('flags repeated early rotations as a likely packaging test', () => {
    const withHistory = {
        ...previous,
        publishedAt: '2026-09-01T10:00:00Z',
        variantStartedAt: '2026-09-03T09:00:00Z',
        variantHistory: [
            { sequenceNumber: 1, title: 'First', thumbnailHash: 'first-hash' },
            { sequenceNumber: 2, title: 'Second', thumbnailHash: 'second-hash' },
        ],
    };
    const current = {
        ...withHistory,
        title: 'First',
        thumbnailHash: 'first-hash',
        views: 1000,
    };
    const change = createChangeRecord({
        previous: withHistory,
        current,
        observedAt: '2026-09-03T11:00:00Z',
        beforeVelocity: 1500,
    });
    assert.equal(change.rotationCount, 2);
    assert.equal(change.variantReused, true);
    assert.equal(change.isLikelyPackagingTest, true);
    assert.equal(change.priority, 'HIGH');
});
