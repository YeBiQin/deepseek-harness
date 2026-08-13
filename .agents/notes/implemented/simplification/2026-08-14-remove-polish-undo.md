# Agent Note: Remove the composer polish undo seat

Status: implemented

English | [中文](2026-08-14-remove-polish-undo.zh.md)

## Problem

The one-shot undo seat that replaced the polish button after a successful rewrite duplicated the composer's own history stack and got in the way of repeated polishing. The input machine already owns a bounded, self-managed undo/redo log (platform chords route to the machine, never the browser stack), so reverting a rewrite never needed a second path. Worse, the undo seat hijacked the polish button until the draft moved off the rewritten text, so a user who wanted to polish again had to edit the draft first or wait for the seat to collapse — the exact flow repeated polishing needs was the one it blocked.

## Decision

**The polish seat never turns into an undo state.** A successful rewrite leaves the polish button in place (the busy lock still holds for one full fade cycle); successive polishes chain directly on the rewritten draft. Reverting a rewrite is the input machine's native undo history alone — the same bounded self-managed undo/redo log that covers typing, paste, and chip transactions, with its commit semantics (a sent draft cannot be resurrected). The `{ original, polished }` state, its revoke effects, the `input.polishUndo` strings, and the three undo tests are removed; one test now locks in that the seat stays the polish button after a rewrite and that a second polish ships the rewritten draft.

## Alternatives considered

**Keep the one-shot undo as shipped.** Rejected: it duplicated the machine's native undo history and blocked consecutive polishes — precisely the failure that prompted the removal.

**Keep the undo seat but clear it automatically when a new polish starts.** Rejected: chaining would work, but the seat would still hide the polish button behind a transient state and duplicate a history the machine already provides.

**Implement a multi-step polish history.** Rejected: the machine's bounded undo log already reverts any rewrite; a separate history would add state and surface for no capability the native stack lacks.

## Consequences

Reverting a rewrite now goes through the same undo chord as every other draft edit, with the machine's existing bounded history and commit semantics. Repeated polishes chain without an intervening edit, and the composer drops one state, two effects, and the undo strings. A dedicated undo seat would return only if the native history proves unable to express a rewrite revert. The [composer draft polishing note](../feature/2026-08-14-composer-draft-polishing.md) remains the owner of the polish capability and records the removal in its decision facts.
