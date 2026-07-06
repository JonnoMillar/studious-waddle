#!/usr/bin/env python3
"""Typing tracker — analysis engine.

Reads the raw keystroke logs written by capture/keytrack.ahk and reconstructs:
  - word frequency (your real, personal vocabulary)
  - correction pairs: (what you typed first, what you settled on) for every
    word where you backspaced mid-word and then retyped it
  - "struggle words": words with an unusually high backspace-to-length ratio

This is deliberately NOT live/streaming — run it whenever you want ("python
analyze.py"), it reads everything in ../data/*.ndjson and writes model.json
next to it. Designed to be run periodically (weekly via Task Scheduler, or
just by hand), never as a background process.

Known simplification: this models a *linear* typing buffer (chars in,
backspace pops the last char out). Mouse-repositioned cursor clicks and
copy/paste aren't tracked by the capture layer, so an arrow-key navigation
event conservatively invalidates the in-progress word rather than guessing —
full correctness there would need OS accessibility-API integration, a much
bigger project. In practice the overwhelming majority of real typos are
linear (type, notice, backspace, retype), which is exactly what this catches.
"""

from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "data"
MODEL_PATH = Path(__file__).parent.parent / "data" / "model.json"

SESSION_GAP_MS = 30_000  # a 30s+ pause or window switch starts a new session
BOUNDARY_KINDS = {"space", "enter", "tab"}


@dataclass
class WordEvent:
    final_text: str
    attempted_text: str | None  # the longest attempt before the first backspace run, if any
    backspace_count: int


def load_events(data_dir: Path):
    events = []
    for path in sorted(data_dir.glob("log-*.ndjson")):
        with path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    events.append(json.loads(line))
                except json.JSONDecodeError:
                    continue  # a torn/partial line from a crash; skip it
    events.sort(key=lambda e: e["t"])
    return events


def split_sessions(events):
    """Group events into sessions: a new session starts on a window change
    or a gap of SESSION_GAP_MS or more."""
    sessions = []
    current = []
    last_t = None
    last_win = None
    for e in events:
        if current and (
            (last_t is not None and e["t"] - last_t > SESSION_GAP_MS)
            or e.get("win") != last_win
        ):
            sessions.append(current)
            current = []
        current.append(e)
        last_t = e["t"]
        last_win = e.get("win")
    if current:
        sessions.append(current)
    return sessions


def reconstruct_words(session) -> list[WordEvent]:
    """Replay one session's raw key events into finished words, capturing a
    correction pair whenever a backspace run was followed by different text."""
    words: list[WordEvent] = []
    buffer: list[str] = []
    pre_backspace_snapshot: str | None = None
    backspace_count = 0
    valid = True  # cleared by a nav event; the in-progress word becomes untrustworthy

    def finalize():
        nonlocal buffer, pre_backspace_snapshot, backspace_count, valid
        text = "".join(buffer)
        if text and valid:
            attempted = pre_backspace_snapshot if pre_backspace_snapshot not in (None, text) else None
            words.append(WordEvent(final_text=text, attempted_text=attempted, backspace_count=backspace_count))
        buffer = []
        pre_backspace_snapshot = None
        backspace_count = 0
        valid = True

    for e in session:
        kind = e.get("kind")
        if kind == "char":
            buffer.append(e["v"])
        elif kind == "backspace":
            if pre_backspace_snapshot is None:
                pre_backspace_snapshot = "".join(buffer)
            if buffer:
                buffer.pop()
            backspace_count += 1
        elif kind in BOUNDARY_KINDS:
            finalize()
        elif kind == "nav":
            # Cursor moved non-linearly — we can no longer trust this buffer.
            valid = False
        elif kind == "delete":
            valid = False  # forward-delete isn't modeled by the linear buffer
    finalize()
    return words


def analyze(data_dir: Path = DATA_DIR):
    events = load_events(data_dir)
    if not events:
        return {"word_frequency": {}, "corrections": [], "struggle_words": [], "sessions_seen": 0, "events_seen": 0}

    sessions = split_sessions(events)

    word_freq: Counter[str] = Counter()
    correction_counts: Counter[tuple[str, str]] = Counter()
    backspaces_per_word: defaultdict[str, list[int]] = defaultdict(list)

    for session in sessions:
        for w in reconstruct_words(session):
            word_freq[w.final_text] += 1
            backspaces_per_word[w.final_text].append(w.backspace_count)
            if w.attempted_text:
                correction_counts[(w.attempted_text, w.final_text)] += 1

    struggle = []
    for word, counts in backspaces_per_word.items():
        if len(word) < 2:
            continue
        avg_backspaces = sum(counts) / len(counts)
        ratio = avg_backspaces / len(word)
        if ratio > 0.3 and len(counts) >= 2:  # seen more than once, genuinely backspace-heavy
            struggle.append({"word": word, "avg_backspaces": round(avg_backspaces, 2), "seen": len(counts)})
    struggle.sort(key=lambda s: -s["avg_backspaces"])

    corrections = [
        {"typo": typo, "fix": fix, "count": count}
        for (typo, fix), count in correction_counts.most_common()
    ]

    return {
        "word_frequency": dict(word_freq.most_common()),
        "corrections": corrections,
        "struggle_words": struggle[:50],
        "sessions_seen": len(sessions),
        "events_seen": len(events),
    }


def main():
    result = analyze()
    MODEL_PATH.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(f"Analyzed {result['events_seen']} events across {result['sessions_seen']} sessions.")
    print(f"Learned {len(result['word_frequency'])} distinct words, "
          f"{len(result['corrections'])} correction patterns, "
          f"{len(result['struggle_words'])} struggle words.")
    print(f"Model written to {MODEL_PATH}")


if __name__ == "__main__":
    sys.exit(main())
