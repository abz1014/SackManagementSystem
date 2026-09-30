# IFL SMS illustrated User & IT Guide

## What is here

- `src/` - chapter markdown (`order.txt` sets the order, `meta.json` the cover).
- `images/` - 53 screenshots and diagrams (PNG), taken from the demo.
- `capture/` - `shots.json` (shot list) and `capture.mjs` (Playwright capture tool; read-only, refuses write actions).
- `facts/` - labels, commands, paths, limitations the text is checked against.
- `build/`, `build.ps1` - the pipeline (markdown -> .docx -> Word COM -> PDF, plus checks).
- `demo/` - the demo environment (three demo databases, launcher, owner SQL).
- `out/` - the built `.docx` and `.pdf`. `REVIEW.md` - independent review and defect status.
- `README-BUILD.md` - detail on the build pipeline.

## Rebuild

```powershell
powershell -ExecutionPolicy Bypass -File docs/guide/build.ps1
```
Needs Word (driven invisibly) and Python with python-docx. Stops on any FAIL; on success copies the files to `Desktop\SMS-Guide`. Use `-Draft` for a draft without all screenshots.

Re-shoot screenshots (demo must be running): `node docs/guide/capture/capture.mjs --only=S02,S05`.

## Run and stop the demo

The demo app listens on http://127.0.0.1:4100. `demo/demo.ps1` starts one component per call with the demo's own environment (never `sms/.env`):

```powershell
powershell -File docs/guide/demo/demo.ps1 api      # web/API on 4100
powershell -File docs/guide/demo/demo.ps1 worker   # sync worker
powershell -File docs/guide/demo/demo.ps1 sim      # plant simulator (writes only DATA_DEMO_SIM)
```
Also `migrate` and `cli <args>`. Run each in its own window. To stop, close that window or end its `node` process (Task Manager); logs are in `demo/logs/` (not committed). Credentials live in the gitignored `demo/*.env` files (see `demo/OWNER-STEP.md`).

## Teardown (the owner runs this if wanted)

```sql
USE master;
ALTER DATABASE [SMS_DEMO] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;      DROP DATABASE [SMS_DEMO];
ALTER DATABASE [DATA_DEMO_SIM] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [DATA_DEMO_SIM];
ALTER DATABASE [PDAS_DEMO] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;     DROP DATABASE [PDAS_DEMO];
DROP LOGIN [sms_demo_app];
DROP LOGIN [sms_demo_reader];
DROP LOGIN [sms_demo_sim];
```
Drop the databases first (the logins' users go with them). Also delete `C:\sms-demo-backups` if present and the demo app login `demo-admin` disappears with SMS_DEMO.

## Known gaps

- Screenshots are of the demo with simulator data, not real plant data; the demo has no backup, so Health reads "Something needs attention".
- S02, S05, S07, S08, S12, S21 show only the top of the screen; lower blocks are described in the text but not pictured. S30 (Setup Rules) is still tall.
- The Data batches table overprint seen at narrow widths (old S21) is a possible app layout defect; not re-tested.
- Nothing was verified against IFL's plant or a real installation; PDAS writes were not exercised.
- The on-screen wording "A manager can name a code here" disagrees with the server rule (engineer): a copy question for the maintainer.
