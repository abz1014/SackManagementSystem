# About this guide {unnumbered}

This guide covers the IFL Sack Management System (SMS): a web application that
reports on sack and cone production from IFL's TP1 Line 3 / Unit 2 yarn
spinning line, built for Ibrahim Fibres Limited (IFL).

## Who this guide is for

Two audiences share this book:

- **IFL's IT staff**, who install SMS on the plant PC, connect it to the SQL
  Server databases, keep it running, back it up, and troubleshoot it.
  Chapters 1 to 6 and 8 to 10, and appendices A and B, are written for this reader.
- **Daily users** — the GM, managers and process engineers of IFL's process
  department. Chapter 7 walks through each screen. Chapter 11 answers the
  questions this audience asks most often.

Both audiences are technical. SMS was built for one department, not a mix of
floor staff and management, so every screen is written in plain, direct
language rather than simplified for a non-technical reader.

## Conventions used in this guide

- Text shown in **bold** that is quoted from the screen itself — a button, a
  menu item, a column header — is copied exactly, including capitalisation.
- A shaded box like the one below is a command to type exactly as shown,
  or output to expect back:
  ```text
  example command or output
  ```
- A numbered step is followed by **"You should see: …"**, describing the
  result, and **"If it fails, see …"**, pointing at the relevant
  troubleshooting entry.
- `☐` marks a checklist item to tick off as it is confirmed.
- A blue box marked **Note:** adds useful context. An amber box marked
  **Warning:** flags something that can lose data or lock an account out if
  skipped.
- Placeholder paths use `C:\sms` for the install folder and `C:\sms-backups`
  for the backup folder — substitute the real folders IT chose during
  installation if they differ.

> **Note:** Every screenshot in this guide was taken from a demonstration
> system fed by a plant simulator that generates realistic but entirely
> synthetic readings, not IFL's real production data. Every screen the
> simulator feeds shows this in the wording itself — the provenance label
> reads [[Simulator]] and a sentence on screen states that the figures shown
> are the simulator's, not the plant's. **The real, live installation will
> never show this banner or label** — it appears only because these
> screenshots come from a demonstration, not because it is a normal part of
> the application.
