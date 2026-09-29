import ExpenseLedger from "../models/Expense.js";
import { uploadBuffer } from "../services/cloudinaryService.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Format a JS Date as "YYYY-MM-DD" in Lagos time (UTC+1). */
const todayKey = (offset = 1) => {
  const now = new Date();
  const local = new Date(now.getTime() + offset * 60 * 60 * 1000);
  return local.toISOString().slice(0, 10);
};

/** Sum all amounts in an array of line items. */
const sumItems = (items = []) =>
  (items || []).reduce((acc, i) => acc + Number(i?.amount || 0), 0);

const formatLedger = (ledgerDoc) => {
  if (!ledgerDoc) return null;
  const ledger = ledgerDoc.toObject ? ledgerDoc.toObject() : { ...ledgerDoc };

  const totalIncome = sumItems(ledger.income);
  const totalExpenses = sumItems(ledger.expenses);
  const openingBalance = Number(ledger.openingBalance) || 0;
  const closingBalance =
    ledger.closedAt != null
      ? (Number(ledger.closingBalance) ?? (openingBalance + totalIncome - totalExpenses))
      : (openingBalance + totalIncome - totalExpenses);

  const incomeItems = (ledger.income || []).map((i) => ({ ...i, type: "income" }));
  const expenseItems = (ledger.expenses || []).map((i) => ({ ...i, type: "expense" }));
  const lineItems = [...incomeItems, ...expenseItems];

  let stampedByAdmin = null;
  if (ledger.closedBy) {
    if (typeof ledger.closedBy === "object" && ledger.closedBy !== null) {
      if (ledger.closedBy.firstName) {
        stampedByAdmin = `${ledger.closedBy.firstName} ${ledger.closedBy.lastName || ""}`.trim();
      } else if (ledger.closedBy.email) {
        stampedByAdmin = ledger.closedBy.email;
      } else {
        stampedByAdmin = "Admin";
      }
    } else {
      stampedByAdmin = "Admin";
    }
  }

  return {
    ...ledger,
    status: ledger.closedAt ? "closed" : "open",
    totalIncome,
    totalExpenses,
    totalExpense: totalExpenses,
    closingBalance,
    lineItems,
    evidence: ledger.evidence || [],
    stampedByAdmin,
    stampedAt: ledger.closedAt,
  };
};

// ─── Controllers ────────────────────────────────────────────────────────────

export const getLedgers = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(90, parseInt(req.query.limit) || 30);
    const skip = (page - 1) * limit;

    const [rawLedgers, total] = await Promise.all([
      ExpenseLedger.find()
        .sort({ date: -1 })
        .skip(skip)
        .limit(limit)
        .populate("closedBy", "firstName lastName email")
        .lean(),
      ExpenseLedger.countDocuments(),
    ]);

    const ledgers = rawLedgers.map((l) => formatLedger(l));

    return res.json({
      success: true,
      data: ledgers,
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("[expenseController.getLedgers]", err);
    return res.status(500).json({ success: false, message: err.message || "Server error" });
  }
};

export const getTodayLedger = async (req, res) => {
  try {
    const key = todayKey();

    let ledger = await ExpenseLedger.findOne({ date: key })
      .populate("closedBy", "firstName lastName email")
      .lean();

    if (ledger) {
      return res.json({ success: true, data: formatLedger(ledger) });
    }

    // Auto-create today's ledger inheriting yesterday's closing balance (or 0)
    const lastClosed = await ExpenseLedger.findOne({
      date: { $lt: key },
      closedAt: { $ne: null },
    })
      .sort({ date: -1 })
      .lean();

    const inheritedOpening = lastClosed ? Number(lastClosed.closingBalance) || 0 : 0;

    ledger = await ExpenseLedger.create({
      date: key,
      openingBalance: inheritedOpening,
    });

    ledger = await ExpenseLedger.findById(ledger._id)
      .populate("closedBy", "firstName lastName email")
      .lean();

    return res.json({ success: true, data: formatLedger(ledger) });
  } catch (err) {
    console.error("[expenseController.getTodayLedger]", err);
    return res.status(500).json({ success: false, message: err.message || "Server error" });
  }
};

export const setupFirstDay = async (req, res) => {
  try {
    const key = todayKey();
    let ledger = await ExpenseLedger.findOne({ date: key });

    const openingBalance = Number(req.body.openingBalance);
    if (isNaN(openingBalance) || openingBalance < 0) {
      return res.status(400).json({
        success: false,
        message: "A valid opening balance is required.",
      });
    }

    if (ledger) {
      ledger.openingBalance = openingBalance;
      await ledger.save();
    } else {
      ledger = await ExpenseLedger.create({ date: key, openingBalance });
    }

    const updated = await ExpenseLedger.findById(ledger._id)
      .populate("closedBy", "firstName lastName email")
      .lean();

    return res.status(201).json({ success: true, data: formatLedger(updated) });
  } catch (err) {
    console.error("[expenseController.setupFirstDay]", err);
    return res.status(500).json({ success: false, message: err.message || "Server error" });
  }
};

