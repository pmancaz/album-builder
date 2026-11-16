/*
  Social posts are stored as a small ordered list so a release can have as many
  announcements, track notes, reminders, or follow-ups as it needs. These
  helpers also convert projects saved by older versions of Release Preparer.
*/

const DEFAULT_POSTS = [
  ['Announcement', ''],
  ['A few days out', ''],
  ['Release day', 'socialReleaseDayInput'],
  ['Story', 'socialPost2Input'],
  ['Track focus', 'socialPost3Input'],
  ['Process', 'socialPost4Input'],
  ['Follow-up', 'socialPost5Input'],
];

export function normaliseSocialPosts(posts, legacyFields = {}) {
  if (Array.isArray(posts) && posts.length) {
    const normalised = posts.map((post, index) => ({
      id: String(post?.id || `social-${index + 1}`),
      title: String(post?.title || `Post ${String(index + 1).padStart(2, '0')}`),
      content: String(post?.content || ''),
    }));
    const announcement = normalised.find((post) => post.id === 'social-announcement' || post.title.trim().toLocaleLowerCase() === 'announcement');
    const fewDaysOut = normalised.find((post) => post.id === 'social-few-days-out' || post.title.trim().toLocaleLowerCase() === 'a few days out');
    const standardIds = new Set([announcement?.id, fewDaysOut?.id].filter(Boolean));

    // Older saved releases already have their release-day and follow-up posts.
    // Add the two new pre-release slots without changing or duplicating any
    // existing announcement captions and IDs.
    return [
      announcement || { id: 'social-announcement', title: 'Announcement', content: '' },
      fewDaysOut || { id: 'social-few-days-out', title: 'A few days out', content: '' },
      ...normalised.filter((post) => !standardIds.has(post.id)),
    ];
  }

  return DEFAULT_POSTS.map(([title, fieldId], index) => ({
    id: `social-${index + 1}`,
    title,
    content: String(fieldId ? legacyFields?.[fieldId] || '' : ''),
  }));
}

export function normaliseTags(value) {
  const source = Array.isArray(value)
    ? value
    : Array.from(String(value || '').matchAll(/#([^#,\n]+)|([^#,\n]+)/g), (match) => match[1] || match[2]);
  const seen = new Set();
  return source
    // A hashtag starts a new tag, so "#ambient #drone #chill" works alongside
    // the older comma/new-line style. Text after one hashtag can still contain
    // spaces, allowing entries such as "#deep listening".
    .map((tag) => String(tag).trim().replace(/^#+\s*/, ''))
    .filter((tag) => {
      const key = tag.toLocaleLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function buildTagCopy(value) {
  const tags = normaliseTags(value);
  if (!tags.length) return '';
  const bandcamp = tags.join(', ');
  const soundcloud = tags.map((tag) => `#${tag.replace(/\s+/g, '')}`).join(' ');
  return `BANDCAMP TAGS\n_____________\n${bandcamp}\n\nSOUNDCLOUD TAGS\n_______________\n${soundcloud}`;
}
