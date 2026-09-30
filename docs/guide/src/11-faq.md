# FAQ {#faq}

**Why is the data about 18 minutes old?**
IFL's own acquisition layer writes a cone's row roughly 18 minutes after the
cone is actually weighed — this is measured from IFL's own data, not an SMS
delay. SMS states this lag on screen rather than hiding it, and judges
whether the line is running against `now − that lag`. See {{ref:lag}}.

**Why is there no sack stock per machine?**
IFL's sack table carries no machine or station column on each sack row —
only the sack number, its weight, whether the scale judged it in range, and
when the reading was written. Sack stock per machine cannot be computed from
data that does not exist, by SMS or by anyone else, without either a PLC
integration IFL has deferred or a manual entry screen. See Appendix C, item
2, and the [[Sacks]] screen's own on-screen note.

**Can SMS change the product on a machine?**
No. The PDAS write path (see {{ref:pdas-writes}}) can make a product
selectable in IFL's product-master database, but it never writes to a
machine or a PLC — whether the machine's own controller reads its limits
from PDAS live is a separate question for IFL. See Appendix C, item 4.

**Is there AI in SMS?**
No, and SMS does not claim otherwise. What exists is real statistics: a
station-drift calibration signal (one control rule, deliberately not eight —
see Appendix C, item 11) and a projection of when a drifting station reaches
its action limit, worked out from its own recent readings with a stated
confidence range. It is a measured trend, not a machine-learning model, and
it says so wherever it is shown.

**Why does a report only cover part of the period I picked?**
IFL's source tables have been rebuilt once already (see {{ref:generations}}),
and a report never silently mixes two generations together as if they were
one continuous record. If a period spans a rebuild, the report states which
generation it covers and how many readings from another generation were
left out.

**Why doesn't a station's reject or weight figure match another screen exactly?**
Every canonical-table query states which source generation it resolved and
what it excluded; figures that look close but not identical usually differ
because they cover slightly different scopes (a single generation versus a
whole window that spans a rebuild) — check each screen's own stated period
and generation before assuming a mismatch is a bug.

**Why is Health "degraded" when the plant looks fine?**
Usually a real but harmless data finding, such as two recorded weights of
exactly 0, or a backup that has not verified, or low disk space. Health
names the reason. An engineer can acknowledge a known data finding with a
written reason; findings about the software itself cannot be acknowledged.

**What does the Back button in the top bar do?**
Dragging across a chart zooms the page to that range, and the
[[Back to previous range]] button undoes the zoom.

**Why can my report figures differ from IFL's own vendor screen?**
SMS works out shifts from the time a cone was produced. The vendor's Shift
column comes from insert time. Reports carry a footnote saying so.

**Who can see what?**
Every screen listed in Chapter 7 is open to every signed-in account, at
every rank. [[Setup]] is the only screen restricted, to `admin`. See
{{ref:roles-table}}.

**Can I trust the "days to the action limit" projection?**
It is a straight-line projection through a station's recent daily averages,
with a stated 90% confidence range on the rate itself — not a forecast of
what the scale will actually do. When the range spans zero, SMS says the
drift is not established rather than printing a number that would overstate
its own confidence.
