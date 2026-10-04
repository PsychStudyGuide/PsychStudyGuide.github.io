# Course Study Companion

A mobile-first, course-grounded AI study companion for college students.

The application uses professor-provided materials as its evidence base, supports lecture/chapter/exam study scopes, and limits students to an instructor-approved low-cost OpenRouter model lineup.

## Privacy architecture

- The public repository contains the reusable application and an **encrypted** course bundle.
- Readable transcripts and private faculty editing files must never be committed.
- Students unlock the bundle in their browser with a professor-provided class code.
- The class code is not stored in the repository or encrypted bundle.
- Personal-device mode can remember the decrypted course locally; shared-device mode keeps it only for the current session.

The `.gitignore` file blocks the usual readable course-pack and source locations as an additional guard against accidental publication.

## Current pilot

- Course: General Psychology
- Hosting target: GitHub Pages
- Runtime: static HTML, CSS, and JavaScript
- Student AI access: personal OpenRouter API key, stored only in the student's browser
- Published course data: `course/course.bundle.json` (AES-GCM encrypted)
- Faculty editor: `faculty.html`

## Faculty workflow

1. Open `faculty.html` through the hosted site or a local static server.
2. Import a private `.coursepack.json` editing backup or create a new course.
3. Add chapters, transcripts, study sets, voice, and institutional language.
4. Download a private editing backup and store it somewhere safe.
5. Generate a strong class code and download `course.bundle.json`.
6. Replace only `course/course.bundle.json` in the public repository.

Only the encrypted bundle belongs on GitHub.

## Local preview

Serve the repository root with any static web server. For example:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`.
