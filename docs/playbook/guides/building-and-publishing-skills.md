# Guide: Building & Publishing Skills

> **What you'll learn:** How to create a skill from scratch, test it with your oracle, and publish it for everyone to use.

**Prerequisite:** Read [04 — Working with Skills](../04-working-with-skills.md) first for the basics of how skills work.

---

## What's in a Skill

A skill is a folder with at least one file — `SKILL.md`. That file is the instruction manual your oracle reads before doing the task.

```
my-skill/
├── SKILL.md              # Required — instructions for the oracle
├── scripts/              # Optional — helper scripts
│   └── generate.py
├── templates/            # Optional — template files
│   └── base_template.html
└── examples/             # Optional — sample inputs/outputs
    └── sample_input.json
```

The `SKILL.md` is the brain. Everything else is supporting material your oracle can reference while executing.

---

## Writing Your SKILL.md

This is the most important part. A well-written `SKILL.md` means your oracle produces great results every time. A vague one means inconsistent output.

### Template

```markdown
# Skill Name

## Description

One clear sentence: what this skill produces.

## When to Use

- "create an invoice" / "generate a billing document"
- "make an invoice for [client name]"
- Any request that involves [your use case]

## Requirements

- python3 (pre-installed)
- pip packages: `reportlab`, `jinja2`

## Instructions

### Step 1: Gather inputs

Ask the user for:
- Client name
- Line items (description, quantity, price)
- Due date

If any are missing, ask before proceeding.

### Step 2: Create the input file

Write a JSON file to `/workspace/input.json`:

```json
{
  "client": "Acme Corp",
  "items": [{"description": "Consulting", "qty": 10, "price": 150}],
  "due_date": "2026-03-15"
}
```

### Step 3: Run the script

```bash
pip3 install --break-system-packages reportlab jinja2
python3 /workspace/skills/invoice-creator/scripts/generate.py /workspace/input.json
```

### Step 4: Deliver

Copy the output to `/workspace/output/` and use `artifact_get_presigned_url` to share it.

## Common Pitfalls

- Always use absolute paths (start with `/workspace/`)
- Never write files inside the skills folder — it's read-only
- Always output final files to `/workspace/output/`
- Install pip packages with `--break-system-packages` flag

## Example

**User says:** "Create an invoice for Acme Corp, 10 hours of consulting at $150/hr, due March 15"

**Oracle produces:** `invoice_acme_corp.pdf` in `/workspace/output/`
```

### Tips for a Great SKILL.md

- **Be specific about trigger phrases.** List 3–5 ways a user might ask for this skill. The oracle matches on these.
- **List every dependency.** Don't assume anything is pre-installed beyond Python and Node.
- **Give exact commands.** Don't say "run the script" — show the full command with arguments.
- **Include an example.** Show what a real input looks like and what the output should be. This is how the oracle knows "good" from "bad."
- **Mention edge cases.** If something commonly goes wrong (wrong path, missing field), call it out in Common Pitfalls.

---

## Adding Supporting Files

Use supporting files when:

- **Scripts** — the task requires running code (Python, Node, bash)
- **Templates** — the output follows a consistent format (HTML, LaTeX, JSON)
- **Examples** — you want to show the oracle what good output looks like

Reference them in your `SKILL.md` with paths relative to the skill root:

```markdown
Run the generator script:
`python3 /workspace/skills/my-skill/scripts/generate.py`

Use the template at:
`/workspace/skills/my-skill/templates/base.html`
```

---

## Testing Your Skill Locally

Before publishing, test your skill by asking your oracle to use it:

1. **Put your skill folder** somewhere accessible (e.g., in the ai-skills repo locally)
2. **Ask your oracle** to use it:
   ```
   You: "Load the invoice-creator skill and create an invoice for Test Corp, 5 hours at $100/hr"
   ```
3. **Check the output:**
   - Did the oracle find and follow your `SKILL.md`?
   - Is the output file correct?
   - Did it handle edge cases (missing info, wrong format)?
4. **Iterate** — update your `SKILL.md` based on what worked and what didn't

The best skills go through several rounds of testing and refinement.

---

## Publishing to the Registry

Skills are published to [github.com/ixoworld/ai-skills](https://github.com/ixoworld/ai-skills) via pull request:

1. **Fork** the `ixoworld/ai-skills` repository
2. **Add your skill folder** at the root level:
   ```
   ai-skills/
   ├── pptx/
   ├── invoice-creator/    ← your new skill
   │   ├── SKILL.md
   │   └── scripts/
   │       └── generate.py
   └── ...
   ```
3. **Open a pull request** with a description of what your skill does
4. **Once merged**, your skill appears in the registry and all oracles can discover and use it

---

## Tips for Good Skills

**Do:**
- Use clear, descriptive folder names (e.g., `invoice-creator`, not `inv1`)
- Write trigger phrases that match how real users talk
- Always output to `/workspace/output/`
- Use absolute paths everywhere
- Include install commands for all dependencies
- Test with your own oracle before publishing

**Don't:**
- Assume the oracle knows anything not in the `SKILL.md`
- Write inside the skills folder (it's read-only)
- Use relative paths (they break in the sandbox)
- Skip the example section (it's how the oracle learns quality)
- Make the instructions too vague ("process the data" — how?)

---

## Next Steps

- **[04 — Working with Skills](../04-working-with-skills.md)** — how skills work from the user's perspective
- **[Skills & Sandbox API Reference](../reference/skills-and-sandbox-api.md)** — registry endpoints and sandbox tools
- **[05 — Sub-Agents](../05-sub-agents.md)** — when you need more than a skill
