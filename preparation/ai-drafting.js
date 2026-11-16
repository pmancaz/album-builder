/*
  This module keeps the model prompt and output contract separate from the
  interface. That makes the important drafting rules easy to read and test.
*/

export const DEFAULT_OPENAI_MODEL = 'gpt-5.6-sol';

const DRAFT_FIELD_IDS = [
  'shortDescriptionInput',
  'longDescriptionInput',
  'mediaHeadlineInput',
  'mediaAngleInput',
  'playlistPitchInput',
  'tagsInput',
  'creditsInput',
];

function copyFields(project = {}) {
  return Object.fromEntries(DRAFT_FIELD_IDS.map((id) => [id, String(project.fields?.[id] || '')]));
}

function styleExample(project = {}) {
  return {
    artist: String(project.fields?.artistInput || ''),
    title: String(project.fields?.releaseTitleInput || project.name || ''),
    fields: copyFields(project),
    socialPosts: Array.isArray(project.socialPosts)
      ? project.socialPosts.map((post) => ({ title: String(post.title || ''), content: String(post.content || '') }))
      : [],
  };
}

export function selectStyleReferences(projects = [], currentProjectId = '', currentArtist = '') {
  const artist = String(currentArtist).trim().toLocaleLowerCase();
  return projects
    .filter((project) => project?.id && project.id !== currentProjectId)
    .sort((left, right) => {
      const leftSameArtist = String(left.fields?.artistInput || '').trim().toLocaleLowerCase() === artist;
      const rightSameArtist = String(right.fields?.artistInput || '').trim().toLocaleLowerCase() === artist;
      if (leftSameArtist !== rightSameArtist) return leftSameArtist ? -1 : 1;
      return String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''));
    })
    .slice(0, 5)
    .map(styleExample);
}

export function draftOutputSchema() {
  const properties = Object.fromEntries(DRAFT_FIELD_IDS.map((id) => [id, { type: 'string' }]));
  properties.socialPosts = {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['id', 'title', 'content'],
      additionalProperties: false,
    },
  };
  return {
    type: 'object',
    properties,
    required: [...DRAFT_FIELD_IDS, 'socialPosts'],
    additionalProperties: false,
  };
}

export function buildAiDraftRequest({ project, previousProjects = [], mode = 'draft', model = DEFAULT_OPENAI_MODEL } = {}) {
  const currentArtist = project?.fields?.artistInput || '';
  const styleReferences = selectStyleReferences(previousProjects, project?.id, currentArtist);
  const refreshInstruction = mode === 'refresh'
    ? 'This is a refresh. Re-read every current field as factual context, incorporate newly added information, and improve the copy without discarding useful existing wording.'
    : 'This is the first in-app draft. Fill the writing targets from the available release facts and brainstorm.';

  return {
    model: String(model || DEFAULT_OPENAI_MODEL).trim(),
    instructions: `You draft release copy for a small independent record label.

Success means every returned key is present and the result can be written directly into Release Preparer.

Use the current release and brainstorm as the only factual authority. Previous releases are style references only. Learn their wording, rhythm, point of view, restraint, and level of detail, but never transplant their facts, titles, dates, links, credits, collaborators, quotations, or achievements.

Do not invent factual claims. Preserve factual credits already supplied. Keep shortDescriptionInput at 500 characters or fewer. Make the playlist pitch concise and service-neutral. When one master is marked leadSingle, put that individual song at the forefront of playlistPitchInput, then explain how its sound, process, or meaning represents the full record. Do not turn the pitch into album-only copy or omit the selected song. If no lead single is selected, do not invent one. Return useful platform tags only when supported. Draft each supplied social-post slot, keeping announcement and countdown posts meaningfully different. Preserve every supplied social-post ID. ${refreshInstruction}`,
    input: JSON.stringify({
      currentRelease: {
        id: project?.id || '',
        name: project?.name || '',
        fields: project?.fields || {},
        masters: (project?.masters || []).map((track) => ({
          title: track.metadata?.title || '',
          artist: track.metadata?.artist || '',
          trackNumber: track.metadata?.trackNumber || '',
          leadSingle: Boolean(track.leadSingle),
        })),
        socialPosts: project?.socialPosts || [],
      },
      previousReleaseStyleReferences: styleReferences,
    }, null, 2),
    schema: draftOutputSchema(),
  };
}

export function mergeDraftIntoProject(project, draft, requestedProject = project) {
  const next = structuredClone(project);
  next.fields ||= {};
  DRAFT_FIELD_IDS.forEach((id) => {
    // A draft can take a while. Keep anything the author edited after the
    // request was sent, while accepting the other generated writing targets.
    if (typeof draft?.[id] === 'string' && project.fields?.[id] === requestedProject.fields?.[id]) {
      next.fields[id] = id === 'shortDescriptionInput' ? draft[id].slice(0, 500) : draft[id];
    }
  });

  const posts = Array.isArray(draft?.socialPosts) ? draft.socialPosts.filter((post) => post && typeof post === 'object') : [];
  const returnedPosts = new Map(posts.map((post) => [String(post.id || ''), post]));
  const requestedPosts = new Map((requestedProject.socialPosts || []).map((post) => [String(post.id), post]));
  next.socialPosts = (project.socialPosts || []).map((post) => {
    const update = returnedPosts.get(String(post.id));
    const requested = requestedPosts.get(String(post.id));
    return update && requested && post.content === requested.content
      ? { ...post, content: String(update.content || '') } : { ...post };
  });

  // A model may suggest a useful extra post. Existing IDs and titles remain
  // untouched, while genuinely new IDs can be appended safely.
  const existingIds = new Set(next.socialPosts.map((post) => String(post.id)));
  for (const post of posts) {
    const id = String(post.id || '');
    if (id && !existingIds.has(id) && !requestedPosts.has(id)) {
      next.socialPosts.push({ id, title: String(post.title || 'Additional post'), content: String(post.content || '') });
      existingIds.add(id);
    }
  }
  return next;
}
