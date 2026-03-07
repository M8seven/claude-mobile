# Posts da pubblicare — copia e incolla

---

## Reddit r/ClaudeAI

**Title:** I built Claude Code for iPad — it actually works. Looking for collaborators to take it further.

**Body:**

I built an agentic coding tool that lets Claude read, edit, search, and commit code — all running on iPad.

It's not a wrapper or a chat UI. It's a full agentic loop: Claude decides which files to read, makes edits, verifies changes, and can do 50+ tool calls per message. It has 7 tools (Read, Write, Edit, Glob, Grep, Bash, Git) all executing locally. I used it to develop itself.

The problem: iPad's platform limitations make it impossible to deliver a seamless single-app experience. iOS kills background processes, there's no real shell for running builds/tests, and IndexedDB gets purged after 7 days.

I'm looking for iOS developers, WebAssembly experts, or anyone who's pushed iPad's limits — to help figure out the last mile.

Repo: https://github.com/M8seven/claude-mobile
Full writeup: https://github.com/M8seven/claude-mobile/issues/1

---

## Reddit r/iPadPro

**Title:** I made an AI coding assistant that runs on iPad — Claude reads/edits code, commits to GitHub, all from Safari

**Body:**

I've been working on making real coding possible on iPad — not just editing text, but having an AI agent that can search your codebase, edit multiple files, run commands, and push to GitHub.

It works today: you open Safari on your iPad, describe what you want, and Claude autonomously reads files, makes changes, and commits. I built it using a-Shell + a custom web UI.

But I've hit walls with iOS limitations (background process killing, no real terminal, sandboxed filesystem). Looking for people who have experience pushing iPad to its limits — especially iOS devs who know about embedding JS runtimes or keeping background servers alive.

https://github.com/M8seven/claude-mobile

---

## Hacker News (Show HN)

**Title:** Show HN: Claude Code for iPad – Agentic AI coding tool with file ops, Git, shell

**Body:**

I built an agentic coding tool that runs on iPad. Claude reads your codebase, plans changes, edits files, and pushes to GitHub — autonomously, in a loop. 7 integrated tools (Read, Write, Edit, Glob, Grep, Bash, Git), all executing locally on the device.

The shell is a JS polyfill (~25 Unix commands with pipes, chaining, and redirection). Git uses isomorphic-git. API calls stream token-by-token via SSE.

I've hit iPad platform limits: no persistent background processes, no real shell for builds/tests, iOS purges IndexedDB after 7 days. Looking for collaborators to solve the last-mile problem — especially anyone with experience in iOS hybrid apps, WebContainers, or keeping background servers alive on iOS.

Repo: https://github.com/M8seven/claude-mobile
Detailed writeup: https://github.com/M8seven/claude-mobile/issues/1

---

## Twitter/X

**Post 1:**

I built Claude Code for iPad. It works.

Claude reads your code, edits files, searches your codebase, commits and pushes — all from an iPad.

7 tools. Agentic loop. Real streaming. Used it to build itself.

Now I need help with the last mile. iOS devs, WebAssembly people — let's talk.

https://github.com/M8seven/claude-mobile

**Post 2 (reply thread):**

The hard problems:
- iOS kills background processes
- No real shell (npm, python, make)
- IndexedDB purged after 7 days
- No single-app experience yet

If you've pushed iPad to its limits, I want to hear from you.

Full writeup: https://github.com/M8seven/claude-mobile/issues/1

---

## Dev.to

**Title:** I Built Claude Code for iPad — Here's How (and Where I'm Stuck)

Use the content from CALL_FOR_COLLABORATION.md (English section) as the article body.
Add tags: #ai #ipad #javascript #opensource

---

## Where to post (priority order)

1. **r/ClaudeAI** — most relevant audience, people who use Claude daily
2. **Hacker News (Show HN)** — high impact, dev-heavy audience
3. **Twitter/X** — tag @AnthropicAI, @alexalbert__, @aaborin for visibility
4. **r/iPadPro** — people who want to do real work on iPad
5. **Dev.to** — longer form, good for SEO
6. **Anthropic Discord** (if you have access)
