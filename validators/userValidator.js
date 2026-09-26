export const validateProfileUpdate = (body) => {
  const errors = {};
  if (body.email) {
    errors.email = "Email cannot be modified directly via profile update";
  }
  if (body.role) {
    errors.role = "Role cannot be modified via profile update";
  }
  if (body.accountStatus) {
    errors.accountStatus = "Account status cannot be modified via profile update";
  }
  if (body.phone && typeof body.phone !== "string") {
    errors.phone = "Phone must be a string";
  }
  return errors;
};

export default {
  validateProfileUpdate,
};
