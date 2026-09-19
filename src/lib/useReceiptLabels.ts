import { useMemo } from 'react'
import { useProfileStore } from '../store/profileStore'
import { receiptLabelsFor, type ReceiptLabels } from './receiptLabels'

/**
 * The trust's own words, for any document handed to the person who paid.
 *
 * ── THE TWO LANGUAGES, AND WHY THEY ARE NOT THE SAME ────────────────────────
 * This app has two vocabularies and they answer to different readers:
 *
 *   `t()` / common.json   the OPERATOR'S UI language. What the volunteer at the
 *                         counter reads. Follows whatever they picked in the
 *                         header, and changes when they pick something else.
 *
 *   `receiptLabels`       the TRUST'S printed vocabulary, in the trust's receipt
 *                         language, with the trust's own words on top
 *                         (tenant migration 046). What a donor or guest reads.
 *
 * A receipt is rendered by `receiptTemplates.ts`, which has always read the
 * second. But three documents — the room and hall bill, the annual 80G
 * certificate, and the boli pledge intimation — took their labels from the
 * FIRST, because their labels are parameters and the callers had `t()` to hand.
 *
 * So a trust that renamed a word in the wording editor saw it on seventeen
 * receipt designs and not on the bill, and a guest handed both got two documents
 * that disagree: reported as "many receipts are not beening udpated as per the
 * new wording sets or as per new words for that particular mandir".
 *
 * Worse in the other direction too: those documents were printing in the
 * VOLUNTEER'S chosen language. A Marathi-speaking volunteer at a trust that
 * issues English receipts was handing guests a Marathi bill.
 *
 * ── WHY A HOOK ──────────────────────────────────────────────────────────────
 * The overrides live on the profile, which the store already holds — every
 * screen that prints one of these documents has it. A hook keeps the resolution
 * in one place, so there is no per-screen copy of "which language, whose words".
 */
export function useReceiptLabels(): ReceiptLabels {
  const profile = useProfileStore(s => s.profile)
  return useMemo(
    () => receiptLabelsFor(profile?.receipt_language, profile?.receipt_label_overrides),
    [profile?.receipt_language, profile?.receipt_label_overrides],
  )
}
