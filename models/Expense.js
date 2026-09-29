import mongoose from "mongoose";

const lineItemSchema = new mongoose.Schema(
  {
    description: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: true, timestamps: false }
);

const expenseLedgerSchema = new mongoose.Schema(
  {
    // Date key — one ledger per calendar day (YYYY-MM-DD)
    date: {
      type: String,
      required: true,
      unique: true,
      index: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },

    // Balance carried from previous day's closingBalance (or manually entered on first day)
    openingBalance: { type: Number, required: true, default: 0 },

    // Money added to the balance today
    income: { type: [lineItemSchema], default: [] },

    // Money spent today
    expenses: { type: [lineItemSchema], default: [] },

    // Computed on close: openingBalance + sum(income) - sum(expenses)
    closingBalance: { type: Number, default: null },

    // Null = still open, Date = closed
    closedAt: { type: Date, default: null },

    // Admin who pressed "Close Day"
    closedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    notes: { type: String, trim: true, default: "" },
    // Uploaded receipts, payment slips, or documentation for this day
    evidence: [
      {
        url: { type: String, required: true },
        filename: { type: String, default: "evidence_receipt" },
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

const ExpenseLedger = mongoose.model("ExpenseLedger", expenseLedgerSchema);
export default ExpenseLedger;
