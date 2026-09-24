
This is a record of the project owner's statement, made on 24 September 2026, about a written
grant of PDAS write authority. It is written for citation from `DEFECTS.md` D-12 and
`IFL-OPEN-QUESTIONS.md` item 3, in the same spirit as `handover/IFL-ANSWERS-2026-09-15.md`
records the 15 September meeting.

**Who:** Hassan sb, IFL. His role at IFL is not recorded anywhere in this repository.

**When:** 19 September 2026.

**Form:** a written WhatsApp message, sent directly to the SMS project owner. The owner holds
the message; it is not itself checked into this repository. An export or screenshot of it may
be added under `handover/` at the owner's discretion.

> **[PLACEHOLDER: WhatsApp export/screenshot not yet attached.** If one is added, it should
> live alongside this file, for example `handover/PDAS-WRITE-GRANT-2026-09-19-export.png` or
> `.pdf`, and this file should then link to it directly.]

**Scope, as stated by the owner:** the owner reports that IFL's message gave, in the owner's
paraphrase, "complete autonomy and permission to enable and work on the PDAS changing the DB."
The owner reads this as covering all nine of the rights listed in `IFL-OPEN-QUESTIONS.md` item
3:

1. EXECUTE on `CreateMaterial`
2. EXECUTE on `SetMaterialStatusActive`
3. EXECUTE on `AddBlend`
4. EXECUTE on `AddCount`
5. EXECUTE on `AddTubeType`
6. EXECUTE on `CreatePallet`
7. EXECUTE on `SetPalletStatusActive`
8. UPDATE on `dbo.Materials` alone (the vendor ships no UPDATE procedure, so a setpoint change
   is one guarded single-row update)
9. INSERT on `dbo.nhs_events`, the vendor's own event-log row written alongside it

No new objects, no DELETE, no other table, ever: the same bound `IFL-OPEN-QUESTIONS.md` item 3
states for the write path itself.

The owner states this grant covers both the local test copy (`PDAS_TP1U2_SEP07`) and the plant
database, and that process engineers will be the users of the resulting workflow.

**Owner's reading, stated plainly as a caveat:** the WhatsApp wording itself does not name the
nine rights individually. "All nine" is the owner's reading of a general statement of
permission, not a rights-by-rights confirmation written in IFL's own words. This record states
that distinction because it is the honest description of what exists: a general grant, read by
the owner as covering the full list this project already uses.

**Timeline, for context:**

- 11 September 2026: 2 of the 9 rights were confirmed; the form of that confirmation was not
  recorded. (This fact is drawn from `CLAUDE.md` hard constraint 3 as it stood before this
  change, not from the owner's 24 Sep statement.)
- 15 September 2026: authority was verbal only, true as of that date. See
  `handover/IFL-ANSWERS-2026-09-15.md`.
- 19 September 2026: the written WhatsApp message described above.
- 22 September 2026: commit `af420a4` enabled `PDAS_WRITE_ENABLED` locally only, against the
  local `PDAS_TP1U2_SEP07` copy, per that commit's own message.

Read this way, the 15 September record and the `af420a4` commit message were each true at their
own date; there is no remaining contradiction between them, only a gap the earlier records did
not carry forward.

**What still holds, regardless of this grant.** The code path (`pdasWrite.ts`,
`/api/changeover/execute`) has never run end to end. The plant stays off until Steps 2-5 run on
the owner's Windows laptop: all nine rights exercised through our code against
`PDAS_TP1U2_SEP07`, with backups, failure paths, and an EXECUTE-only "ibrahim"-shaped login
rehearsal, plus fixes for whatever those runs surface. `Q21`'s zero-modification rule still
applies in full to `DATA_TP1U2`. The PDAS exception this grant covers is bounded to the nine
rights listed above: no new objects, no DELETE, no other table. `PDAS_WRITE_ENABLED=false` in
`sms/.env` today; its comment claiming the flag was enabled on 22 September with IFL's grant
already given is the owner's to correct, and is only flagged, not edited, by this document or by
`DEFECTS.md`.

**Left to do:** IFL's own formal, written confirmation, tracked as `IFL-OPEN-QUESTIONS.md`
item 3, and provisioning of the `sms_pdas_writer` login.
