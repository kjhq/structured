from __future__ import annotations

import re

from structured_backend.errors import AppError

_LINE = re.compile(r"^(\s*-\s*\[)([ xX])(\]\s*)(.*)$")


def toggle_note_item(notes: str | None, item_text: str, checked: bool) -> str:
    needle = item_text.strip().lower()
    if not needle:
        raise AppError("validation_error", "item_text is required")
    lines = (notes or "").splitlines()
    mark = "x" if checked else " "
    for i, line in enumerate(lines):
        m = _LINE.match(line)
        if not m:
            continue
        body = m.group(4).strip()
        if needle in body.lower():
            lines[i] = f"{m.group(1)}{mark}{m.group(3)}{m.group(4)}"
            return "\n".join(lines)
    if checked:
        prefix = (notes or "").rstrip()
        addition = f"- [x] {item_text.strip()}"
        if prefix:
            return prefix + "\n" + addition
        return addition
    raise AppError(
        "validation_error",
        f"No checklist item matching {item_text!r}",
        hint="Add the item as '- [ ] …' in notes first",
    )
