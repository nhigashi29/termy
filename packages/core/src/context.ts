import type { ContextId, ContextNode } from "./context-types.js";

export type CreateContextNodeInput<
  TType extends string = string,
  TPayload = unknown,
> = {
  id: ContextId;
  type: TType;
  payload: TPayload;
  createdAt?: Date;
  createdBy?: ContextId;
};

export function createContextNode<
  TType extends string,
  TPayload,
>(input: CreateContextNodeInput<TType, TPayload>): ContextNode<TType, TPayload> {
  return {
    id: input.id,
    type: input.type,
    payload: input.payload,
    createdAt: input.createdAt ?? new Date(),
    createdBy: input.createdBy,
  };
}
