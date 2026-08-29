import { Model } from './model';

/** Collection of transaction reasons */
export enum TransactionReason {
  /** Used for issuing daily credits to members when they log in */
  DailyCredit = 'daily-credit',
  /** Used for taking payments from users when they buy a house */
  HomePurchase = 'home-purchase',
  /** Used for transacting between the buyer and the seller of an item */
  ItemPurchase = 'item-purchase',
  /** Catch-all for any transaction between two members */
  MemberToMember = 'member-to-member',
  /** Catch-all for any transaction between a member and Cybertown itself */
  SystemToMember = 'system-to-member',
  /**
   * The CityCash a new citizen is granted on immigrating.
   *
   * Its own reason rather than SystemToMember so the largest single grant in the economy
   * is identifiable in the ledger -- `m_immigrate` in colonycity/config/money.cfg.
   */
  Immigration = 'immigration-grant',
  /** Used for refunding payments to users when they sell a house */
  HomeRefund = 'home-refund',
  /** Used for weekly job credits to user */
  WeeklyCredit = 'weekly-role-credit',
  ObjectUpload = 'object-upload',
  ObjectUploadRefund = 'object-upload-refund',
  ObjectUnsoldInstancesRefund = 'object-unsold-instances-refund',
  ObjectPurchase = 'object-purchase',
  ObjectProfit = 'object-profit',
  ObjectSell = 'object-sell',
  ObjectRestock = 'object-restock',
}

/** Defines a Transaction object as stored in the db */
export interface Transaction extends Model {
  /** Number of CCs moved */
  amount: number;
  /** The reason the transaction was created */
  reason: string;
  /** ID of the wallet that received CCs. Can be null if the recipient is the system. */
  recipient_wallet_id?: number;
  /** ID of the wallet that sent CCS. Can be null if the sender is the system. */
  sender_wallet_id?: number;
  /**
   * Free-text reason the sender gave for a CityCash transfer, at most 30 characters.
   *
   * The Bank's historical `TO_NAM` field. Null when none was given, and null on every
   * transaction type that has no sender-supplied reason.
   *
   * Stored as the citizen's literal plain text. It is escaped where it is rendered, not
   * here -- see libs/html.ts.
   */
  memo?: string;
  /**
   * Client-supplied key naming the INTENT this row committed, unique across the table.
   *
   * Set only by the Bank transfer; null on every other transaction type, and on every row
   * written before the column existed. The UNIQUE index on it is what makes a retried
   * transfer move money once -- see TransferRepository.
   */
  idempotency_key?: string;
}
