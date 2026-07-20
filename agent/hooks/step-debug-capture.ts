import { defineHook } from "eve/hooks";
import {
  appendActionResult,
  recordStepResponsePatch,
} from "../lib/step-debug-store";

export default defineHook({
  events: {
    async "message.completed"(event, ctx) {
      await recordStepResponsePatch(
        ctx.session.id,
        event.data.turnId,
        event.data.stepIndex,
        {
          text: event.data.message,
          finishReason: event.data.finishReason,
        },
      );
    },
    async "reasoning.completed"(event, ctx) {
      await recordStepResponsePatch(
        ctx.session.id,
        event.data.turnId,
        event.data.stepIndex,
        {
          reasoning: event.data.reasoning,
        },
      );
    },
    async "actions.requested"(event, ctx) {
      await recordStepResponsePatch(
        ctx.session.id,
        event.data.turnId,
        event.data.stepIndex,
        {
          actions: event.data.actions,
        },
      );
    },
    async "action.result"(event, ctx) {
      await appendActionResult(
        ctx.session.id,
        event.data.turnId,
        event.data.stepIndex,
        {
          result: event.data.result,
          status: event.data.status,
          error: event.data.error,
        },
      );
    },
    async "step.completed"(event, ctx) {
      await recordStepResponsePatch(
        ctx.session.id,
        event.data.turnId,
        event.data.stepIndex,
        {
          finishReason: event.data.finishReason,
          usage: event.data.usage,
        },
      );
    },
    async "step.failed"(event, ctx) {
      await recordStepResponsePatch(
        ctx.session.id,
        event.data.turnId,
        event.data.stepIndex,
        {
          failed: {
            code: event.data.code,
            message: event.data.message,
            details: event.data.details,
          },
        },
      );
    },
  },
});
