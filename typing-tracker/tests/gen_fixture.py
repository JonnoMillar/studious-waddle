"""Generates a synthetic keystroke log matching keytrack.ahk's schema, so
analyze.py's reconstruction logic can be verified without a real Windows
machine running the AutoHotkey capture daemon."""

import json
from pathlib import Path

FIXTURE_DIR = Path(__file__).parent / "fixture_data"
WIN = "Claude - Chat"


def events_for_word(t0, chars, backspace_after=None, retype=""):
    """Type `chars`, optionally backspace `backspace_after` times, then type
    `retype`, without a trailing boundary (caller adds space/enter)."""
    evs = []
    t = t0
    for c in chars:
        evs.append({"t": t, "kind": "char", "v": c, "win": WIN})
        t += 80
    if backspace_after:
        for _ in range(backspace_after):
            evs.append({"t": t, "kind": "backspace", "v": "", "win": WIN})
            t += 80
        for c in retype:
            evs.append({"t": t, "kind": "char", "v": c, "win": WIN})
            t += 80
    return evs, t


def boundary(t, kind="space"):
    return {"t": t, "kind": kind, "v": " " if kind == "space" else "", "win": WIN}


def main():
    events = []
    t = 1_000_000

    # 1. "hello" typed cleanly, no mistake.
    evs, t = events_for_word(t, "hello")
    events += evs
    events.append(boundary(t)); t += 100

    # 2. "wrold" mistyped -> backspace 4 -> "world" (classic swap typo).
    evs, t = events_for_word(t, "wrold", backspace_after=4, retype="orld")
    events += evs
    events.append(boundary(t)); t += 100

    # 3. "world" typed cleanly again (frequency should accumulate to 2).
    evs, t = events_for_word(t, "world")
    events += evs
    events.append(boundary(t)); t += 100

    # 4. Same "wrold" -> "world" correction repeated (count should reach 2).
    evs, t = events_for_word(t, "wrold", backspace_after=4, retype="orld")
    events += evs
    events.append(boundary(t)); t += 100

    # 5. "rhytm" (missing h) -> backspace 3 -> "rhythm", twice, to test
    #    struggle-word detection (high backspace-to-length ratio, seen>=2).
    for _ in range(2):
        evs, t = events_for_word(t, "rhytm", backspace_after=3, retype="ythm")
        events += evs
        events.append(boundary(t)); t += 200

    # 6. A nav event mid-word should invalidate that word (not crash, not
    #    silently produce a bogus correction).
    evs, t = events_for_word(t, "abc")
    events += evs
    events.append({"t": t, "kind": "nav", "v": "left", "win": WIN}); t += 80
    evs2, t = events_for_word(t, "def")
    events += evs2
    events.append(boundary(t)); t += 100

    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    out = FIXTURE_DIR / "log-2026-01-01.ndjson"
    with out.open("w", encoding="utf-8") as f:
        for e in events:
            f.write(json.dumps(e) + "\n")
    print(f"Wrote {len(events)} events to {out}")


if __name__ == "__main__":
    main()
