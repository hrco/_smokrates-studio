# Tick setup

launchd asks the running daemon, every 15 minutes, to send at most one approved night to the TikTok inbox. You still open TikTok and tap Post. Nothing is sent until the week is approved, the night is due, and it has a render.

Start the daemon with `npm run studio:daemon`. Connect TikTok once with `npm run tiktok:auth`. If the client key and secret are missing, the daemon still starts and the tick answers that TikTok is not connected.

The template is for user airbook. It posts to `http://127.0.0.1:8724/api/tick` and appends curl's output to `~/Library/Logs/smokrates-tick.log`. If you change `STUDIO_PORT`, edit the URL in the template before you install it.

If the daemon stops during a send, the next start marks that job failed. The following tick tries again. A night that already has a publish row is not sent twice.

These two commands are yours. An agent does not load or remove the job.

## Install

```bash
cp ops/launchd/space.donotpanic.smokrates-tick.plist ~/Library/LaunchAgents/ && launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/space.donotpanic.smokrates-tick.plist
```

## Remove

```bash
launchctl bootout gui/$(id -u)/space.donotpanic.smokrates-tick && rm ~/Library/LaunchAgents/space.donotpanic.smokrates-tick.plist
```
