# Privacy Policy

**Album Builder**  
**Effective date:** 8 November 2026

**Developer:** Pat Carroll

This policy explains how Album Builder handles information when you use it. Album Builder is primarily a local desktop application: your audio analysis, sequencing, saved projects, and exports are processed on your Mac rather than on a server operated by the developer.

## Information the app handles

Album Builder handles material that you deliberately select, drag into the app, or enter yourself, including:

- audio files and their file-system locations;
- album artwork;
- track titles, status labels, release metadata, comments, and sequencing choices; and
- the export folder you choose.

The app does not automatically scan your music library. It accesses audio and artwork after you choose or drop those files into the app.

## How information is processed

Waveform creation, playback, peak measurement, and integrated-LUFS analysis take place on your device. Album Builder does not upload your audio, artwork, metadata, or saved album projects to a server operated by the developer.

When you export an album, the app uses a locally installed copy of FFmpeg, when available, to create tagged copies in the folder you select. The original source audio files are not deliberately changed by this process.

## Local storage and retention

While an album is open, its working information is held in the app's memory. When you save an album project, Album Builder writes a JSON project file to the default application-data folder or the library folder you choose in Settings. Preparation notes, promotional copy, master metadata, artwork settings and video/Canvas settings are saved in that same album record. That file can include:

- release metadata and sequencing choices;
- track titles and optional status labels;
- paths to the original audio and artwork files; and
- a locally stored copy of the selected artwork used for the project preview.

Error reports are prepared locally when something goes wrong. They contain the available error message and technical details, basic interface state, and recent control names. They do not include note text, artwork, audio contents, or licence credentials. File names or paths can appear if they are part of the error. Nothing is automatically uploaded; you choose whether to copy and share a report.

The app also stores your current appearance choice on the device. Exported audio copies and the accompanying metadata file remain in the export folder you chose.

Deleting a saved album inside Album Builder removes that saved project record. It does not delete the original audio or artwork files, and it does not delete exports you previously created. Copies may remain in your backups, synchronised folders, or other storage systems according to how your Mac is configured.

The selected album library also holds an `Analysis/` folder of reusable waveform, loudness, duration and optional spectral data, keyed by hashes of the audio bytes. These derived files contain no audio copies or credentials and are never uploaded by the app. They can be removed and regenerated.

## Network access and third-party services

The interface uses local system fonts. Displaying it does not contact Google Fonts or another font service.

The default prototype build does not request a licence key, read saved licence credentials, or contact a licensing service. In an explicitly enabled commercial build, when you activate or check a purchased licence, Album Builder sends the licence key and checkout email address you enter to Lemon Squeezy. It also sends an identifier for that Mac when checking or deactivating its existing activation. Lemon Squeezy returns the licence status and the purchase/product details needed to confirm that the key belongs to Album Builder. The app keeps the licence key, checkout email, activation identifier, and the date of the most recent successful check in its local application-data folder. This information is not sent to a developer-operated server. Lemon Squeezy handles that information under its own privacy practices.

Optional AI drafting uses your own OpenAI API key. Only when you choose Draft release copy or Refresh current information does the app send release facts, brainstorm notes, current writing, master names/metadata and up to five previous releases as writing-style references to OpenAI. It does not send audio files or artwork. The API key is held in macOS Keychain, outside album JSON files; the model preference and reusable artist/artwork/video templates are stored locally. OpenAI handles submitted content under its own API terms and privacy practices. You can use manual editing and local exports without AI drafting.

FFmpeg and ffprobe run locally for audio tagging, video and Canvas export. Apart from the licence checks and user-requested OpenAI drafting described above, the reviewed app code does not contain a developer-operated server, analytics service, advertising service, crash-reporting service, account system, payment service, or cloud synchronisation service.

## Information the app does not request

The reviewed app does not request access to your location, contacts, camera, or microphone. It does not require an account or advertising identifier.

If you contact the developer for support, the developer will receive the contact details and information you choose to include in your message and may use them to respond to your request.

## Permissions and user control

Album Builder uses system file and folder pickers so you can choose audio, artwork, and export locations. It also accepts files you deliberately drag into its track list. You control which files are selected and where exports are written.

You can remove tracks from the current session, clear artwork, delete saved album records, or remove exported files using Finder. Removing a reference from Album Builder does not delete the original source file.

## Sharing and sale of information

Album Builder does not include code that sends your album content to the developer or sells it. Your content leaves the app only through actions you control, such as exporting files, placing them in a synchronised folder, or sharing them through another service.

## Children's privacy

Album Builder is a general music-production tool and is not directed at children under 13. The app does not include an account system or a feature intended to collect personal information from children.

## Security

Album Builder limits its own processing to the local app and the file locations described in this policy. You should protect your Mac account and maintain backups of important source files and projects. No method of storage or transmission is completely secure, and absolute security cannot be guaranteed.

## Changes to this policy

This policy may be updated as Album Builder changes. A revised policy will show a new effective date and will be included with the app or its project materials.

## Contact

Questions about this policy can be sent to:

info@pcarroll.au