export const addEntry = async (req, res) => {
  try {
    const key = todayKey();
    let ledger = await ExpenseLedger.findOne({ date: key });

    if (!ledger) {
      const lastClosed = await ExpenseLedger.findOne({
        date: { $lt: key },
        closedAt: { $ne: null },
      }).sort({ date: -1 });

      ledger = await ExpenseLedger.create({
        date: key,
        openingBalance: lastClosed ? Number(lastClosed.closingBalance) || 0 : 0,
      });
    }

    if (ledger.closedAt) {
      return res.status(400).json({
        success: false,
        message: "Today's ledger is already closed.",
      });
    }

    const { type, description, amount } = req.body || {};
    if (!["income", "expense"].includes(type)) {
      return res
        .status(400)
        .json({ success: false, message: "type must be 'income' or 'expense'." });
    }
    if (!description?.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "Description is required." });
    }
    const parsedAmount = Number(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res
        .status(400)
        .json({ success: false, message: "Amount must be a positive number." });
    }

    const entry = { description: description.trim(), amount: parsedAmount };

    if (type === "income") {
      ledger.income.push(entry);
    } else {
      ledger.expenses.push(entry);
    }

    await ledger.save();

    const updated = await ExpenseLedger.findById(ledger._id)
      .populate("closedBy", "firstName lastName email")
      .lean();

    return res.json({ success: true, data: formatLedger(updated) });
  } catch (err) {
    console.error("[expenseController.addEntry]", err);
    return res.status(500).json({ success: false, message: err.message || "Server error" });
  }
};

export const removeEntry = async (req, res) => {
  try {
    const key = todayKey();
    const ledger = await ExpenseLedger.findOne({ date: key });

    if (!ledger || ledger.closedAt) {
      return res
        .status(400)
        .json({ success: false, message: "Cannot edit a closed or missing ledger." });
    }

    const { entryId } = req.params;

    const incomeBefore = ledger.income.length;
    ledger.income = ledger.income.filter((i) => i._id.toString() !== entryId);

    if (ledger.income.length === incomeBefore) {
      ledger.expenses = ledger.expenses.filter((i) => i._id.toString() !== entryId);
    }

    await ledger.save();

    const updated = await ExpenseLedger.findById(ledger._id)
      .populate("closedBy", "firstName lastName email")
      .lean();

    return res.json({ success: true, data: formatLedger(updated) });
  } catch (err) {
    console.error("[expenseController.removeEntry]", err);
    return res.status(500).json({ success: false, message: err.message || "Server error" });
  }
};

export const closeDay = async (req, res) => {
  try {
    const key = todayKey();
    let ledger = await ExpenseLedger.findOne({ date: key });

    if (!ledger) {
      ledger = await ExpenseLedger.create({ date: key, openingBalance: 0 });
    }

    if (ledger.closedAt) {
      return res
        .status(400)
        .json({ success: false, message: "Today's ledger is already closed." });
    }

    const totalIncome = sumItems(ledger.income);
    const totalExpenses = sumItems(ledger.expenses);
    const openingBalance = Number(ledger.openingBalance) || 0;
    const closingBalance = openingBalance + totalIncome - totalExpenses;

    ledger.closingBalance = closingBalance;
    ledger.closedAt = new Date();
    if (req.user?._id) {
      ledger.closedBy = req.user._id;
    } else if (req.user?.id) {
      ledger.closedBy = req.user.id;
    }
    if (req.body?.notes) ledger.notes = String(req.body.notes).trim();

    await ledger.save();

    const updated = await ExpenseLedger.findById(ledger._id)
      .populate("closedBy", "firstName lastName email")
      .lean();

    return res.json({ success: true, data: formatLedger(updated) });
  } catch (err) {
    console.error("[expenseController.closeDay]", err);
    return res.status(500).json({ success: false, message: err.message || "Server error" });
  }
};

/**
 * Get a specific day's ledger by YYYY-MM-DD
 * GET /api/admin/expenses/day/:date
 */
export const getLedgerByDate = async (req, res) => {
  try {
    const { date } = req.params;
    const ledger = await ExpenseLedger.findOne({ date })
      .populate("closedBy", "firstName lastName email")
      .lean();

    if (!ledger) {
      return res.status(404).json({ success: false, message: "No expense ledger found for this date." });
    }

    return res.json({ success: true, data: formatLedger(ledger) });
  } catch (err) {
    console.error("[expenseController.getLedgerByDate]", err);
    return res.status(500).json({ success: false, message: err.message || "Server error" });
  }
};

/**
 * Upload receipt/evidence attachments for a specific day's ledger
 * POST /api/admin/expenses/:date/evidence or /api/admin/expenses/evidence
 */
export const uploadEvidence = async (req, res) => {
  try {
    const key = req.params.date || req.body.date || todayKey();
    let ledger = await ExpenseLedger.findOne({ date: key });

    if (!ledger) {
      ledger = await ExpenseLedger.create({ date: key, openingBalance: 0 });
    }

    const uploaded = [];

    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const uploadResult = await uploadBuffer(file.buffer, "vinoff_expenses", {
          resource_type: "auto",
        });
        uploaded.push({
          url: uploadResult.url,
          filename: file.originalname || "evidence_receipt",
          uploadedAt: new Date(),
        });
      }
    } else if (req.file) {
      const uploadResult = await uploadBuffer(req.file.buffer, "vinoff_expenses", {
        resource_type: "auto",
      });
      uploaded.push({
        url: uploadResult.url,
        filename: req.file.originalname || "evidence_receipt",
        uploadedAt: new Date(),
      });
    }

    if (uploaded.length > 0) {
      if (!ledger.evidence) ledger.evidence = [];
      ledger.evidence.push(...uploaded);
      await ledger.save();
    }

    const updated = await ExpenseLedger.findById(ledger._id)
      .populate("closedBy", "firstName lastName email")
      .lean();

    return res.json({
      success: true,
      message: `${uploaded.length} evidence file(s) attached successfully`,
      data: formatLedger(updated),
    });
  } catch (err) {
    console.error("[expenseController.uploadEvidence]", err);
    return res.status(500).json({ success: false, message: err.message || "Server error" });
  }
};

export default {
  getLedgers,
  getTodayLedger,
  getLedgerByDate,
  setupFirstDay,
  addEntry,
  removeEntry,
  closeDay,
  uploadEvidence,
};
