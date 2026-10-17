# NoPanicPost Privacy Policy

Last updated: 14 October 2026

NoPanicPost is a personal command-line tool. It runs on its owner's own computer. It sends videos that the owner made to the owner's TikTok account as drafts.

## What NoPanicPost uses

- **TikTok authorization.** When you sign in with TikTok, NoPanicPost receives an access token and a refresh token for the `video.upload` scope. It uses them only to upload your video to your TikTok inbox as a draft.
- **Your video file.** NoPanicPost reads the video file that you choose and sends it to TikTok. It sends it nowhere else.

NoPanicPost does not request, read or store your profile, followers, messages, contacts, location or viewing data.

## Where data is kept

- The tokens are saved in one file on your own computer (`.tiktok/tokens.production.json`), readable only by your user account.
- NoPanicPost has no server and no database. It sends nothing to the developer.
- NoPanicPost uses no analytics, no advertising and no tracking.

## Sharing

NoPanicPost shares data only with TikTok, and only to upload the video you chose. It does not sell or share data with anyone else.

## How long data is kept

The tokens stay on your computer until you delete them. TikTok access tokens expire after 24 hours. Refresh tokens expire after 365 days.

## How to remove access

1. In the TikTok app, open Settings and privacy > Security > Apps and services permissions (the name can vary by version), and remove NoPanicPost.
2. Delete the file `.tiktok/tokens.production.json` on your computer.

## Children

NoPanicPost is not for children under 13. It does not knowingly handle data of children.

## Changes

Changes to this policy are published at this address, with a new "Last updated" date.

## Contact

Open an issue at https://github.com/hrco/_smokrates-studio/issues
