# Question for IFL — sack stock per machine

**Status:** drafted 2 Sep 2026, not yet sent.
**Why it is urgent:** this is the largest unbuilt item on IFL's requirement list, it
has a long turnaround, and it cannot be started until they answer. Everything
else in the plan can proceed while it is in flight.

**Background for us, not for them.** Their requirement reads "Complete tracking
and maintenance of sack stock data for each machine." Two things block it:

1. `sack1_TP1U2` carries **no machine or station column**. Its columns are
   `id`, `Date`, `Shift`, `Area`, `SackNum`, `Weight`, `inRange`. Cones carry a
   `Source` station; sacks do not. So a sack cannot be attributed to a machine
   from the data IFL supplied, by us or by anyone.
2. **Stock needs a way out, and there is none.** We record every sack made. No
   database anywhere in what they gave us records a sack leaving. IFL already
   confirmed dispatch is out of scope (Q12). Without an "out", stock is just a
   running total that never decreases, which is almost certainly not what they
   mean.

Do not send the section above. Send the message below.

---

## Message to send

Subject: Sack Management System — two questions on sack stock

Dear [name],

Work on the Sack Management System is progressing and most of the requirement
list is now running against your data. One item needs your input before we can
build it, and I would rather ask than assume.

The requirement is "complete tracking and maintenance of sack stock data for
each machine". Two details are not answerable from the data currently reaching
us, so I would be grateful for your guidance.

**1. How is a sack linked to a machine?**

Every cone your line weighs records the winding station it came from. Sacks do
not: the sack record holds the sack number, its weight, whether the weight was
in range, and the time, but no machine or position. So today we can tell you
exactly how many sacks were made and what they weighed, but not which machine
each one belongs to.

Could you tell us which of these matches how the plant actually works?

- **(a) The machine is known at the PLC** and could be read directly, if PLC
  access were in scope. This is the cleanest answer and gives fully automatic
  tracking, but it would mean revisiting the PLC integration that was placed
  out of scope earlier.
- **(b) An operator knows and could record it** on a simple screen at the time
  of packing, or at the end of a shift. We would provide that screen. No PLC
  work needed.
- **(c) Stock is not tracked per machine in practice** and a line-level figure
  is what is actually used. We can build this today from existing data.

**2. What counts as stock going out?**

We currently see every sack as it is produced. Nothing in the data shows a sack
being moved, loaded or dispatched, so a stock figure built only from what we
have would rise forever and never fall.

How does a sack leave stock, and who would record it? For example, is there a
gate pass, a loading sheet, a weighbridge record, or would an operator or
storekeeper enter it into the system?

Once we know the answer to both, we can give you a firm design and timeline for
this module. Everything else in the requirement list continues in the meantime,
and there is nothing else waiting on this.

If it is easier to talk it through, I am happy to arrange a short call with
whoever runs the packing and store areas.

Best regards,

[name]
QTech Solutions

---

## What each answer means for us

| Their answer | What we build | Rough effort |
|---|---|---|
| 1(a) PLC | Re-opens PLC integration; sack source read directly | Large — a new phase, and it reverses their own Q22 |
| 1(b) Manual entry | A floor screen writing to our own database; no IFL DB change | Medium |
| 1(c) Line level | Aggregate from `sack_event` we already hold | Small |
| 2 — a document exists | Manual or scanned entry of removals, against the sack register | Medium |
| 2 — nothing exists | Stock is production-to-date only; say so plainly and do not call it stock | Small |

Whatever they answer, record it in `SCHEMA.md` as a resolved open question with
the date, per the project's working rules.
