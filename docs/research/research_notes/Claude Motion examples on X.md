# Claude Motion examples on X

Researched 13 October 2026 from X posts, Anthropic's help center, and prompt-motion.com. Descriptions come from the posts and the gallery. The videos themselves were not re-watched.

There is no product named Claude Motion Studio. On X that phrase means either Anthropic's Claude Motion feature or a community GitHub harness.

## What Claude Motion is

Shipped 8 October 2026. Claude writes each animation as code. No video model, so no realistic footage and no generated people. One word, number, or timing can change and the rest stays. Export is MP4.

Beta on Team plans (on by default) and Enterprise plans (off until an owner enables it under Organization settings, Artifacts). Usage counts against the plan. Longer pieces cost more.

Start it three ways: ask for an animation in chat, pick Motion under Output, or open a Motion template from the Artifacts tab.

Anthropic's own prompt examples, from the help article:

- "Turn this quarterly report into a 30-second explainer for our all-hands."
- "Animate how our pricing plans compare, for the sales kickoff."
- "Make a short walkthrough of the setup steps for new customers."

Source: https://support.claude.com/en/articles/17454997-get-started-with-claude-motion

## Official launch posts

| Post | What it shows |
| --- | --- |
| [@claudeai, 8 Oct](https://x.com/claudeai/status/2108271552991252810) | Launch of Claude Dashboards and Claude Motion. About 60k likes, 11M views. 81-second demo. |
| [@claudeai follow-up](https://x.com/claudeai/status/2108271558170976743) | Motion turns reports, charts, or product walkthroughs into short animations. About 2.2k likes. |
| [@nateparrott, 8 Oct](https://x.com/nateparrott/status/2108278188808065051) | Designer at Anthropic. Loop is animate, point at a part to edit, then export. Opus 5.5 was already good at explainers, dataviz, and product demos; Motion is lightweight UI on top. |

## Examples posted after the launch

These use the product, not a Claude Code showreel.

| Who | Date | What they made | Post |
| --- | --- | --- | --- |
| @gavinpurcell | 10 Oct | 100 years of movie genres as a visual. Ran about 7 hours. About 50 seconds. | https://x.com/gavinpurcell/status/2108932593911816392 |
| @alisaqqt | 11 Oct | Anne Carson Nobel piece as a 2:20 film. | https://x.com/alisaqqt/status/2109258996435787916 |
| @kyleledbetter | 12 Oct | Product analytics through one MCP, turned into an interactive storybook for the team. | https://x.com/kyleledbetter/status/2109702939170275561 |
| @Atlas_fomo | 13 Oct | 90 days of heart-rate data from `hrv_recovery_log.csv`. 30 seconds, white, almost no text. Sleep helped recovery, alcohol hurt it, late meals were 70.2 ms without and 58.1 ms with (−12.1 ms), workouts barely moved it. Prompt rules: calculate every number from the CSV, and show relationships without claiming causation. Model picker read Opus 5.5, Medium. | https://x.com/Atlas_fomo/status/2110035793347502335 |
| @motion_so | 11 Oct | Same prompt on two tools: "Make a motion video about prompts." Claude Motion on the right, their product on the left. About 100 likes. | https://x.com/motion_so/status/2109412370175115294 |
| @travisrosser | 9 Oct | A PageSumo product animation. | https://x.com/travisrosser/status/2108599000182247879 |

Charlie Hills, 10 October, posted 16 product-launch clips: a dock, a glossy springy object, and a pill that grows into a countdown. One shared style brief, then one line per scene. He says each took 12 to 15 minutes even though the UI says 1 to 4 minutes, and three can run at once. The brief is behind a free email gate: https://charliehills.substack.com/p/16-claude-motion-prompts-and-my-brief

## Clips that caused the feature

Late September 2026. Claude Code plus Opus 5.5. Every frame is drawn in code. These are what Anthropic wrapped in the Motion UI.

The prompt that flooded X:

> make a dynamic 15-second motion graphics video that shows what an incredible motion designer you are, like it's your showreel for a résumé. go all out.

| Who | Date | Reach | Post |
| --- | --- | --- | --- |
| @stephanlivera | 25 Sep | About 17k likes, 2.3M views. 15 seconds, sound on. The one that stuck. | https://x.com/stephanlivera/status/2103315922098470926 |
| @ajith_io | 25 Sep | Same prompt. About 4.1k likes, 636k views. | https://x.com/ajith_io/status/2103449416325890146 |
| @shneural | 24 Sep | Same prompt on Opus 5.5 and GPT, side by side. About 6.8k likes, 1.9M views. | https://x.com/shneural/status/2103151003272962130 |
| @himanshutwtxs | 25 Sep | Same prompt, sound on. About 1.5k likes. | https://x.com/himanshutwtxs/status/2103495232637882858 |
| @whaleyxbt | 29 Sep | Claude Code `/effort` post turned into 22 seconds, 1080 square, 60 fps. One prompt, one revision, about 15 minutes. Sound synthesized in Python, no samples, mastered around −14 LUFS. Became the open-source toolkit below. | https://x.com/whaleyxbt/status/2105016650357457001 |

Other films from that week that roundups still cite: a "p(doom)" lyric video (@donaldjewkes), a history of Western civilization (@IterIntellectus), and a history of AI rendered entirely from code (@kimmonismus).

## Where the examples are collected

https://prompt-motion.com/ indexes the Opus 5.5 clips with the prompt, and sometimes the skill, behind each one. Category counts on 13 October 2026:

| Category | Clips |
| --- | --- |
| Product UI | 101 |
| Kinetic type | 97 |
| Music | 51 |
| Shapes | 44 |
| Particles | 43 |
| Charts | 33 |
| Diagrams | 31 |
| Characters | 27 |
| Photos | 23 |
| Phone | 22 |
| Code | 21 |

The showreel posts above are the first tiles.

## "Motion studio" repos

Recent posts that list "20 repos" or an "ex-Anthropic designer harness" copy the same list. Three of the underlying projects are real studios with their own films:

- https://github.com/whaleyxbt/claude-motion — taste rules in numbers, a frame-review loop, sound written in code. Gallery piece is "Spending your effort."
- https://github.com/GTKottman/mortiflix-oss — local studio. A person approves each stage.
- https://github.com/youneedgreg/motion-studio — engine, checks, and films: a booking flow, a UI morph loop, and a 96 BPM showreel.

Rendering under those harnesses is HTML, Remotion, or a canvas captured to MP4. That pipeline is older than the Claude Motion button and still works on plans that do not have the beta.

## What the briefs that worked share

- Name the audience, where it plays, and the length.
- Attach the real file (report, CSV, images).
- Put hard rules in the prompt. The HRV clip used "calculate every number from the CSV" and "do not claim causation."
- Reuse one style brief across scenes. Charlie Hills did this for all 16 clips.
- Edit by naming the thing: "Change the Q3 number to 18%." "Slow down the second scene."
