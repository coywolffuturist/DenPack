# DenPack 🐺

Local AI pack system running on the Coywolf Den (Mac Mini M4 Pro, 64GB RAM).

A flat worker pool with emergent specialization, scored by a lightweight coordinator/evaluator. Handles 70-80% of daily task volume locally — zero Anthropic cost for routine work.

---

## Pack Roster

| Name | Role | Model |
|------|------|-------|
| **Arbor** | Coordinator/Evaluator | Gemma 4 E4B (MLX 4-bit) |
| **Lumen** | Prowl executor | Gemma 4 26B MoE (MLX 4-bit) |
| **Vex** | Prowl strategist/backtester | Gemma 4 26B MoE (MLX 4-bit) |
| **Mira** | Research | Gemma 4 26B MoE (MLX 4-bit) |
| **Coda** | Report synthesis | Gemma 4 26B MoE (MLX 4-bit) |
| **Sable** | Lucid builder | Qwen2.5-Coder-7B (MLX 4-bit) |

---

## Architecture

```
WhatsApp → VPS (Clawdbot gateway)
  → Router: classify task
    → Local pack (70-80%):
        → Arbor (E4B) → selects worker → executes → scores → synthesizes
        → Response back through Clawdbot gateway → WhatsApp
    → Coywolf/Anthropic (20-30%):
        → Normal flow, unchanged
```

### How specialization emerges

No pre-assigned roles. Arbor dispatches tasks based on each agent's running performance scores by domain. Agents that repeatedly score well on Prowl tasks get Prowl tasks. Roles emerge from what agents actually succeed at.

**Scoring dimensions (Arbor):**
- **Correctness** (60%) — did the output match the objective?
- **Efficiency** (20%) — token count + tool calls used
- **Handoff quality** (20%) — clean context transfer in multi-agent tasks

Auto-escalate to Coywolf (Anthropic) if composite score < 6.0.

---

## Structure

```
DenPack/
  router/          — VPS router: classify + dispatch tasks
  coordinator/     — Arbor: dispatch, evaluate, synthesize
  workers/
    lumen/         — Prowl execution
    vex/           — Prowl strategy + backtesting
    mira/          — Research
    coda/          — Report synthesis
    sable/         — Lucid feature building
  db/              — Neon Postgres schema + migrations
  scripts/         — Setup, start, status utilities
  docs/            — Specs and architecture docs
```

---

## Docs

- [System Design Spec](specs/system-design.md)

---

## Status

🟡 In build — models downloading, spec approved, build starting.
