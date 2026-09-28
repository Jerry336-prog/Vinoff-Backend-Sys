import Setting from "../models/Setting.js";
import { successResponse, errorResponse } from "../utils/response.js";
import { logActivity } from "../services/notificationService.js";

const DEFAULT_BANK_DETAILS = {
  bankName: "Guaranty Trust Bank (GTB)",
  accountName: "Vinoff Wholesales Ltd",
  accountNumber: "0123456789",
  instructions: "Please use your Order # or Invoice # as the transfer payment narration.",
};

/**
 * GET /api/settings/bank-details
 * Retrieve active company bank account details
 */
export const getBankDetails = async (req, res, next) => {
  try {
    const setting = await Setting.findOne({ key: "bank_details" });
    const bankDetails = setting ? setting.value : DEFAULT_BANK_DETAILS;
    return successResponse(res, 200, "Bank account details retrieved successfully", bankDetails);
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/settings/bank-details
 * Update company bank account details (Super Admin Only)
 */
export const updateBankDetails = async (req, res, next) => {
  try {
    // Permission guard: Only Super Admin can modify bank account details
    if (!req.user || req.user.role !== "superadmin") {
      return errorResponse(
        res,
        403,
        "Access denied. Only Super Admin accounts can modify company bank details."
      );
    }

    const { bankName, accountName, accountNumber, instructions } = req.body;

    if (!bankName || !bankName.trim()) {
      return errorResponse(res, 400, "Bank Name is required");
    }
    if (!accountName || !accountName.trim()) {
      return errorResponse(res, 400, "Account Name is required");
    }
    if (!accountNumber || !accountNumber.trim()) {
      return errorResponse(res, 400, "Account Number is required");
    }

    const updatedDetails = {
      bankName: bankName.trim(),
      accountName: accountName.trim(),
      accountNumber: accountNumber.trim(),
      instructions: instructions ? instructions.trim() : "",
    };

    const setting = await Setting.findOneAndUpdate(
      { key: "bank_details" },
      {
        key: "bank_details",
        value: updatedDetails,
        updatedBy: req.user._id,
      },
      { upsert: true, new: true, runValidators: true }
    );

    await logActivity({
      actorId: req.user._id,
      action: "Super Admin updated company bank account details",
      targetType: "Setting",
      targetId: setting._id,
      description: `Super Admin updated bank details: ${updatedDetails.bankName} (${updatedDetails.accountNumber})`,
      metadata: updatedDetails,
    });

    return successResponse(
      res,
      200,
      "Company bank account details updated successfully",
      setting.value
    );
  } catch (error) {
    next(error);
  }
};
