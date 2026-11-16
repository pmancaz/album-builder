/*
  Artist templates are deliberately simple data objects. Keeping the master
  updates here makes it easy to prove that every track receives the same artist
  and composer while all other imported metadata stays untouched.
*/

import { normaliseTags } from './social-posts.js';

export function normaliseArtistPreset(preset = {}) {
  preset = preset && typeof preset === 'object' && !Array.isArray(preset) ? preset : {};
  return {
    id: String(preset.id || ''),
    name: String(preset.name || preset.primaryArtist || ''),
    primaryArtist: String(preset.primaryArtist || ''),
    albumArtist: String(preset.albumArtist || preset.primaryArtist || ''),
    composer: String(preset.composer || ''),
    bandcampUrl: String(preset.bandcampUrl || ''),
    websiteUrl: String(preset.websiteUrl || ''),
    instagramUrl: String(preset.instagramUrl || ''),
    youtubeUrl: String(preset.youtubeUrl || ''),
    soundcloudUrl: String(preset.soundcloudUrl || ''),
    spotifyUrl: String(preset.spotifyUrl || ''),
    appleMusicUrl: String(preset.appleMusicUrl || ''),
    tags: String(preset.tags || ''),
    pressContact: String(preset.pressContact || ''),
  };
}

export function applyArtistPresetToMasters(masters, preset) {
  const clean = normaliseArtistPreset(preset);
  return masters.map((master) => ({
    ...master,
    metadata: {
      ...master.metadata,
      artist: clean.primaryArtist,
      composer: clean.composer || master.metadata?.composer || '',
    },
  }));
}

export function refreshedArtistPresetTags(currentTags, previousTemplateTags, nextTemplateTags) {
  const current = String(currentTags || '');
  const previous = String(previousTemplateTags || '');
  const next = String(nextTemplateTags || '');
  const signature = (value) => normaliseTags(value)
    .map((tag) => tag.toLocaleLowerCase())
    .sort()
    .join('\u0000');

  // Empty release tags should receive the template defaults. If the release
  // still contains the previous defaults, an updated template may refresh them.
  // Deliberately customised release tags are left alone.
  if (!current.trim() || (previous.trim() && signature(current) === signature(previous))) return next;
  return current;
}
