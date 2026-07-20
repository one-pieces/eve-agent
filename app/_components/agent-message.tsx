"use client";

import type { EveDynamicToolPart, EveMessage, EveMessagePart } from "eve/react";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BotIcon, BookOpenIcon, Trash2Icon } from "lucide-react";
import { StepDebugTrigger } from "./step-debug-dialog";

export type AgentInputResponse = {
  readonly optionId?: string;
  readonly requestId: string;
  readonly text?: string;
};

export function AgentMessage({
  canRespond,
  isStreaming,
  message,
  onDelete,
  onInputResponses,
  sessionId,
}: {
  readonly canRespond: boolean;
  readonly isStreaming: boolean;
  readonly message: EveMessage;
  readonly onDelete?: (messageId: string) => void;
  readonly onInputResponses: (
    responses: readonly AgentInputResponse[],
  ) => void | Promise<void>;
  readonly sessionId?: string;
}) {
  const lastTextIndex = message.parts.reduce(
    (last, part, index) => (part.type === "text" ? index : last),
    -1,
  );

  // `step-start` parts don't carry their own stepIndex; they're emitted
  // one per step in order, so their position among step-start parts is
  // the step index.
  let stepCounter = -1;
  const stepStartIndexByPartIndex = message.parts.map((part) =>
    part.type === "step-start" ? ++stepCounter : -1,
  );
  const turnId = message.metadata?.turnId;

  return (
    <Message
      data-optimistic={message.metadata?.optimistic ? "true" : undefined}
      from={message.role}
    >
      <div
        className={`relative flex items-end gap-1 ${message.role === "user" ? "ml-auto w-fit" : ""}`}
      >
        {onDelete && !isStreaming && message.role === "assistant" && (
          <div className="order-2 shrink-0 pb-0.5">
            <button
              className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:text-destructive"
              onClick={() => onDelete(message.id)}
              title="Delete message"
              type="button"
            >
              <Trash2Icon className="size-3.5" />
            </button>
          </div>
        )}
        {onDelete && !isStreaming && message.role === "user" && (
          <div className="order-first shrink-0 pb-0.5">
            <button
              className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:text-destructive"
              onClick={() => onDelete(message.id)}
              title="Delete message"
              type="button"
            >
              <Trash2Icon className="size-3.5" />
            </button>
          </div>
        )}
        <MessageContent>
          {message.parts.map((part, index) => (
            <AgentMessagePart
              canRespond={canRespond}
              key={partKey(part, index)}
              onInputResponses={onInputResponses}
              part={part}
              sessionId={sessionId}
              showCaret={
                isStreaming &&
                message.role === "assistant" &&
                index === lastTextIndex
              }
              stepIndex={stepStartIndexByPartIndex[index]}
              turnId={turnId}
            />
          ))}
        </MessageContent>
      </div>
    </Message>
  );
}

function AgentMessagePart({
  canRespond,
  onInputResponses,
  part,
  sessionId,
  showCaret,
  stepIndex,
  turnId,
}: {
  readonly canRespond: boolean;
  readonly onInputResponses: (
    responses: readonly AgentInputResponse[],
  ) => void | Promise<void>;
  readonly part: EveMessagePart;
  readonly sessionId?: string;
  readonly showCaret: boolean;
  readonly stepIndex?: number;
  readonly turnId?: string;
}) {
  switch (part.type) {
    case "step-start":
      return (
        <div className="flex items-center gap-2 py-1">
          <div className="h-px flex-1 bg-border" />
          {turnId && stepIndex !== undefined && stepIndex >= 0 ? (
            <StepDebugTrigger
              sessionId={sessionId}
              stepIndex={stepIndex}
              turnId={turnId}
            />
          ) : (
            <span className="text-[10px] text-muted-foreground/60 uppercase tracking-widest">
              Step
            </span>
          )}
          <div className="h-px flex-1 bg-border" />
        </div>
      );
    case "text":
      return (
        <MessageResponse caret="block" isAnimating={showCaret}>
          {part.text}
        </MessageResponse>
      );
    case "reasoning":
      return (
        <Reasoning defaultOpen isStreaming={part.state === "streaming"}>
          <ReasoningTrigger />
          <ReasoningContent>{part.text}</ReasoningContent>
        </Reasoning>
      );
    case "dynamic-tool": {
      const kind = part.toolMetadata?.eve?.kind;
      const kindLabel =
        kind === "subagent-call"
          ? "Sub-agent"
          : kind === "load-skill"
            ? "Skill"
            : undefined;
      const KindIcon =
        kind === "subagent-call"
          ? BotIcon
          : kind === "load-skill"
            ? BookOpenIcon
            : undefined;

      return (
        <Tool
          defaultOpen={
            part.state === "approval-requested" ||
            part.state === "approval-responded"
          }
        >
          <ToolHeader
            state={part.state}
            title={
              <span className="flex items-center gap-1.5">
                {part.toolName}
                {kindLabel && KindIcon && (
                  <Badge
                    variant="outline"
                    className="gap-1 rounded-full px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
                  >
                    <KindIcon className="size-3" />
                    {kindLabel}
                  </Badge>
                )}
              </span>
            }
            toolName={part.toolName}
            type="dynamic-tool"
          />
          <ToolContent>
            <ToolInput input={part.input} />
            <InputRequestActions
              canRespond={canRespond}
              part={part}
              onInputResponses={onInputResponses}
            />
            <ToolOutput errorText={part.errorText} output={part.output} />
          </ToolContent>
        </Tool>
      );
    }
  }
}

function InputRequestActions({
  canRespond,
  onInputResponses,
  part,
}: {
  readonly canRespond: boolean;
  readonly onInputResponses: (
    responses: readonly AgentInputResponse[],
  ) => void | Promise<void>;
  readonly part: EveDynamicToolPart;
}) {
  const inputRequest = part.toolMetadata?.eve?.inputRequest;
  if (!inputRequest) {
    return null;
  }

  const inputResponse = part.toolMetadata?.eve?.inputResponse;
  const selectedOption = inputRequest.options?.find(
    (option) => option.id === inputResponse?.optionId,
  );

  return (
    <div className="space-y-3 rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3">
      <p className="text-muted-foreground text-sm">{inputRequest.prompt}</p>
      {inputResponse ? (
        <p className="font-medium text-sm">
          Responded:{" "}
          {selectedOption?.label ??
            inputResponse.text ??
            inputResponse.optionId}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {inputRequest.options?.map((option) => (
            <Button
              disabled={!canRespond}
              key={option.id}
              onClick={() => {
                void onInputResponses([
                  {
                    optionId: option.id,
                    requestId: inputRequest.requestId,
                  },
                ]);
              }}
              size="sm"
              type="button"
              variant={option.style === "danger" ? "destructive" : "default"}
            >
              {option.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

function partKey(part: EveMessagePart, index: number): string {
  switch (part.type) {
    case "dynamic-tool":
      return part.toolCallId;
    default:
      return `${part.type}:${index}`;
  }
}
