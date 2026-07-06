# Typing tracker

Captures your real keystroke corrections — every backspace, every retype —
across everything you type, so the personalized autocorrect project can learn
from actual typing behavior instead of clean, already-correct finished text.

Two independent pieces, on purpose:

- **`capture/keytrack.ahk`** — an AutoHotkey script that runs constantly in
  the background. It only logs raw events (which key, resolved shift-state
  character, timestamp, foreground window title) to `data/log-YYYY-MM-DD.ndjson`.
  It does no analysis and never blocks/alters a keystroke — every binding is
  `~`-prefixed (observe-only).
- **`analysis/analyze.py`** — run this whenever you want (not a background
  process). It replays the raw log into finished words, detects every
  backspace-then-retype as a correction pair, and writes `data/model.json`:
  word frequency, `{typo, fix, count}` pairs, and "struggle words" (words with
  an unusually high backspace-to-length ratio).

## Setup

1. Install [AutoHotkey v2](https://www.autohotkey.com/) (free, ~5MB).
2. Double-click `capture/keytrack.ahk` to start it — you'll get a brief tray
   notification confirming it's running. `Ctrl+Alt+P` pauses/resumes it.
3. To run it automatically at login: right-click `keytrack.ahk` → **Create
   shortcut**, then move that shortcut into
   `shellrun:startup` (Win+R, paste that, press enter — opens your Startup folder).
4. Whenever you want fresh insights: `python analysis/analyze.py`. It's safe
   to run anytime, including while the capture script is active.

## Privacy — read this

This is, functionally, a keylogger. Some things that make it safe to run:

- **Everything stays local.** Nothing in this folder makes a network request.
  `data/` is gitignored — it will never end up in a commit or a push.
- **Pause before anything sensitive.** `Ctrl+Alt+P` toggles logging off; do
  this before typing a password anywhere it isn't already excluded.
- **App exclusion list.** `ExcludedTitles` in `keytrack.ahk` blanket-skips
  logging while a matching window is focused (password managers are
  pre-listed — add your own).
- **Treat `data/*.ndjson` like a password file.** It's a record of your real
  typing. Don't move it anywhere synced/shared without thinking about that.

## Known limitation

The analyzer models a *linear* typing buffer: characters in, backspace pops
the last one out. A mouse click that repositions the cursor, or a paste, isn't
tracked by the capture layer — an arrow-key press mid-word conservatively
invalidates that word rather than guessing wrong. Getting that fully correct
for arbitrary text fields would need OS accessibility-API integration, which
is a much larger project. In practice, the overwhelming majority of real
typos are exactly the linear "type it, notice it's wrong, backspace, retype"
pattern this catches.

## Testing

`analyze.py`'s reconstruction logic is verified against a synthetic fixture
(no need for a live Windows machine to check the *logic*): `tests/gen_fixture.py`
generates a keystroke log with known typos/corrections in the exact schema
`keytrack.ahk` produces, and `tests/fixture_data/` holds the result. Run
`analyze()` against `tests/fixture_data` and the corrections/frequencies it
finds are asserted against the known-correct answer.

The capture script itself (`keytrack.ahk`) still needs a real run on Windows
to confirm the AutoHotkey side behaves as written — that part couldn't be
executed from this sandbox.
