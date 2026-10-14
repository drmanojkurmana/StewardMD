REG = []
NEW = []
def fig(lesson, step, alt, cap):
    def deco(fn):
        REG.append((lesson, step, alt, cap, fn)); return fn
    return deco

def reuse(lesson, step, name, alt, cap):
    """Point a step at a figure drawn for another lesson (name = svg file stem)."""
    REG.append((lesson, step, alt, cap, name))

def newstep(lesson, after, tx, say):
    """Insert a short text step after step index `after` (for a lesson with no free step); idempotent by tx."""
    NEW.append((lesson, after, tx, say))
