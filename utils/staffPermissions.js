export const STAFF_PERMISSIONS = [
  'dashboard.view', 'orders.view', 'orders.manage', 'invoices.view', 'invoices.manage',
  'customers.view', 'customers.manage', 'products.manage', 'inventory.manage',
  'chats.manage', 'announcements.manage', 'expenses.manage', 'analytics.view',
  'activity.view', 'settings.manage', 'credit.request',
];

export const isStaff = user => ['admin', 'subAdmin', 'superadmin'].includes(user?.role);
export const notificationPermission = type => ({
  NEW_ORDER: 'orders.view', ORDER_STATUS_CHANGED: 'orders.view', PAYMENT_UPLOADED: 'orders.view',
  PAYMENT_CONFIRMED: 'invoices.view', INVOICE_CREATED: 'invoices.view',
  PROFILE_UPDATED: 'customers.view', CUSTOMER_REGISTERED: 'customers.view',
  PRODUCT_ADDED: 'products.manage', PRODUCT_UPDATED: 'products.manage',
  INVENTORY_ALERT: 'inventory.manage', LOW_STOCK: 'inventory.manage',
  NEW_MESSAGE: 'chats.manage', ANNOUNCEMENT_POSTED: 'announcements.manage', EXPENSE_LOGGED: 'expenses.manage',
  CREDIT_LIMIT_REQUESTED: 'superadmin',
}[type] || null);
export const hasPermission = (user, permission) => user?.role === 'superadmin' ||
  (isStaff(user) && Array.isArray(user.staffPermissions) && (user.staffPermissions.includes(permission) || (permission === 'catalog.read' && ['products.manage', 'inventory.manage'].some(key => user.staffPermissions.includes(key)))));

// Resolve aliases and customer/staff shared endpoints in one place so alternate URLs
// cannot bypass the same permission checks. Super-admin-only routes remain explicit.
export const requiredPermissions = (method, url, body = {}) => {
  const path = String(url || '').split('?')[0].replace(/\/+$/, '');
  const read = ['GET', 'HEAD'].includes(String(method).toUpperCase());
  if (/^\/api\/admin\/(staff|credit-requests)/.test(path)) return [];
  if (/^\/api\/admin\/customers\/[^/]+\/credit-limit/.test(path)) return ['credit.request'];
  if (/^\/api\/admin\/dashboard/.test(path)) return ['dashboard.view'];
  if (/^\/api\/admin\/(users|customers)/.test(path)) return [read ? 'customers.view' : 'customers.manage'];
  if (/^\/api\/(admin\/)?orders(?:\/|$)/.test(path)) return [read ? 'orders.view' : 'orders.manage'];
  if (/^\/api\/(admin\/)?invoices(?:\/|$)/.test(path)) return [read ? 'invoices.view' : 'invoices.manage'];
  if (/^\/api\/(admin\/)?products(?:\/|$)/.test(path)) {
    if (read) return /^\/api\/admin\//.test(path) ? ['catalog.read'] : [];
    const stockFields = ['stock', 'unitStock', 'trackUnitStock'];
    const keys = Object.keys(body || {});
    if (String(method).toUpperCase() === 'PATCH' && keys.length && keys.every(key => stockFields.includes(key))) return ['inventory.manage'];
    return ['products.manage', ...(keys.some(key => stockFields.includes(key)) ? ['inventory.manage'] : [])];
  }
  if (/^\/api\/(admin\/)?chats(?:\/|$)/.test(path)) return ['chats.manage'];
  if (/^\/api\/admin\/expenses(?:\/|$)/.test(path)) return ['expenses.manage'];
  if (/^\/api\/admin\/announcements(?:\/|$)/.test(path)) return ['announcements.manage'];
  if (/^\/api\/(admin\/analytics|analytics\/summary)/.test(path)) return ['analytics.view'];
  if (/^\/api\/admin\/activity/.test(path)) return ['activity.view'];
  if (/^\/api\/settings\/(sessions|sessions\/.*)$/.test(path)) return [];
  if (/^\/api\/settings\//.test(path) && (!read || /\/notifications$/.test(path))) return ['settings.manage'];
  return [];
};
