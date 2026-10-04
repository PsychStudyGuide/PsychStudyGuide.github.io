# Course-pack editing and encrypted publishing

The application code, private faculty editing data, and public encrypted bundle are intentionally separate.

Faculty use `faculty.html` to create or import a private `.coursepack.json` working file. That readable file contains the course material and must remain off GitHub. The same builder encrypts the working data into `course/course.bundle.json`, which is the only course-data file published with the student application.

## Course-pack responsibilities

- Course title, welcome language, colors, and companion name
- Exact institutional funding notice
- Instructor-approved model allowlist and price ceilings
- Chapters/units and lecture documents
- Exam study sets that reference chapters without duplicating their contents
- Companion persona and course/integrity rules

## Content provenance and privacy

Raw transcripts remain in private faculty storage. The private editing pack records whether each source still needs faculty review. Caption cleanup must preserve the raw source and must flag ambiguous, meaning-changing corrections for the instructor.

The encrypted website bundle uses AES-GCM. Its key is derived in the browser from the class code using PBKDF2-HMAC-SHA256 with a random salt and 600,000 iterations. The code itself is never written into the bundle.

## Publishing model

The static application is course-neutral. A different professor can reuse it by creating a separate GitHub Pages copy, preparing their own private course pack and code, and replacing only `course/course.bundle.json`. Students enter that professor's code; no student uploads course files.
