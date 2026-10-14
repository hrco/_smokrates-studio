# Instagram Reels setup

The studio sends a rendered video to Instagram as a Reel container. It posts only when you run the publish command.

## How the video reaches Meta
- Instagram Login has no resumable upload. Meta's upload host is only for Facebook Login for Business. The container call needs a public `video_url`.
- The draft script copies the mp4 to the Oracle box for a few minutes. Caddy serves it at `https://nopanicpost.donotpanic.space/ig-staging/<random name>.mp4`.
- Meta downloads the file while the container is IN_PROGRESS. The script then removes the file, also when the draft fails.
- The video is public at that URL during processing. The name is 32 random hex characters.
- The script needs `VPS_HOST` (the box address) and the SSH key (`VPS_SSH_KEY`, default `~/.ssh/oracle-vps.key`; `VPS_SSH_USER`, default `ubuntu`). These are the same settings as `scripts/deploy-site.sh`.
- If the removal fails, the script prints a warning with the remote path. Delete that file by hand.
- `scripts/deploy-site.sh deploy` syncs with `--delete` and wipes the staging folder. That is fine: staged files are temporary.
- You do not need webhooks, a callback URL or a verify token.

## Register the Meta app
1. Open developers.facebook.com and create the app `smokrates-automation`.
2. Use one personal account as the admin. Do not create a second account.
3. Add the use case **Manage messaging & content on Instagram**. Instagram does not appear in the app until you add it.
4. Keep the app in **Development** mode. You do not need App Review for your own account.

## Prepare the Instagram account
1. Switch the Instagram account to **Professional**.
2. Add the account as an **Instagram Tester** in the app roles.
3. Accept the tester invite in Instagram (Settings > Apps and websites).

## Get the token
1. Open the app, then **API setup with Instagram login**.
2. Add the Instagram account and generate a long-lived token.
3. Copy the token into `.env` as `INSTAGRAM_ACCESS_TOKEN`. Never commit `.env`.
4. Check the token:
   ```bash
   curl -s "https://graph.instagram.com/v23.0/me?fields=user_id,username" -H "Authorization: Bearer $INSTAGRAM_ACCESS_TOKEN"
   ```
5. The answer shows `user_id` and `username`.

## Refresh the token
1. The token lasts 60 days.
2. Run `npm run instagram:refresh` before it ends.
3. The script saves the new token in `.instagram/token.json` (git-ignored, mode 600) and prints the new expiry date.
4. The file wins over `INSTAGRAM_ACCESS_TOKEN` in `.env` from then on.
5. The draft and publish scripts warn when less than 7 days are left.

## Draft and publish
1. Render a video: `npm run render -- <slug>`.
2. Run `npm run instagram:draft -- out/<file>.mp4`.
3. The script reads the caption from `caption` in the sidecar JSON. Instagram needs it when the container is made.
4. The script stages the video on the Oracle box, checks the public URL, creates the container, waits for FINISHED, removes the staged file and writes `out/<file>.instagram.json`. Set `VPS_HOST` first.
5. The script prints the next command. Run it when you are ready to post:
   `npm run instagram:publish -- out/<file>.mp4`
6. The publish script prints the permalink. It refuses a second post of the same video.

## The 24 hour limit
- A container expires 24 hours after you make it.
- The publish script refuses an expired container.
- Run `npm run instagram:draft` again to make a new one.

## AI label
- Meta's API has no AI-label flag.
- Set the label by hand after you publish: open the Reel, then Edit > Advanced settings > AI label.
- The project rule is to label all AI content.
