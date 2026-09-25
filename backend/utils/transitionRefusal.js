/**
 * Turn a state-machine refusal into an honest HTTP answer (Part 2.2).
 *
 * Before this, nine call sites caught the refusal and forced the write, so a
 * user asking for something the lifecycle forbids got a 200 and a corrupted
 * asset. Now they get a 409 that says which unit and which move — and, just as
 * importantly, a real error (a dropped connection, a constraint violation) is
 * no longer indistinguishable from "this is not allowed".
 *
 * Returns true when it handled the error, so a caller reads:
 *
 *   } catch (err) {
 *     await client.query('ROLLBACK').catch(() => {});
 *     if (respondIfRefused(err, res)) return;
 *     ...existing 500 path...
 *   }
 */
function isTransitionRefused(err) {
  return err?.code === 'TRANSITION_REFUSED' || err?.name === 'TransitionRefused';
}

function respondIfRefused(err, res) {
  // A delivery without the proof its mode needs (deliveryCompletionService) is
  // the user's to fix — say what is missing rather than a 500.
  if (err?.code === 'DELIVERY_PROOF_REJECTED') {
    res.status(400).json({
      success: false,
      code: 'DELIVERY_PROOF_REJECTED',
      message: err.message,
      detail: { mode: err.mode, missing: err.missing || [] },
    });
    return true;
  }
  if (!isTransitionRefused(err)) return false;

  // Error level, not warn: a refusal reaching a user means a screen offered an
  // action the lifecycle does not permit, which is a bug in the screen or a
  // gap in the map. Both need someone to look.
  console.error(
    `[transition] REFUSED ${err.from || 'null'} -> ${err.to}`
    + ` for serial ${err.serialId}${err.ttsplId ? ` (${err.ttsplId})` : ''}`
    + ` from ${err.caller || 'unknown caller'}.`
    + ' Nothing was written. If this move is legitimate, add it to ALLOWED in'
    + ' inventoryStateMachine.js — do not reopen the bypass.'
  );

  res.status(409).json({
    success: false,
    code: 'TRANSITION_REFUSED',
    message:
      `${err.ttsplId || `Serial ${err.serialId}`} is ${err.from || 'in an unknown state'}`
      + ` and cannot move to ${err.to}. Nothing was changed.`,
    detail: { serial_id: err.serialId, ttspl_id: err.ttsplId, from: err.from, to: err.to },
  });
  return true;
}

module.exports = { isTransitionRefused, respondIfRefused };
