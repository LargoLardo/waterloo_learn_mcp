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
> WatIAM and Duo. The command refreshes `auth.json` and also repairs a missing
> Codex MCP registration. Running MCP processes detect refreshed authentication
> on the next tool call. If registration had to be repaired, the command tells
> you to restart ChatGPT/Codex once so it can load the restored server.

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

PDF slides work immediately. PowerPoint and Word files require LibreOffice:

```powershell
winget install TheDocumentFoundation.LibreOffice
```

### Manual registration

If automatic setup reaches the login step but the MCP does not appear, run:

```powershell
npm install
npx playwright install chromium
npm run build
npm run register
codex mcp list
```

Then fully restart ChatGPT desktop once to load the MCP registration. Later
`npm run login` refreshes the running MCP and verifies that its registration is
still present. It restores a missing entry without first deleting healthy MCP
configuration.

Run `npm run login` separately whenever the saved WatIAM/Duo session needs to
be refreshed; it performs the same registration check after saving the session.

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
| `get_exam_context` | Gather exam announcements, events, syllabus, lesson files, and past assessments by course code/name or ID |
| `search_course_materials` | Search up to 60 course files and return relevant passages with file/page references |
| `get_announcements` | Read announcements and attachments |
| `get_content` | Browse modules, topics, files, and links |
| `get_topic_file` | Return selected PDF/PowerPoint/Word pages as text and images |
| `get_grades` | Read grades, weights, and feedback |
| `get_assignments` | Read assignments, submissions, and feedback |
| `get_upcoming` | Read upcoming events and due dates |
| `get_course_outline` | Read the official course outline/syllabus |
| `search_drive_files` | Search an optional configured Drive folder |
| `get_drive_file` | Return an allowed Drive file as page text and images |

All tools are read-only. Slide tools accept pages such as `"4"`, `"2-6"`, or
`"2,4,7-9"` and return up to 30 page images per call.

For exam preparation, call `get_exam_context` with a course such as `"CS 135"`
and an optional assessment such as `"midterm 2"` (default: `"final exam"`). It
gathers the available sources in one call and reports warnings for missing
sources, including optional Google Drive access.

Then use `search_course_materials` with subject concepts from the exam scope.
It indexes 40 files by default (`maxFiles` can be raised to 60) and caches
extracted text locally for 24 hours. Results include file/page references and
calls to `get_topic_file` for inspecting diagrams. Set `refresh: true` to
redownload files before the cache expires. Scanned pages without a text layer
still need visual inspection; this search does not perform OCR.

## Optional configuration

Copy `.env.local.example` to `.env.local` only if you want login autofill,
custom cache paths, or Google Drive search. `.env.local` is ignored by Git.

`LEARN_MATERIAL_CACHE_DIR` overrides the extracted-text cache directory, which
defaults to ignored `cache/materials/`. Treat it as private course material.

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
