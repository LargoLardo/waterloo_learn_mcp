# waterloo-learn-mcp

Read-only local MCP server for University of Waterloo LEARN courses, slides,
deadlines, grades, assignments, announcements, and course outlines.

It uses **STDIO**: ChatGPT desktop or Codex starts the Node process locally and
talks to it through pipes. There is no public URL, tunnel, open port, MCP OAuth
or token, Developer mode, or manually created plugin.

## Connect to ChatGPT desktop (Windows)

### 1. Install the requirements

- [ChatGPT desktop](https://chatgpt.com/download), signed in
- Node.js 20 or newer
- Git
- [Codex CLI](https://developers.openai.com/codex/cli)

Confirm Node and Codex are available in PowerShell:

```powershell
node --version
codex --version
```

### 2. Download and set up the server

```powershell
git clone https://github.com/LargoLardo/waterloo_learn_mcp.git
cd waterloo_learn_mcp
npm run setup
```

A browser opens. Sign in to LEARN with WatIAM, approve Duo, and wait for the
terminal to print `Setup complete`. Setup installs dependencies, builds the
server, saves the LEARN session to ignored `auth.json`, and registers the local
MCP in the configuration shared by ChatGPT desktop and Codex.

> **At the start of every study session:** run `npm run login` and complete
> WatIAM and Duo. Running MCP processes detect the refreshed `auth.json` on the
> next tool call, so you do not need to restart ChatGPT desktop.

### 3. Enable and test it in ChatGPT desktop

1. Fully quit ChatGPT desktop, including its Windows system-tray process, then
   reopen it.
2. Start a new chat and type `/mcp`. You can also check **Settings > MCP
   servers**; some app versions show the list under **Plugins**.
3. Confirm `waterloo-learn-mcp` is present and enabled. `Auth unsupported` is
   normal for a local STDIO server.
4. Ask: **“List my Waterloo LEARN courses.”**

Do not enable Developer mode or use **Plugins > +** to create a connection.
That flow is for remote HTTPS MCP servers; this server is registered locally.

PDF slides work immediately. PowerPoint files require LibreOffice:

```powershell
winget install TheDocumentFoundation.LibreOffice
```

### Manual registration

If automatic setup reaches the login step but the MCP does not appear, run:

```powershell
npm install
npx playwright install chromium
npm run build
npm run login
codex mcp add waterloo-learn-mcp -- node C:\absolute\path\to\waterloo_learn_mcp\dist\index.js
codex mcp list
```

Then fully restart ChatGPT desktop once to load the MCP registration. Later
`npm run login` refreshes the running MCP automatically without another restart.

## Authentication

There are two separate connections:

1. **ChatGPT → MCP:** local STDIO pipes. No OAuth or bearer token is needed, so
   the UI may report `Auth unsupported`.
2. **MCP → LEARN:** authenticated HTTPS using the WatIAM/Duo browser session in
   `auth.json`.

`auth.json` is never returned as MCP output. Requested course data is returned
to ChatGPT so it can answer you.

## Tools

| Tool | Purpose |
| --- | --- |
| `list_courses` | List enrolled courses and IDs |
| `get_announcements` | Read announcements and attachments |
| `get_content` | Browse modules, topics, files, and links |
| `get_topic_file` | Render selected PDF/PPT/PPTX slides as images |
| `get_grades` | Read grades, weights, and feedback |
| `get_assignments` | Read assignments, submissions, and feedback |
| `get_upcoming` | Read upcoming events and due dates |
| `get_course_outline` | Read the official course outline/syllabus |
| `search_drive_files` | Search an optional configured Drive folder |
| `get_drive_file` | Render an allowed Drive file as page images |

All tools are read-only. Slide tools accept pages such as `"4"`, `"2-6"`, or
`"2,4,7-9"` and return up to 30 page images per call.

## Optional configuration

Copy `.env.local.example` to `.env.local` only if you want login autofill,
custom cache paths, or Google Drive search. `.env.local` is ignored by Git.

For Drive search, enable the Google Drive API and set either
`GOOGLE_DRIVE_API_KEY` for a public/shared folder or a short-lived
`GOOGLE_DRIVE_ACCESS_TOKEN` with the `drive.readonly` scope. Limit searchable
folders with `GOOGLE_DRIVE_FOLDER_IDS`.

## GitHub safety

Never commit `auth.json`, `.env.local`, or `cache/`. They are ignored, but check
before pushing:

```powershell
git diff --cached
git ls-files auth.json .env.local "cache/**"
```

The second command must print nothing.

## Development

```powershell
npm test
npm run build
```

## Disclaimer

This unofficial project is not affiliated with the University of Waterloo or
D2L. Use it only with your account, respect university policies and course
copyright, and verify important grades, deadlines, and policies in LEARN.
