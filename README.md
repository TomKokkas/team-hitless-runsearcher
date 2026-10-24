# Team Hitless RunSearcher

Team Hitless RunSearcher is a static web app for searching and exploring Team Hitless challenge runs. It is an unofficial community project under development and is not affiliated with or endorsed by Team Hitless.

## Data status

This GitHub Pages-ready static edition serves its Verifier Queue preview from `data/verifier-queue-public.json`, using the same relative URL locally and on GitHub Pages. Accepted Runs continues to use the older CSV preview at `data/runs.csv`. Neither dataset updates automatically.

The full local workbook import (`data/verifier-queue-workbook.json`) and its diagnostics (`data/verifier-queue-workbook-report.json`) remain ignored by Git. The original `.xlsx` workbook is also ignored. Only the approved UI fields are projected into the public JSON: `runner`, `game`, `runType`, `originalRunText`, `category`, `restrictions`, `categorySplitReliable`, `videoUrl`, `status`, and `verifier`. The importer metadata, source row references, raw verdict and dates, and diagnostics are omitted. The verifier queue is read-only; a workbook verdict does not publish a run on Team Hitless.

Run `node .\verifier-workbook-import.mjs` to create the local import and report from `C:\Users\User\Downloads\TH Verifier workbook.xlsx`; add `--overwrite` when intentionally regenerating existing output files. After reviewing the import, run `node .\publish-verifier-queue.mjs` to create or refresh the public projection from the local JSON; it refuses to overwrite an existing public file unless `--overwrite` is supplied. It validates the exact 16,234-record count and status totals before writing. Run `node --test .\tests\verifier-queue.test.mjs .\tests\publish-verifier-queue.test.mjs .\tests\verifier-workbook-import.test.mjs` to validate the queue projection and workbook import.

## Credits

This independent web edition is based on the RunSearcher project created by Shilkey: [borgCode/RunSearcher](https://github.com/borgCode/RunSearcher). The original project credits the icon to [Faladryn](https://www.twitch.tv/faladryn); that creator attribution is retained here.

The web app uses browser-native HTML, CSS, and JavaScript and has no third-party runtime library dependencies. No separate license file was present in the source project; no new license is asserted by this copy.
