# Sack Management System — Questions for Ibrahim Fibres Limited

**Prepared:** 21 July 2026
**From:** SMS development team
**Re:** Database provided for TP1 Line 3 / Unit 2

---

## How to use this document

We have examined the database you supplied and understand most of it. This document lists **only the things we could not determine from the data itself** and do not want to guess about.

- Questions are grouped by who is best placed to answer them.
- Each question explains **why we are asking** and **what we already observed**, so you can usually just tick an option.
- **🔴 BLOCKING** questions stop us from starting. **🟠 Important** questions shape what we build. **🟡 Useful** questions improve the result but won't hold us up.
- Where we have a strong suspicion, we say so — you may only need to confirm or correct it.

If any question doesn't make sense, please just tell us and we'll rephrase or come and look at the line.

---

## First, here is what we already worked out — please correct us if any of this is wrong

You do **not** need to answer these; we're stating them so you can spot any misunderstanding early.

| What we understand | Based on |
|---|---|
| The line winds yarn onto **cones**. Each cone is automatically weighed. | 142,511 cone weighings |
| Average cone weight is **1,951 grams**; target is set per product at 1,950–1,960 g. | Matches your `MaterialSetpointWeight` values exactly |
| Cones are collected into **sacks**. Average sack weight is **47.22 kg**. | 5,462 sack weighings |
| We believe a sack holds **24 cones** (2 layers of 12). | 24 × 1.951 kg + 0.5 kg sack = 47.34 kg, vs 47.22 kg actual |
| Cones are rejected for two reasons: **wrong weight** or **quality inspection failure**. | Two separate reject tables |
| Your reject rate is about **2.2 %** — quality rejects (2,900) outnumber weight rejects (246) by roughly 12 to 1. | 18 days of data |
| Two Siemens S7-1500 PLCs feed the system, at 10.1.1.11 and 10.1.1.14. | PLC configuration table |
| There are 14 source/lifter stations and up to 299 conveyor hangers. | Observed values |
| The data we have covers **22 June to 10 July 2026** (18 days). | Date range in data |

---

# Section A — Products and traceability

### 🔴 Q1. How do you know which product a particular sack or cone belongs to?

**This is our most important question.** Everything else depends on it.

We have two sets of information that appear to be completely separate:

1. **Weighing records** — every cone and sack, with time, weight, station number, pass/fail. **142,511 records.**
2. **Product records** — your materials, blends, yarn counts, tube colours, lot codes like `204-ILT-BR`. **18 records.**

**There is no link between them.** No cone or sack record contains a product code, lot number, material ID, or order number. So today we can tell you *"3,214 cones were made on 5 July"* but **we cannot tell you** *"3,214 cones of 204-ILT-BR were made on 5 July."*

Which of these is the situation?

- [ ] **(a)** The system knows via the "active material" setting — whatever product is marked active in the software at that moment is what's being produced.
  *If so, please note: right now **two** materials are marked active simultaneously (STR-RED and 204-ILT-BR/Khaki-2). Is that intentional — e.g. two products run at once on different stations? If so, how do we tell which station is making which?*
- [ ] **(b)** There is a "Cone ID" that identifies the product. *(We can see the PLC does send a Cone ID value, but the system currently throws it away without saving it. If this is the answer, we may be able to recover it — see Q2.)*
- [ ] **(c)** Operators record it **manually** — on paper, a whiteboard, or a separate spreadsheet.
  *If so: could we see an example of that record?*
- [ ] **(d)** It is **not currently tracked** at all.
- [ ] **(e)** Something else: ________________________________

**What this changes:** If the answer is (c), (d), or (e), then product-wise and lot-wise reporting is **not possible from the existing data**, and we would need to add a way for operators to record the current product. That is extra work and we'd need to agree it. If the answer is (a) or (b), we can likely do it automatically.

---

### 🟠 Q2. Can we start saving the "Cone ID" that the PLC already sends?

The PLC sends a value called `P1_ConeID` on every cone. The current software **receives it but does not store it**.

- [ ] Yes — please start saving it *(no PLC change needed; a small software change on our side)*
- [ ] No
- [ ] Don't know — please discuss with our automation team

