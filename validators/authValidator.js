export const validateRegister = (body) => {
  const errors = {};
  if (!body.firstName || !body.firstName.trim()) {
    errors.firstName = "First name is required";
  }
  if (!body.lastName || !body.lastName.trim()) {
    errors.lastName = "Last name is required";
  }
  if (!body.email || !body.email.trim()) {
    errors.email = "Email is required";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) {
    errors.email = "Invalid email format";
  }
  if (!body.password || body.password.length < 6) {
    errors.password = "Password must be at least 6 characters long";
  }
  return errors;
};

export const validateLogin = (body) => {
  const errors = {};
  if (!body.email || !body.email.trim()) {
    errors.email = "Email is required";
  }
  if (!body.password) {
    errors.password = "Password is required";
  }
  return errors;
};

export default {
  validateRegister,
  validateLogin,
};
