# Sample Chapter {#sample}

This chapter exists only to exercise the build pipeline. It is excluded from
the real guide via `order.txt` (or deleted) before the final build.

This paragraph references another section: see {{ref:sample-second}} for more.
It also uses a [[Username]] label, which must exist in LABELS.md for a
non-draft build to pass, and a [[TBD: decide later]] marker, which fails the
build unless `-Draft` is passed.

## First steps {#sample-steps}

1. Open a command prompt.
1. Run the command below.
1. Confirm the expected output.

```cmd
node cli/dist/index.js user:create --username=demo --password=abcdefghij --role=viewer
```

> **Note:** This is a note callout. It explains something helpful but not
> critical to the step above.

> **Warning:** This is a warning callout. Skipping this step can cause data
> loss.

- [ ] First checklist item
- [ ] Second checklist item
- A plain bullet, not a checkbox

## Second section {#sample-second}

| Column A | Column B | Column C |
|---|---|---|
| 1 | 2 | 3 |
| 4 | 5 | 6 |

![Placeholder figure](../images/PLACEHOLDER.png)

Here is a second figure to confirm the counter increments.

![Second placeholder figure](../images/PLACEHOLDER.png)

<!-- pagebreak -->

### A sub-subsection

This paragraph exists after a manual page break to confirm pagination works
and to give the TOC a third heading level to number.

```powershell
Get-ChildItem C:\sms\logs
```
