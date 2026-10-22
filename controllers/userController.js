import User from "../models/User.js";
import { uploadBuffer } from "../services/cloudinaryService.js";
import { notifyAdmins, logActivity } from "../services/notificationService.js";
import { recalculateCustomerCredit } from "../services/invoiceService.js";
import { successResponse, errorResponse } from "../utils/response.js";

/**
 * Get profile of current user
 * GET /api/users/me
 */
export const getMyProfile = async (req, res, next) => {
  try {
    const freshUser = await User.findById(req.user._id);
    if (!freshUser) {
      return errorResponse(res, 404, "User not found");
    }
    const outstandingCredit = await recalculateCustomerCredit(freshUser._id);
    const userObj = freshUser.toJSON();
    userObj.isVipCreditPartner = Boolean(freshUser.isVipCreditPartner);
    userObj.outstandingCredit = outstandingCredit;
    userObj.isOwingCredit = outstandingCredit > 0;
    return successResponse(res, 200, "Profile retrieved successfully", userObj);
  } catch (error) {
    next(error);
  }
};

/**
 * Update current user profile
 * PATCH /api/users/me
 */
export const updateMyProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return errorResponse(res, 404, "User not found");
    }

    const {
      firstName,
      lastName,
      phone,
      companyName,
      businessType,
      address,
      city,
      state,
      country,
    } = req.body;

    if (firstName) user.firstName = firstName.trim();
    if (lastName) user.lastName = lastName.trim();
    if (phone !== undefined) user.phone = phone.trim();

    // Update profile subdocument fields
    if (companyName !== undefined)
      user.profile.companyName = companyName.trim();
    if (businessType !== undefined)
      user.profile.businessType = businessType.trim();
    if (address !== undefined) user.profile.address = address.trim();
    if (city !== undefined) user.profile.city = city.trim();
    if (state !== undefined) user.profile.state = state.trim();
    if (country !== undefined) user.profile.country = country.trim();

    // If an avatar image file was uploaded
    if (req.file) {
      const uploadResult = await uploadBuffer(
        req.file.buffer,
        "vinoff_avatars",
      );
      user.profile.avatar = {
        url: uploadResult.url,
        publicId: uploadResult.publicId,
      };
    }

    user.profileUpdatedAt = new Date();
    await user.save();

    // If user is a customer, notify admin & log activity
    if (user.role === "customer") {
      await notifyAdmins({
        type: "PROFILE_UPDATED",
        title: "Customer Profile Updated",
        message: `${user.firstName} ${user.lastName} updated their profile information.`,
        relatedUser: user._id,
      });

      await logActivity({
        actorId: user._id,
        action: "Customer updated profile",
        targetType: "User",
        targetId: user._id,
        description: `${user.firstName} ${user.lastName} updated their profile details`,
        metadata: {
          companyName: user.profile.companyName,
          phone: user.phone,
          profileUpdatedAt: user.profileUpdatedAt,
        },
      });
    }

    const outstandingCredit = await recalculateCustomerCredit(user._id);
    const userObj = user.toJSON();
    userObj.isVipCreditPartner = Boolean(user.isVipCreditPartner);
    userObj.outstandingCredit = outstandingCredit;
    userObj.isOwingCredit = outstandingCredit > 0;

    return successResponse(res, 200, "Profile updated successfully", userObj);
  } catch (error) {
    next(error);
  }
};

export default {
  getMyProfile,
  updateMyProfile,
};
