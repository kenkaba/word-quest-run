# CLAUDE CODE — WORD QUEST RUN VISUAL MASTER V1

You are implementing WORD QUEST RUN on branch `visual-master-v1`.

Before touching code, read `docs/VISUAL_MASTER_V1.md` completely. Treat it as the visual source of truth.

## Mission
Rebuild the normal gameplay presentation first. The approved direction is a premium anime-fantasy mobile runner where Lumi runs AWAY from camera through a huge luminous fantasy world while the player answers English by choosing one of three in-world paths.

Do not redesign the product from scratch. Preserve the approved vocabulary engine, anti-duplicate/confusable logic, learning stats, and time-pressure system.

## First implementation target
Only work on P0 until it is visually coherent:
1. gameplay camera/composition
2. prompt + magical time gauge + three in-world answer paths
3. Lumi silhouette and run motion
4. first world visual quality

The vertical eye corridor is:
`WORD -> TIME -> THREE PATHS -> LUMI`

## Active Lumi asset
`assets/lumi.svg` has already been upgraded to the active premium direction. It preserves the existing rig symbol IDs but now uses silver/lilac hair, deep navy costume masses, antique-gold trim and violet crystal magic. Do not revert it to the old blonde/purple prototype. Judge it in actual rendered motion and improve only if the screenshots/video still look weak.

## Non-negotiables
- Lumi runs away from camera, never toward it.
- Lumi should read as a 16–18-year-old anime-fantasy heroine, not chibi/childlike.
- silver/lavender hair, deep navy witch silhouette, warm gold trim, crystal staff.
- black cat companion is part of the IP and may appear without stealing answer readability.
- no emoji/placeholder-looking final art.
- no flat geometric backgrounds presented as finished art.
- no detached quiz-button layout during normal play.
- no large opaque UI panels covering the world.
- actual run motion must show foot plant, body compression, hair/cloth follow-through, camera/ground response.
- correct/wrong must become physical world events, not only text/color feedback.

## Workflow
1. Inspect current implementation and list what can be preserved.
2. Make a recovery point before large visual changes.
3. Implement P0 in small reversible commits.
4. Test gameplay logic after each structural change.
5. Capture real screenshots at 375, 390 and 430 px widths.
6. Evaluate screenshots against `docs/VISUAL_MASTER_V1.md`.
7. Iterate if the screen still looks dated, childish, flat, generic, or visually weak.

Do NOT claim visual completion because unit/self tests pass.

## Visual Judge gate
Score the actual rendered result, 0–10 each:
- first impression
- character appeal
- world spectacle
- depth/lighting/material quality
- running motion
- gameplay readability
- success payoff
- failure entertainment
- desire to continue
- store/social screenshot appeal

90/100 is required before recommending production promotion.
The owner's visual judgement overrides internal scoring.

## Safety
- Work only on `visual-master-v1`.
- Do not update Netlify production branch/site.
- No force push.
- Preserve a working rollback point.
- Never silently discard the approved 2,894-word vocabulary and timing systems.

## Report format
When a coherent P0 candidate is ready, report only:
- what changed visually
- screenshots/preview URL
- remaining temporary assets
- Visual Judge score
- exact gaps preventing 90/100, if any

Proceed autonomously. Do not stop for minor confirmation. Stop only for external paid assets/services, destructive operations, secrets/account authentication, or a decision that cannot be reversed safely.