**Follow-up if yes:** What does the Cone ID actually contain? Is it a product code, a sequential counter, a machine/spindle number, or something else? A few real examples would help enormously.

---

### 🟡 Q3. What do your product codes mean?

We'd like to display these sensibly rather than as raw text.

**Blend codes** — we see: `PVSD8020`, `SLUBPVSD8020`, `CPPVSD8020`, `PPSD100`, `PVT8020`, `PVSD9010`, `SLUBPVSD9010`, `CPPVSD9010`, `VIS100`

- Is `PVSD8020` = **P**olyester/**V**iscose, **S**emi-**D**ull, **80/20** blend? ☐ Yes ☐ No — correct meaning: ____________
- What do the prefixes **SLUB**, **CP**, and **PP** mean? ____________
- In `PVT8020`, what does the **T** stand for? ____________
- Is `VIS100` = 100 % viscose? ☐ Yes ☐ No

**Lot / order codes** — we see `201-IH0-SD` and `204-ILT-BR`.
- Is this a **customer order number**, an **internal lot number**, or a **product specification code**? ____________
- Should reports group by this? ☐ Yes ☐ No

**Note — possible typos in your master data.** We found what look like data-entry errors. Please confirm whether these are genuinely different products or the same thing entered twice:

| Value 1 | Value 2 | Our guess |
|---|---|---|
| `201-IH0-SD` (with a **zero**) | `201-IHO-SD` (with letter **O**) | Same product, typo |
| `Khakhi-2` | `Khaki-2` | Same, typo |
| `STAR_RED` | `STR-RED` | Possibly different tube types? |

If these are typos, reports will incorrectly split them into separate groups unless we clean them up.

---

# Section B — Weights and units

### 🔴 Q4. Sack weight — what exactly is being measured?

Sack weights average **47.22 kg** (range 45.3 – 49.3 kg).

**Unit:**
- [ ] Kilograms ☐ Pounds ☐ Other: ________

**Does this weight include the sack itself?**
- [ ] **Gross** — includes the empty sack (your system lists a sack as 500 g)
- [ ] **Net** — the sack weight has already been subtracted
- [ ] Don't know

*Our calculation suggests **gross**: 24 cones × 1.951 kg + 0.5 kg sack = 47.34 kg, which is very close to the 47.22 kg we observe.*

**How many cones go in a sack?**
- [ ] 24 (our assumption) ☐ Other: ______
- [ ] It varies — depending on: ________________________________

**Can a sack be closed partially full** (e.g. at the end of a lot or shift)? ☐ Yes ☐ No
*This matters: if yes, we must not flag short sacks as errors.*

---

### 🔴 Q5. Cone weight — what exactly is being measured?

Cone weights average **1,951 grams**.

**Unit:** ☐ Grams ☐ Kilograms ☐ Other: ________

**Does this include the cardboard/plastic tube?** Your master data lists a tube weight of **70 g**.
- [ ] **Gross** — includes the 70 g tube
- [ ] **Net yarn only** — tube already subtracted
- [ ] Don't know

**Why this matters a great deal:** if it's gross, then actual yarn per cone is 1,951 − 70 = **1,881 g**, and every yield, production-tonnage, and efficiency figure we report changes by **3.6 %**. We must not get this wrong.

---

### 🟡 Q6. What should we do with clearly faulty weight readings?

We found a small number of obviously wrong readings:

| What we found | How many |
|---|---|
| Sack weighing **0.00 kg** | 1 |
| Sack weighing **0.88 kg** | 1 |
| Sack weighing **37.66 kg** (vs 47 kg normal) | 1 |
| Cone weighing **824 g** (vs 1,951 g normal) | 1 |

All were correctly flagged as out-of-range by your system. But if we include them in averages and totals they will distort the figures.

- [ ] **Exclude** them from totals and averages, but show them in a separate "anomalies" list
- [ ] **Include** them — they represent real production
- [ ] Exclude anything below a threshold: sacks under ______ kg, cones under ______ g

---

# Section C — Shifts and timing

### 🔴 Q7. We have found a genuine bug in your current system's shift reporting. How would you like us to handle it?

**The problem:** Your system stamps each record with the shift, but it calculates the shift from **the time the record was saved to the database**, not the time the cone was actually produced. These differ by **3.8 hours on average**.

**In plain terms:** a cone produced at 1:00 PM (Morning shift) may be recorded in the database at 4:48 PM and therefore labelled **Evening shift**. Your existing shift-wise production reports are, to some degree, **wrong**.

Fortunately, the true production time *is* stored, so we can calculate this correctly.

- [ ] **Fix it** — use the real production time. Our reports will be accurate but **will not match your existing system's numbers**.
- [ ] **Match the existing system** — reproduce the current behaviour so figures agree with what people are used to, even though it's incorrect.
- [ ] **Show both** — display the corrected figure with the old figure alongside for comparison.

*(Our recommendation is to fix it, and to flag the discrepancy clearly during changeover so no one is caught out by numbers moving.)*

---

### 🔴 Q8. Please confirm your shift timings.

The current system uses:

| Shift | Hours |
|---|---|
| Morning | 06:00 – 14:00 |
| Evening | 14:00 – 22:00 |
| Night | 22:00 – 06:00 |

- [ ] Correct ☐ Different — please state: ____________________________

**Night shift date rule:** the night shift crosses midnight. If a sack is made at **02:00 on 8 July**, that shift started on 7 July. Which date should it be counted against?

- [ ] The date the shift **started** (7 July) — common in plant reporting
- [ ] The **calendar date** it happened (8 July)

**Do shift timings ever change** (weekends, Ramadan, public holidays, maintenance days)? ☐ No ☐ Yes — details: ____________

---

### 🟡 Q9. Does the sack weigher record its own timestamp?

For cones we have both the true production time and the database save time. **For sacks we only have the save time.** If sack records are also delayed, sack shift figures will have the same problem as Q7.

- [ ] The PLC does hold a sack timestamp — it could be added *(please involve your automation team)*
- [ ] No timestamp available
- [ ] Don't know

---

# Section D — Quality and rejects

### 🔴 Q10. What do the quality inspection codes mean?

Every quality reject is recorded with two numeric codes. **We have no key for these**, so we cannot tell you *why* cones are being rejected — only that they were.

Here is what we observe over 2,900 rejects:

| Tube code | Material code | Count | Share |
|---|---|---|---|
| 10 | 1 | 1,730 | 59.7 % |
| 2 | 1 | 764 | 26.3 % |
| 1 | 2 | 203 | 7.0 % |
| 1 | 1 | 84 | 2.9 % |
| 9 | 1 | 37 | 1.3 % |
| 2 | 2 | 31 | 1.1 % |
| 9 | 2 | 20 | 0.7 % |
| 5 | 1 | 11 | 0.4 % |
| 10 | 2 | 9 | 0.3 % |
| 1 | 11 | 6 | 0.2 % |
| 0 | 2 / 0 | 4 | 0.1 % |
| 9 | 0 | 1 | < 0.1 % |

**Please provide the code list**, e.g. `1 = OK`, `2 = wrong colour`, `10 = ...`. Your machine vendor's manual will likely have it.

**Also:** does code `1` mean "pass"? If so, why do 84 cones appear in the reject table with both codes set to 1?

**Why this matters:** "Why are we rejecting cones?" is one of the most valuable things this system could tell you — a ranked chart of reject reasons showing that, say, 60 % of rejects come from one cause. **Without this code list we cannot build it.**

---

### 🟡 Q11. Do the station numbers correspond to named physical positions?

Records show **Source** and **Lifter** numbers from 1 to 14. In almost every record these two numbers are identical.

- Do stations 1–14 have names or physical locations on the line? ☐ Yes — list attached ☐ No, numbers are fine
- Should we show **both** Source and Lifter, or are they always the same? ☐ Show both ☐ They're always the same — show one

**Why:** if we can label stations, we can show you which positions produce the most rejects. In the data, station usage already varies noticeably — station 5 handled 11,998 cones while station 11 handled 7,856. Knowing whether that's normal would be useful.

---

# Section E — Scope: what should the system actually do?

### 🔴 Q12. Do you need dispatch tracking? (Please read carefully — this significantly affects cost and timeline.)

The brief mentions dispatch. **We must be clear: there is no dispatch information anywhere in the database you provided.** Nothing records customers, vehicles, gate passes, delivery notes, destinations, or when sacks left the plant.

So dispatch cannot be a report over existing data — it would be a **new module** where staff enter information that isn't currently captured anywhere.

- [ ] **Not needed** — SMS is for production monitoring only
- [ ] **Needed** — please describe how dispatch works today: who records it, on what (paper/Excel/ERP?), and what information is captured: 

  ____________________________________________________________

  ____________________________________________________________

- [ ] Needed **later** — leave room for it but don't build it now

*If needed, please send us a sample of your current dispatch paperwork or spreadsheet.*

---

### 🟠 Q13. There is an unused pallet and label-printing module. What should we do with it?

Your database contains a complete, professionally built module for pallets, production records, and label printing — with barcode/label numbering already configured.

**It has never been used.** Zero production records. Zero printers configured.

- [ ] **Ignore it** — we're not using pallets, or we handle them another way
- [ ] **Bring it into use** — we do want pallet tracking and label printing *(this is a substantial addition to scope)*
- [ ] **Replace it** — we want pallet tracking, but built fresh as part of SMS
- [ ] It was abandoned because: ________________________________

*Context: this module would have recorded gross/net/tare weight and cone count per pallet — exactly the sort of data a sack management system wants. Worth understanding why it wasn't adopted.*

---

### 🟠 Q14. One line or several?

Everything we see is labelled `Sack-1` and `Package-1`. There are empty tables named `sack2` and `pack2`, suggesting a second line was anticipated.

- [ ] **One line only** — TP1 Line 3 / Unit 2, no expansion planned
- [ ] **More lines exist now** — how many, and are they on separate databases? ____________
- [ ] **More lines planned** — roughly when? ____________

**Why:** designing for multiple lines from the start is straightforward; retrofitting it later is expensive. We'd rather know now.

---

### 🟠 Q15. Will the system ever need to *change* data, or only display it?

Currently we plan for SMS to be strictly **read-only** — it displays your production data and never modifies it. This is the safest approach for a live plant system.

Will you need any of the following?

- [ ] Operators adding notes or comments to records
- [ ] Supervisors correcting or voiding a faulty weighing
- [ ] Recording the current product/lot *(see Q1 — likely needed if the answer there was (c) or (d))*
- [ ] Manually recording sacks the automatic system missed
- [ ] Dispatch entry *(see Q12)*
- [ ] None — **read-only is fine**
- [ ] Other: ________________________________

---

### 🟡 Q16. What reports and screens matter most to you?

We will propose a full list, but knowing your priorities shapes what we build first. Please rank or tick your top few:

- [ ] Live/today's production dashboard (sacks and cones so far, current rate)
- [ ] Shift-wise production summary
- [ ] Daily / weekly / monthly production totals
- [ ] Reject analysis — how many, and why
- [ ] Weight distribution and consistency (are we giving away yarn by overfilling?)
- [ ] Station-wise performance comparison
- [ ] Product-wise or lot-wise output *(depends on Q1)*
- [ ] Downtime or gaps in production
- [ ] Exportable reports (Excel / PDF)
- [ ] Automatic email of a daily summary
- [ ] Other: ________________________________

**Is there a report you produce manually today that this should replace?** If so, please send us a copy — matching a format people already trust is the fastest route to adoption.

---

# Section F — Users and access

### 🟠 Q17. Who will use the system, and what should each type of user be allowed to do?

The existing database has three accounts (`Admin`, `TP1Admin`, `TP1User`) with **no roles defined**.

Roughly how many people in each category?

| Role | How many | What they should be able to do |
|---|---|---|
| **Operator** — shop floor | ______ | View dashboards and today's production |
| **Supervisor** — shift in-charge | ______ | Above, plus historical reports and exports |
| **Manager** — production/quality | ______ | Above, plus all reports and analysis |
| **Administrator** — IT | ______ | Everything, plus user management |

- [ ] These roles look right ☐ Different structure needed: ____________________________

**Should the three existing accounts keep working?** ☐ Yes ☐ No, start fresh

---

### 🟠 Q18. How should people log in?

- [ ] **Windows / Active Directory** — staff use their existing company login *(more convenient, needs IT co-operation)*
- [ ] **Separate SMS accounts** — we create usernames and passwords just for this system *(simpler, one more password to remember)*
- [ ] **Shared shop-floor account** for operators, individual accounts for supervisors and above
- [ ] Don't mind — recommend something

**Please note, respectfully:** the existing system stores passwords **in plain text**, and each password is identical to its username (user `TP1Admin`, password `TP1Admin`). Anyone with database access can read them. We will **not** carry this forward — the new system will store passwords securely. We'd suggest changing these credentials on the existing system too, independently of this project.

---

# Section G — IT and infrastructure

*These questions are for your IT / automation team.*

### 🔴 Q19. Where is the live database, and how do we connect to it?

We received an 18-day snapshot copied from a plant PC. To build against real data we need the actual system.

| Item | Answer |
|---|---|
| Server name / IP | ____________________ |
| SQL Server instance name | ____________________ |
| SQL Server version | ____________________ |
| Is the schema identical to our snapshot? | ☐ Yes ☐ No ☐ Unsure |
| How much data in total (how far back)? | ____________________ |
| Is old data archived or deleted? If so, after how long? | ____________________ |
| Is the database backed up? How often? | ____________________ |

**We are requesting a dedicated read-only login** for SMS — not the `sa` account and not the existing application's account. This means SMS physically cannot modify your production data, whatever happens.

- [ ] Read-only login can be provided
- [ ] Needs approval from: ____________________
- [ ] Prefer we work against a copy/replica instead

---

### 🟠 Q20. Where should the application run?

Our assumption, matching your Energy Management System: a **local server or industrial PC on the plant network, with no internet or cloud dependency**.

- [ ] Correct — we have a server available. Specification: ____________________
- [ ] We need to provide hardware — please advise requirements
- [ ] Different arrangement: ____________________

**Who will access it, and from where?**
- [ ] Plant floor terminals ☐ Office PCs ☐ Mobile/tablet on plant Wi-Fi ☐ Remotely from outside the plant

*If remote access is needed, please tell us early — it has security implications we'd want to design for rather than bolt on.*

---

### 🟡 Q21. May we add database indexes to make reports fast?

The tables we need to query have **no indexes on their date columns**. This means a report like "show me last month" must scan every row. With 142,511 cone records that is already noticeable; as data grows it will become slow.

Adding two or three indexes would fix this. Indexes do not change your data — they are purely a speed optimisation — but they **do** modify the database, and per our own rules we will not touch your production database without written approval.

- [ ] Approved — SMS team may add read-optimisation indexes
- [ ] Our DBA will add them if you specify exactly what's needed
- [ ] Not approved — work around it

---

### 🟡 Q22. Are the PLCs or acquisition software likely to change?

SMS depends on data continuing to arrive in its current format.

- Any planned PLC upgrades, retagging, or software changes? ☐ No ☐ Yes: ____________
- Who maintains the current acquisition software? ____________________
- Do you have the vendor's documentation for it? ☐ Yes ☐ No

*The vendor's documentation would likely answer Q10 (reject codes) immediately.*

---

# Summary — the five answers we need first

If time is short, these five unblock us. The rest can follow.

| # | Question | Why it's blocking |
|---|---|---|
| **Q1** | How is a sack/cone linked to a product? | Decides whether product-wise reporting is possible at all |
| **Q4 / Q5** | Are weights gross or net, and in what units? | Every tonnage and yield figure depends on it |
| **Q7 / Q8** | Fix the shift bug or reproduce it? Confirm shift times. | Affects every shift report |
| **Q10** | What do the quality reject codes mean? | Blocks the highest-value dashboard |
| **Q19** | Live database connection details | We can't build against a static snapshot indefinitely |

---

**Please return this document with your answers, or arrange a call — a 30-minute conversation with someone who knows the line would likely cover most of it faster than writing.**

If it's possible to **visit the line and watch a sack being filled and weighed**, that would answer several of these questions on the spot and we'd welcome it.
