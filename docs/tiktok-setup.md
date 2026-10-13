# TikTok draft upload setup

The studio uploads a rendered video to your TikTok inbox as a draft. It never posts.

## Register the app
1. Open developers.tiktok.com and create an app.
2. Set the platform to **Desktop**.
3. Add the products **Login Kit** and **Content Posting API**.
4. Enable the scope `video.upload`.
5. Register this redirect URI exactly: `http://127.0.0.1:8723/callback/`
6. If the app is in sandbox, add the Smokrates TikTok account as a sandbox target user.

## Configure the repo
1. Copy the client key and client secret into `.env`:
   - `TIKTOK_CLIENT_KEY`
   - `TIKTOK_CLIENT_SECRET`
2. Leave `TIKTOK_REDIRECT_URI` at its default unless you registered another one.

## Authorize once
1. Run `npm run tiktok:auth`.
2. Approve the request in the browser that opens.
3. Tokens are saved to `.tiktok/tokens.json` (git-ignored, mode 0600).
4. The refresh token lasts about a year. Run the auth step again when it expires.

## Upload a draft
1. Render a video: `npm run render -- <slug>`.
2. Run `npm run tiktok:draft -- out/<file>.mp4`.
3. The script prints the `publish_id` and the final status.
4. The script prints the caption from the sidecar JSON next to the video.

## Finish in TikTok
Drafts land in the TikTok inbox. They carry no caption.
1. Open the inbox notification in the TikTok app.
2. Edit the draft and paste the caption.
3. Turn on the AI-generated content label.
4. Tap Post.

## Limits
- Direct post needs a TikTok audit. An unaudited app posts as `SELF_ONLY` to a private account. This repo does not use direct post.
- At most 5 pending shares per 24 hours.
- The inbox init call allows 6 requests per minute.
- The status call allows 30 requests per minute. The script polls every 5 seconds.
- Single upload chunk only: videos up to 64 MB. Chunked upload is not built.

## Public site
TikTok needs a website, terms and privacy URL on a domain you can verify. The static site in `site/` serves them from the Oracle box. Follow this order:
1. At Hostinger, add an A record: `nopanicpost` -> `92.5.184.225`. Check it with `scripts/deploy-site.sh check`.
2. Run `npm run deploy:site`. You run it, not an agent: it publishes the site.
3. Enter the URLs in the TikTok developer portal:
   - Website: `https://nopanicpost.donotpanic.space/`
   - Terms of Service: `https://nopanicpost.donotpanic.space/terms/`
   - Privacy Policy: `https://nopanicpost.donotpanic.space/privacy/`
4. Verify the domain in the portal, with one of:
   - a DNS TXT record at Hostinger, or
   - a signature file: download it from the portal, then run `scripts/deploy-site.sh verify-file <path-to-tiktok-file>.txt`.
