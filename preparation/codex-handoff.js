/*
  The handoff text gives Codex enough context to edit one saved release without
  guessing which project the brainstorm belongs to. The field names below match
  the saved JSON exactly, so the prompt remains useful outside the app.
*/

export function buildCodexHandoff({
  projectPath = '',
  projectId = '',
  projectName = '',
  releaseTitle = '',
  artist = '',
  brainstorm = '',
} = {}) {
  const identity = [
    projectName ? `Release project: ${projectName}` : '',
    releaseTitle ? `Release title: ${releaseTitle}` : '',
    artist ? `Artist: ${artist}` : '',
    projectId ? `Project ID: ${projectId}` : '',
    projectPath ? `Saved project file: ${projectPath}` : '',
  ].filter(Boolean).join('\n');

  return `RELEASE PREPARER — CODEX DRAFTING REQUEST

${identity}

Please work on this specific Release Preparer project by editing the saved JSON file listed above. Do not control the Release Preparer interface or my computer.

Read the complete project file first so you understand the existing release facts, links, credits, masters, and any copy that has already been written.

Before drafting, look in the same projects folder as the saved project file and inspect up to five of the most recently updated previous release JSON files, excluding this current project. Prefer previous releases by the same artist, then use other label releases when useful. Study their descriptions, media copy, playlist pitches, tags, and social posts to understand the wording choices, language, tone, sentence rhythm, point of view, and amount of detail I tend to use.

Use those previous releases only as a style reference. Do not carry across their facts, track titles, dates, catalogue numbers, links, quotations, credits, collaborators, or claims. The current project and brainstorm are the factual authority. If no previous releases are available, continue using the current material alone.

Then interpret the brainstorm below and draft suitable text for the release. Review every writing target listed below, including playlistPitchInput, tagsInput, and the expandable socialPosts array. When the current facts and brainstorm support useful copy, fill an empty target rather than leaving it blank simply because an earlier Release Preparer version did not include it.

Update the appropriate values inside the JSON object's "fields" section:
- shortDescriptionInput — concise album/listing description, maximum 500 characters
- longDescriptionInput — full album description and release story
- mediaHeadlineInput — clear media-release headline
- mediaAngleInput — media-release body angle, context, and useful story details
- playlistPitchInput — one concise, adaptable editorial playlist pitch suitable for Spotify for Artists, Apple Music for Artists, TIDAL, and similar services. Inspect the masters array for the one entry with "leadSingle": true. Put that individual song at the forefront of the pitch, then connect its sound, process, or meaning to the full record. If no master is marked, do not invent a lead single.
- tagsInput — useful platform tags only when supported by the release facts and brainstorm; hashtag-separated input such as "#ambient #drone #chill" is accepted
- creditsInput — only add or refine credits when the brainstorm or existing project contains factual credit information

Social copy is stored in the JSON object's top-level "socialPosts" array. Each entry has "id", "title", and "content". The standard sequence begins with two pre-release posts: "Announcement" for the first reveal of the artist, release title, and release date; then "A few days out" for a distinct countdown or reminder shortly before release. When the saved release facts support them, draft or improve both of these entries as well as the later release-day, story, track-focus, process, and follow-up posts. Keep the two announcement captions meaningfully different rather than repeating the same wording. Add more entries when the brainstorm supports another useful post. Preserve the ID of every existing entry. Give each new entry a unique string ID and a short practical title.

The Bandcamp, YouTube, SoundCloud, media-release, playlist-pitch, tag, and social outputs are generated from those shared fields, so do not create a separate document for them. Preserve the JSON structure and all unrelated values, including IDs, release dates, catalogue numbers, URLs, master metadata, artwork, templates, and export settings. Do not invent factual claims, quotations, credits, collaborators, links, dates, or achievements. Leave unsupported factual fields unchanged. Keep the writing specific to the voice and meaning in the brainstorm while following the established voice found in previous releases.

After writing the changes back to the same project file, update its "updatedAt" value to the current ISO date and time, then tell me briefly which fields you changed. I will use “reload from saved file” in Release Preparer to see the result.

BRAINSTORM
__________
${String(brainstorm).trim()}`;
}
