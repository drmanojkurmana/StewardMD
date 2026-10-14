REG = []
def fig(lesson, step, alt, cap):
    def deco(fn):
        REG.append((lesson, step, alt, cap, fn)); return fn
    return deco
