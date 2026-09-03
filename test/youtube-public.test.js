import test from 'node:test';
import assert from 'node:assert/strict';
import {
    parseChannelIdFromHtml,
    parseYouTubeFeed,
} from '../src/lib/youtube-public.js';

test('resolves a channel ID from a canonical YouTube channel link', () => {
    const html = '<link rel="canonical" href="https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw">';
    assert.equal(parseChannelIdFromHtml(html), 'UC_x5XG1OV2P6uZZ5FSM9Ttw');
});

test('normalizes title, thumbnail, views, and likes from a public feed entry', () => {
    const xml = `
        <feed>
          <entry>
            <yt:videoId>abc123</yt:videoId>
            <yt:channelId>UC_x5XG1OV2P6uZZ5FSM9Ttw</yt:channelId>
            <title>Build &amp; ship</title>
            <author><name>Google for Developers</name></author>
            <published>2026-09-01T23:00:14+00:00</published>
            <updated>2026-09-02T00:32:14+00:00</updated>
            <media:group>
              <media:thumbnail url="https://i.ytimg.com/vi/abc123/hqdefault.jpg" width="480" height="360"/>
              <media:community>
                <media:starRating count="102" average="5.00" min="1" max="5"/>
                <media:statistics views="3194"/>
              </media:community>
            </media:group>
          </entry>
        </feed>`;
    const [video] = parseYouTubeFeed(xml);

    assert.equal(video.videoId, 'abc123');
    assert.equal(video.title, 'Build & ship');
    assert.equal(video.channelTitle, 'Google for Developers');
    assert.equal(video.views, 3194);
    assert.equal(video.likes, 102);
    assert.equal(video.thumbnails.high.url, 'https://i.ytimg.com/vi/abc123/hqdefault.jpg');
});

