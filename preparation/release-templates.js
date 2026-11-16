import { buildTagCopy, normaliseSocialPosts } from './social-posts.js';

// These functions contain only formatting rules. Keeping them separate makes
// the platform layouts easy to test without opening the desktop interface.
export function formatDate(value, locale = 'en-AU') {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
}

function section(title, body) {
  if (!body?.trim()) return '';
  return `${title.toUpperCase()}\n${'_'.repeat(title.length)}\n${body.trim()}`;
}

function links(data) {
  const candidates = [
    ['Listen / stream', data.streamingUrl], ['Bandcamp', data.bandcampUrl], ['Digital download', data.downloadUrl],
    ['Spotify', data.spotifyUrl], ['Apple Music', data.appleMusicUrl], ['Website', data.websiteUrl], ['Instagram', data.instagramUrl], ['YouTube', data.youtubeUrl], ['SoundCloud', data.soundcloudUrl],
  ];
  return candidates.filter(([, value]) => value?.trim()).map(([label, value]) => `${label}: ${value.trim()}`).join('\n');
}

function facts(data) {
  return [
    ['Artist', data.artist], ['Title', data.title], ['Release date', formatDate(data.releaseDate)],
    ['Label', data.label], ['Catalogue number', data.catalogue], ['Genre', data.genre], ['UPC / EAN', data.upc],
  ].filter(([, value]) => value?.trim()).map(([label, value]) => `${label}: ${value.trim()}`).join('\n');
}

export function buildPlatformCopies(data) {
  const heading = [data.artist, data.title].filter(Boolean).join(' — ') || 'Untitled release';
  const bandcamp = [
    section('Album description', data.longDescription || data.shortDescription),
    section('Credits', data.credits), section('Release information', facts(data)), section('Links', links(data)),
  ].filter(Boolean).join('\n\n');

  const youtube = [heading, data.shortDescription, data.streamingUrl ? `LISTEN / DOWNLOAD\n${data.streamingUrl}` : '', data.longDescription,
    section('Credits', data.credits), section('Release details', facts(data)), section('Links', links(data)),
  ].filter((value) => value?.trim()).join('\n\n');

  const soundcloud = [heading, data.shortDescription || data.longDescription, data.streamingUrl ? `Listen / download: ${data.streamingUrl}` : '',
    section('Release details', facts(data)), section('Credits', data.credits), section('Links', links(data)),
  ].filter((value) => value?.trim()).join('\n\n');

  const media = [
    'MEDIA RELEASE', 'FOR IMMEDIATE RELEASE', data.mediaHeadline || heading, data.longDescription || data.shortDescription,
    data.mediaAngle, section('Release details', facts(data)), section('Credits', data.credits), section('Links', links(data)),
    data.pressContact ? section('Media contact', data.pressContact) : '',
  ].filter((value) => value?.trim()).join('\n\n');

  const socialPosts = normaliseSocialPosts(data.socialPosts, {
    socialReleaseDayInput: data.socialReleaseDay,
    socialPost2Input: data.socialPost2,
    socialPost3Input: data.socialPost3,
    socialPost4Input: data.socialPost4,
    socialPost5Input: data.socialPost5,
  })
    .map((post, index) => post.content.trim() ? `SOCIAL POST ${String(index + 1).padStart(2, '0')} — ${post.title.toUpperCase()}\n${'_'.repeat(18 + post.title.length)}\n${post.content.trim()}` : '')
    .filter(Boolean);
  const social = socialPosts.join('\n\n');
  const tags = buildTagCopy(data.tags);
  const playlistPitch = String(data.playlistPitch || '').trim();

  return { bandcamp, youtube, soundcloud, media, playlistPitch, social, tags };
}

export function applyFilenamePattern(pattern, track, release, index) {
  const clean = (value) => String(value || '').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
  const values = {
    track: String(track.trackNumber || index + 1).padStart(2, '0'), artist: track.artist || release.artist,
    title: track.title, album: track.album || release.title, catalogue: release.catalogue,
  };
  const stem = String(pattern || '{track} - {artist} - {title}').replace(/\{(track|artist|title|album|catalogue)\}/g, (_, key) => clean(values[key]));
  return clean(stem).replace(/[. ]+$/g, '') || `Track ${String(index + 1).padStart(2, '0')}`;
}
