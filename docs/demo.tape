# docs/demo.tape — the loredown demo GIF.
#
#   brew install vhs
#   cd /path/to/loredown
#   vhs docs/demo.tape          # writes docs/demo.gif
#
# Records against a throwaway project in $TMPDIR built by docs/demo.setup.sh,
# never against this checkout.
#
# The story is deliberately ONE beat: a page an agent wrote, the code underneath
# it changing, and drift catching it. `init`, `install` and `lint` are the
# README's job — a demo that shows a tool being operated teaches syntax, and a
# demo that shows a problem being caught teaches value. Only the second one is
# worth the viewer's fifteen seconds.

Output docs/demo.gif

Set Shell bash
Set Theme "GitHub Dark"
Set FontSize 16
Set Padding 20

# Width is tuned, not chosen. drift's SRC_STALE line is 126 characters, so it
# always wraps; the terminal hard-wraps at the column, not at word boundaries.
# Measured on this font: columns = (Width - 76) / 9.93. Width 772 gives 70
# columns, which is the one break point that reads well — the filename ends
# line one, the sha and the instruction start line two. At 712 it splits
# "src/checkou|t.ts" and at 1000 it splits the sha, and a payoff frame that
# looks like a rendering bug is worse than no payoff frame.
Set Width 772
Set Height 620
Set TypingSpeed 35ms

# ─────────────────────────────────────────────── setup, off camera
Hide
Type "SETUP=$PWD/docs/demo.setup.sh" Enter
Type "cd $(mktemp -d) && bash $SETUP" Enter
Type "export PS1='$ '" Enter
Type "clear" Enter
Show

# ─────────────────────────────── beat 1: what the agent wrote down
Type "# your agent wrote it down:"
Sleep 800ms
Enter
Sleep 400ms
Type "cat lore/pages/decision/retry-count-is-7.md"
Enter
Sleep 4s

# Scene change and the edit itself, both off camera. Hide stops capturing
# frames but not the terminal buffer, so the edit has to be wiped by a second
# clear before Show — otherwise the typed line reappears in frame.
Hide
Type "clear" Enter
Type "echo 'export const MAX_RETRIES = 3;' > src/checkout.ts" Enter
Type "clear" Enter
Show

# ──────────────────────────── beat 2: the code moves on without it
Type "# weeks later, someone edits that file:"
Sleep 600ms
Enter
Sleep 300ms

Type "git commit -am 'checkout: simplify the retry policy'"
Enter
Sleep 1500ms

# ──────────────────────────────────────────── beat 3: drift catches it
Type "npx loredown drift"
Enter
Sleep 4s

Type "# caught before your agent believes it."
Sleep 500ms
Enter
Sleep 4s
