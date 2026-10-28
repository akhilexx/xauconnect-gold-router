# Track fit (ids from nearhackathon.com/HACKATHON.md)

Submitted tracks: `defi`, `realworld`, `agents`.

| Track | Why it fits | Hint used |
| --- | --- | --- |
| `defi` Unstoppable DeFi | Cross-chain trading into XAUT and into Gold Curve quote tokens, settled through NEAR Intents, non-custodial, inside a live DEX aggregator | NEAR INTENTS |
| `realworld` Real-World Money | Stablecoins -> tokenized gold (XAUT) savings and treasury rail across 7+ chains | STABLECOINS, NEAR INTENTS |
| `agents` Agent Economy | HTTP API + policy engine so an agent can move value across chains via NEAR Intents within hard limits; XAUConnect already exposes an agent API | NEAR INTENTS |

Considered and not chosen:
- `security`: the policy engine is a feature here, not the product. Add it only if backlog item 5 (per-agent keys, budgets, audit log) ships fully. A weak entry could dilute the submission, and selecting extra tracks gives no advantage beyond fit.
- `memecoins`: Gold Curve is a memecoin launchpad, but the launchpad is pre-existing (baseline) and the NEW work is funding routes, not token mechanics. It does not fit honestly.
