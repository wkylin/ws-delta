export interface SendLimits {
  bufferedAmountHighWaterBytes: number;
  bufferedAmountCloseBytes: number;
}

export type SendDecision = "send" | "drop_recoverable" | "close_slow_consumer";

export function decideSend(
  bufferedAmount: number,
  messageBytes: number,
  recoverable: boolean,
  limits: SendLimits,
): SendDecision {
  const projected = bufferedAmount + messageBytes;
  if (projected >= limits.bufferedAmountCloseBytes) {
    return "close_slow_consumer";
  }
  if (recoverable && projected >= limits.bufferedAmountHighWaterBytes) {
    return "drop_recoverable";
  }
  return "send";
}
