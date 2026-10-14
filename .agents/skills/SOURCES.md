# Vendored agent skills

Copied on 2026-10-09. The only local normalization removes a trailing blank line from `write-swift/SKILL.md`. Each skill is a directory under `.agents/skills/`; update by copying a reviewed upstream revision and changing this file in the same commit.

| Source | Revision | Skill directories | License |
| --- | --- | --- | --- |
| [expo/skills](https://github.com/expo/skills) `plugins/expo/skills` | `d4f484024fec15196bfd3c272e953e3f983972cf` | 24 | [MIT](../../third_party/licenses/expo-skills-MIT.txt) |
| [emilkowalski/skills](https://github.com/emilkowalski/skills) `skills` | `e8a175de22ae1e49370fc144c1f3bb9aeedf988d` | 14 | [MIT](../../third_party/licenses/emilkowalski-skills-MIT.txt) |

These are agent instructions, not app dependencies. No skill script runs during app build or at runtime.
