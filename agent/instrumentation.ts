import { defineInstrumentation } from "eve/instrumentation";
import { recordStepRequest } from "./lib/step-debug-store";

export default defineInstrumentation({
  events: {
    "step.started"(input) {
      // Fire-and-forget: this callback's return type isn't a Promise, so we
      // don't await the disk write here. Log failures instead of throwing,
      // since instrumentation callbacks must never break the turn.
      void recordStepRequest({
        sessionId: input.session.id,
        turnId: input.turn.id,
        stepIndex: input.step.index,
        instructions: input.modelInput.instructions,
        messages: input.modelInput.messages,
      }).catch((error) => {
        console.error("Failed to record step debug request", error);
      });
      return undefined;
    },
  },
});
