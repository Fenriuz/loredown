# Demo GIF script for VHS (https://github.com/charmbracelet/vhs)
#
#   brew install vhs
#   cd "$(mktemp -d)" && git init -q && vhs /path/to/loredown/docs/demo.tape
#
# Then commit the resulting docs/demo.gif and reference it from README.md as
# https://raw.githubusercontent.com/loredown/loredown/main/docs/demo.gif

Output docs/demo.gif

Set FontSize 16
Set Width 1100
Set Height 620
Set TypingSpeed 40ms
Set Padding 24

Type "npx loredown init"
Enter
Sleep 2.5s

Type "npx loredown install claude-code"
Enter
Sleep 2.5s

Type "npx loredown new gotcha stripe-sandbox-cap --agent claude-code --task 'PR #42'"
Enter
Sleep 2s

Type "npx loredown lint"
Enter
Sleep 2.5s

Type "npx loredown index && npx loredown lint"
Enter
Sleep 3s

Type "# knowledge that rides your PRs — reviewed like code"
Sleep 3s
