import type { FastifyBaseLogger } from "fastify";
import type { BookingRecord, RazorpayApi } from "@mp/shared";
import type { BookingRepo } from "./repo.js";

/**
 * Sends the refund recorded on a cancelled booking to Razorpay.
 *
 * Full refund:    one call with reverse_all, which also pulls back the host's on-hold transfer.
 * Partial refund: reverse the host's proportional share of the transfer first, then refund the
 *                 guest without reverse_all (reverse_all would claw back the host's whole transfer).
 *
 * Safe to call repeatedly: beginRefund() lets only one caller proceed, and a completed transfer
 * reversal is recorded so a retry after a failed refund call doesn't reverse twice.
 * Final status (PROCESSED / FAILED) arrives later through the refund.* webhooks.
 */
export async function processRefund(
  repo: BookingRepo,
  razorpay: RazorpayApi,
  b: BookingRecord,
  log: FastifyBaseLogger,
): Promise<BookingRecord> {
  if (!b.paymentId || !b.refundPaise || b.refundPaise <= 0) return b;
  if (!(await repo.beginRefund(b.bookingId))) return (await repo.get(b.bookingId)) ?? b;

  const notes = { bookingId: b.bookingId, reason: b.cancelledBy ? `${b.cancelledBy}_cancellation` : "cancellation" };
  try {
    const full = b.refundPaise >= b.totalPaise;
    if (!full && (b.hostReversalPaise ?? 0) > 0 && !b.hostReversalId) {
      const transfers = await razorpay.paymentTransfers(b.paymentId);
      const transfer = transfers[0];
      if (!transfer) throw new Error(`no Route transfer found for payment ${b.paymentId}`);
      const reversal = await razorpay.reverseTransfer(transfer.id, b.hostReversalPaise!);
      b = await repo.setRefundFields(b.bookingId, { hostReversalId: reversal.id });
    }
    const refund = await razorpay.refund(b.paymentId!, {
      amountPaise: b.refundPaise!,
      reverseAll: full,
      receipt: b.bookingId,
      notes,
    });
    log.info({ bookingId: b.bookingId, refundId: refund.id, amount: b.refundPaise }, "refund initiated");
    return repo.setRefundFields(b.bookingId, { refundId: refund.id, refundStatus: "INITIATED" });
  } catch (e) {
    // Alert on this log line: money is owed to a guest until an admin retries.
    log.error({ err: e, bookingId: b.bookingId }, "refund failed");
    return repo.setRefundFields(b.bookingId, { refundStatus: "FAILED", refundError: (e as Error).message.slice(0, 500) });
  }
}
