# IFL questions — what we already know vs. what we still need to ask

Cross-referenced against the 70-question draft ("IFL / Hassan SB — Simple Requirement Questions") on 11 Sep 2026. Question numbers match that draft exactly.

Each answered item is tagged with where the answer comes from:
- **[IFL said so]** — IFL or their representative stated this directly, in words.
- **[We measured it]** — determined from IFL's own data or documents, but never confirmed by IFL in words.
- **[Our design]** — not a fact about IFL at all; this is a choice already built into the software, and the "question" is really asking IFL to bless it.

---

## Part 1 — Questions we already have an answer to (34 of 70)

### A. Machines

**2. Does each machine have a unique machine number/name?**
Each machine has a unique number, 1 through 14 (the database column is `MachineNo`, formerly named `Source`). No name beyond the number has ever come from IFL — that's why the software has its own local screen for typing in a friendly name per machine. *[We measured it]*

**5. Does every sack record tell us which machine produced/packed that sack?**
No. The sack table has no machine or station column of any kind, in either the July or September data. This is the main reason per-machine sack stock can't be built from what IFL has supplied. *[We measured it]*

*(Question 1, "14 machines — correct?", is close to answered but not quite: see Part 2's note.)*

### B. Cone Weight

**6. Which system/database currently contains the cone weight data?**
`DATA_TP1U2`, table `pack1_TP1U2`. *[We measured it]*

**7. Are ALL cone weights saved, or only rejected/selected cones?**
All of them — roughly 142,500 cones were weighed and recorded over the 19-day July sample alone, not a sample of them. Rejects are additionally logged in a separate table on top of this. *[We measured it]*

**8. What is the normal target cone weight?**
There is no single "normal" weight — it's set per product in IFL's own product-master database. Currently active products run at 1,960 g; some now-retired products ran at 1,950 g. *[We measured it]*

**9. Is the allowed weight range different for different products?**
Yes — tolerances of ±30 g, ±40 g, and ±50 g all appear across different products in the real data. *[We measured it]*

**11. When a cone is rejected, does the database tell us why it was rejected?**
Yes, in the sense that separate tables exist for quality-inspection rejects and weight rejects, each carrying an inspection-result code. What the codes mean in plain English is not known — that's question 12, still open. *[We measured it]*

### C. Product Information

**13. What information identifies a product?**
Blend, count, and tube type together key a product record, each with its own reference table in IFL's product-master database. A lot number exists at the pallet level, but nothing links it down to an individual product record. *[We measured it]*

**14. When production changes from Product A to Product B, how is this currently recorded?**
Through IFL's own vendor software: the old product is deactivated and a brand-new product record is created — there is no "edit" of an existing one. Confirmed by reading the vendor's own procedures directly, and independently corroborated by IFL's own change log, which shows one of their engineers hitting exactly this limitation four times in six minutes on 18 August 2026 while trying to do the opposite. *[We measured it]*

**15. Does the existing system/database automatically know which product is running?**
As of IFL's August 2026 database rebuild, yes — every cone, sack, and reject reading now carries its own product identifier automatically. IFL confirmed on 11 September 2026 that this identifier is reliable. Before that rebuild, no such link existed at all. *[IFL said so, for the reliability part; We measured it, for the mechanism]*

**16. Should the engineer select the current product from our software?**
Already built this way — a Current Product selector is the fallback used whenever a reading doesn't carry its own product identifier. *[Our design]*

**17. Should old cones keep the old product and new cones use the new one?**
Already built this way — every reading is judged against whatever product and limits were in force at that reading's own timestamp, never against today's setting. *[Our design]*

**18. Should our software be allowed to add/change/retire products in PDAS?**
Wanted, yes — IFL's own engineers already make exactly this kind of change by hand today. The capability is built. What's still missing is IFL's confirmation *in writing* before it's switched on (see Part 2). *[IFL said so — verbally; written sign-off still pending]*

### D. Sack Data

**20. Which database contains the sack information?**
Same database as cones — `DATA_TP1U2`, table `sack1_TP1U2`. *[We measured it]*

**21. What information is saved for every sack?**
Sack number, weight, a pass/fail flag, and a timestamp. That's the complete set of fields. *[We measured it]*

**22. Does each sack have a unique number/ID?**
There's an internal row id that is reliably unique. The sack-number field itself is not reliable for this on its own — it periodically resets to a low number. *[We measured it]*

**23. Does each sack have weight / date-time / product / machine number / lot / pallet number?**
Weight — yes. Date/time — yes (see question 25 for what it actually means). Product — yes, since September. Machine number — no. Lot or pallet number — no; sacks aren't linked to IFL's pallet/lot records at all. *[We measured it]*

**25. What exactly does the sack timestamp mean?**
It's the time the record was inserted into the database, not when weighing started or finished. Determined directly from the plant's own database triggers — IFL has never been asked to confirm this in words. *[We measured it]*

**26. Can we know exactly which cone(s) went into each sack?**
No. There is no key linking a cone to a sack anywhere in the data. Direct measurement shows anywhere from 0 to 250 cones between two consecutive sacks — nowhere near the ~25 simple arithmetic would suggest. *[We measured it]*

**27. If not, is it enough to show sack information separately from cone information?**
Already built this way — a sack's detail view shows "cones weighed between the previous sack and this one" with the approximation stated in the same sentence, never presented as an actual packing list. *[Our design]*

### G. Users

**38. Who will use the software?**
IFL's own representative confirmed this directly: the GM, managers, and process/quality engineers — one technical group, not a mix of technical and floor-worker audiences. *[IFL said so]*

**39. What should each person be allowed to do?** *(partial)*
Following from question 38's answer: every signed-in account can see everything; only specific write actions are restricted by rank. Which specific action belongs at which rank (questions 40–41) has never been specified by IFL — today's rank assignments are the developer's own reasonable defaults. *[IFL said so, for the general shape; the specifics are Part 2]*

**42. Who should be allowed to see reports?**
Everyone signed in — this follows directly from question 38's answer. *[IFL said so]*

### I. AI / Calibration

**49. Do you have historical records showing when an engineer adjusted/calibrated a machine?**
No such records exist anywhere in IFL's own systems. This is exactly why the software built its own calibration-adjustment ledger from scratch instead of importing one. *[We measured it, by absence]*

**50. Do you have records showing the weight before and after each calibration?**
Same answer — no, none exist. The software's own ledger now records a signed before/after amount going forward. *[We measured it, by absence]*

### J. Historical Data

**56. Can you provide the 10 July – 5 August 2026 data specifically?**
It exists at IFL. It was simply never included in the sample they sent. Confirmed directly by you (the project owner) — not yet formally requested from IFL, and that request is still the single highest-priority item on the open list. *[IFL said so — indirectly, via the owner]*

### K. Database / PLC

**60. Can IFL provide the PDAS database details/stored procedures?**
Already have this, in full, from the sample copy: 18 tables, 13 stored procedures, 3 views, 14 triggers — every procedure's actual code already read and documented. What's still missing is the same level of access against the *live* running system, not a sample (see Part 2). *[We measured it, against the sample]*

**64. Direct PLC connection, or is reading the existing databases enough?**
Reading the databases is acceptable and is exactly what's being built. IFL's earlier answer explicitly placed direct PLC integration out of scope. *[IFL said so]*

**58/59. Read-only access to the Cone / Sack Packing database.** *(partial)*
These are the same database, `DATA_TP1U2`, holding both tables. A sample copy has already been used extensively with full read access. What's still missing is a dedicated, ongoing read-only login on the plant's actual live server. *[We measured it against a sample; the live-server grant is Part 2]*

**61/62. What PLC is used for cones / for sack packing?** *(partial)*
Both go through the same acquisition layer. IFL's own PLC registry lists exactly two PLC connections — one for sacks, one for cones — each with a known network address. The exact PLC hardware *model* is not established: the project's own brief assumes one Siemens model, but the only picture of hardware in any IFL-supplied document is a stock photo of a different model, so neither should be treated as confirmed. *[We measured it — network identity only, not the model]*

### L. Hardware

**69. Is there an existing network connection between the server and the required databases/PLCs?** *(partial)*
The plant's network already separates PLC addresses from the server address into two different ranges — that much is on record. Whether those ranges are genuinely isolated, and whether the machine that will run this software can already reach both, is not established. *[We measured it, partially]*

---

## Part 2 — Questions we don't have an answer to (36 of 70)

### A. Machines
- **1.** 14 Rieter cone winding machines — is this correct? *(strongly suggested by two pieces of IFL's own evidence — see the caveat below — but never confirmed by IFL in words; worth a one-line rubber-stamp rather than a real ask)*
- **3.** Do machines have stations/spindles/heads that need separate identification?
- **4.** How many sack-packing machines are there?

### B. Cone Weight
- **10.** Who decides the allowed + and − weight limits?
- **12.** What does every reject code mean?

### C. Product Information
- **19.** If SMS may write to PDAS, who is authorized to make those changes?

### D. Sack Data
- **24.** Is sack weight gross, net, or something else?

### E. Sack Stock — entirely open
- **28.** What exactly do you mean by "sack stock for each machine"?
- **29.** Who will enter sack receipt/issue information?
- **30.** Is sack stock currently tracked in Excel, ERP, manually, or elsewhere?
- **31.** Does every sack type have a separate code?
- **32.** Do different machines use different sack types?

### F. Reports — entirely open
- **33.** What reports are wanted every day?
- **34.** What reports are wanted every shift?
- **35.** What should management see on the main dashboard?
- **36.** Excel/PDF format?
- **37.** Should the system auto-email reports?

### G. Users
- **40.** Who should be allowed to change product limits?
- **41.** Who should be allowed to change products?
- **43.** Who should be allowed to make sack-stock adjustments?

### H. Live Data / Speed — entirely open
- **44.** How quickly should new production data appear?
- **45.** Is a delay acceptable if the source database itself delays? *(the honest answer is already forced by the ~18-minute delay we've measured in IFL's own acquisition layer, regardless of what IFL would prefer — worth stating to Hassan as a fact, not really a question to put to him)*

### I. AI / Calibration
- **46.** What exactly does "AI should recommend calibration" mean, concretely?
- **47.** Recommendation only, or automatic machine adjustment?
- **48.** If automatic, who approves it?

### J. Historical Data
- **51.** How much historical cone data can IFL provide?
- **52.** How much historical sack data can IFL provide?
- **53.** Can 6 months be provided?
- **54.** Can 12 months be provided?
- **55.** Does older data exist in backups?
- **57.** Can 12 months of everything (readings, rejects, product info, machine ID, sacks, calibration records) be provided?

### K. Database / PLC
- **63.** What communication protocol do the PLCs use?
- *(58, 59, 61, 62 are partially answered — see Part 1 — but the live-server access grant and the PLC model are still genuinely open pieces of them.)*

### L. Hardware — entirely open
- **65.** Does IFL already have a server/industrial PC for this?
- **66.** Where should the software be installed?
- **67.** Is there already a PC/display near the production floor?
- **68.** Is there a UPS for the server?
- **70.** Should IFL provide a PC/server, or should it be quoted?

---

## Quick tally

| | Count |
|---|---|
| Answered — IFL said so, in words | 8 |
| Answered — we measured it from IFL's own data/documents | 21 |
| Answered — not really an IFL fact, it's our own design choice | 3 |
| Partially answered | 5 *(counted above under Part 1, gap noted in Part 2)* |
| Fully open | 36 |
| **Total** | **70** |

The four sections with the least coverage — E (sack stock), F (reports), H (live-data expectations), and most of J (historical data volume) — are where Hassan's time is worth the most. Everything else is either settled or a quick confirmation rather than new information.
