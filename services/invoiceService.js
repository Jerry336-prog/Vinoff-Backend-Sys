import mongoose from 'mongoose';
import Invoice, { INVOICE_STATUSES } from '../models/Invoice.js';
import User from '../models/User.js';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import { generateInvoiceNumber } from '../utils/generateInvoiceNumber.js';
import { notifyUser, logActivity } from './notificationService.js';
import { withCreditTransaction, readCreditExposure } from './creditControlService.js';
import { creditError } from '../utils/creditPolicy.js';

export const recalculateCustomerCredit = async (customerId, session) => {
  if (!customerId || !mongoose.isValidObjectId(customerId)) return 0;
  if (session) {
    const outstandingCredit = await readCreditExposure(customerId, session);
    await User.updateOne({ _id: customerId }, { $set: { outstandingCredit } }, { session });
    return outstandingCredit;
  }
  return withCreditTransaction(customerId, current => readCreditExposure(customerId, current), { enforce: false });
};

const normalizeItems = items => {
  if (!Array.isArray(items) || !items.length) throw creditError('Invoice must contain at least one item.');
  return items.map(item => {
    const quantity = Number(item.quantity);
    const unitPrice = Number(item.unitPrice);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || !Number.isFinite(unitPrice) || unitPrice < 0) throw creditError('Invoice quantities and prices must be valid positive values.');
    const isPiece = item.isCarton === false || ['pieces', 'units'].includes(item.unitType || item.unit) || /\((pieces|units)\)/i.test(item.description || '');
    return { description: item.description || item.name, quantity, unitPrice, total: Math.round(quantity * unitPrice * 100) / 100, product: item.product?._id || item.product || item.productId || undefined, isCarton: !isPiece, unitType: isPiece ? 'pieces' : 'cartons', previousStock: item.previousStock, newStock: item.newStock };
  });
};

const setTotals = invoice => {
  invoice.subtotal = invoice.items.reduce((sum, item) => sum + item.total, 0);
  if (![invoice.discount, invoice.deliveryFee].every(value => Number.isFinite(Number(value)) && Number(value) >= 0)) throw creditError('Discount and delivery fee must be non-negative amounts.');
  invoice.total = Math.round(Math.max(0, invoice.subtotal - Number(invoice.discount || 0) + Number(invoice.deliveryFee || 0)) * 100) / 100;
  if (!Number.isSafeInteger(Math.round(invoice.total * 100))) throw creditError('Invoice total is too large.');
};

export const createInvoiceForOrder = async (order, session) => {
  if (!session) return withCreditTransaction(order.customer, current => createInvoiceForOrder(order, current));
  const isCredit = Boolean(order.isCreditOrder || order.paymentStatus === 'On Credit' || order.paymentMethod === 'credit');
  const [invoice] = await Invoice.create([{
    invoiceNumber: generateInvoiceNumber(), order: order._id, customer: order.customer,
    items: normalizeItems(order.items.map(item => ({ ...(item.toObject?.() || item), description: item.name, unitPrice: item.price ?? item.unitPrice ?? item.wholesalePrice }))),
    subtotal: order.subtotal, deliveryFee: order.deliveryFee || 0, total: order.totalAmount,
    status: order.paymentStatus === 'Confirmed' ? 'Paid' : isCredit ? 'On Credit' : 'Pending',
    isCredit, notes: order.notes || `Invoice for Order #${order.orderNumber}`,
  }], { session });
  return invoice;
};

export const createCustomInvoice = async data => {
  if (data.status === 'Paid') throw creditError('Paid status is assigned automatically after Paystack verification.');
  const invoice = await withCreditTransaction(data.customer, async session => {
    const effectiveIsCredit = Boolean(data.isCredit || data.status === 'On Credit');
    const status = effectiveIsCredit && (!data.status || data.status === 'Pending') ? 'On Credit' : data.status || 'Pending';
    if (!INVOICE_STATUSES.includes(status)) throw creditError('Invalid invoice status.');
    const document = new Invoice({ ...data, invoiceNumber: generateInvoiceNumber(), status, isCredit: effectiveIsCredit, items: normalizeItems(data.items), discount: Number(data.discount || 0), deliveryFee: Number(data.deliveryFee || 0) });
    setTotals(document);
    for (const item of document.items) {
      if (!item.product) continue;
      const field = item.isCarton ? 'stock' : 'unitStock';
      const product = await Product.findOneAndUpdate({ _id: item.product, status: 'active', [field]: { $gte: item.quantity } }, { $inc: { [field]: -item.quantity } }, { session, returnDocument: 'after' });
      if (!product) throw creditError(`Product unavailable or insufficient ${item.isCarton ? 'carton' : 'unit'} stock for ${item.description}.`, 409);
      item.newStock = product[field];
      item.previousStock = product[field] + item.quantity;
    }
    await document.save({ session });
    return document;
  });
  await notifyUser({ recipientId: data.customer, type: 'INVOICE_CREATED', title: invoice.isCredit ? 'New credit invoice issued' : 'New invoice issued', message: `Invoice #${invoice.invoiceNumber} for NGN ${invoice.total.toLocaleString()} has been issued. ${invoice.isCredit ? 'It is recorded against your approved credit limit.' : 'Open your invoice to pay securely with Paystack.'}`, relatedInvoice: invoice._id });
  await logActivity({ actorId: data.createdBy, action: 'Admin created custom invoice', targetType: 'Invoice', targetId: invoice._id, description: `Created invoice #${invoice.invoiceNumber}`, metadata: { total: invoice.total, isCredit: invoice.isCredit } });
  return invoice;
};

export const updateInvoiceDetails = async (invoiceId, data, actorId) => {
  const existing = await Invoice.findById(invoiceId);
  if (!existing) throw creditError('Invoice not found.', 404);
  const invoice = await withCreditTransaction(existing.customer, async session => {
    const current = await Invoice.findById(invoiceId).session(session);
    if (!current) throw creditError('Invoice not found.', 404);
    const previousStatus = current.status;
    const financialChange = ['items', 'discount', 'deliveryFee', 'isCredit'].some(key => data[key] !== undefined);
    if (previousStatus === 'Paid' && (financialChange || (data.status && data.status !== 'Paid'))) throw creditError('A verified paid invoice cannot be changed to unpaid or have its financial details changed.');
    if (data.status === 'Paid' && previousStatus !== 'Paid') throw creditError('Paid status is assigned automatically after Paystack verification.');
    if (data.status && !INVOICE_STATUSES.includes(data.status)) throw creditError('Invalid invoice status.');
    if (data.isCredit === false && current.isCredit && !['Paid', 'Cancelled'].includes(data.status || current.status)) throw creditError('Outstanding credit cannot be removed without payment or invoice cancellation.');
    if (data.notes !== undefined) current.notes = data.notes;
    if (data.dueDate !== undefined) current.dueDate = data.dueDate ? new Date(data.dueDate) : null;
    if (data.issuedBy !== undefined) {
      if (typeof data.issuedBy !== 'string') throw creditError('Admin stamp must be a name.');
      const actor = await User.findById(actorId).session(session);
      current.issuedBy = data.issuedBy.trim() ? `${actor.firstName || ''} ${actor.lastName || ''}`.trim() || actor.email : '';
    }
    if (data.items !== undefined) current.items = normalizeItems(data.items);
    if (data.discount !== undefined) current.discount = Number(data.discount);
    if (data.deliveryFee !== undefined) current.deliveryFee = Number(data.deliveryFee);
    if (data.isCredit !== undefined) current.isCredit = Boolean(data.isCredit);
    if (data.status) current.status = data.status;
    if (current.status === 'On Credit') current.isCredit = true;
    setTotals(current);
    if (!current.createdBy) current.createdBy = actorId;
    await current.save({ session });
    return current;
  });
  await logActivity({ actorId, action: 'Admin updated invoice', targetType: 'Invoice', targetId: invoice._id, description: `Updated invoice #${invoice.invoiceNumber}`, metadata: { previousStatus: existing.status, newStatus: invoice.status, total: invoice.total } });
  return invoice;
};

export const updateInvoiceStatus = (invoiceId, status, actorId) => updateInvoiceDetails(invoiceId, { status }, actorId);

export const deleteInvoiceRecord = async invoiceId => {
  const existing = await Invoice.findById(invoiceId);
  if (!existing) throw creditError('Invoice not found.', 404);
  return withCreditTransaction(existing.customer, async session => {
    const invoice = await Invoice.findByIdAndDelete(invoiceId, { session });
    if (!invoice) throw creditError('Invoice not found.', 404);
    if (invoice.order) await Order.updateOne({ _id: invoice.order }, { $unset: { invoice: '' } }, { session });
    return invoice;
  });
};

export default { recalculateCustomerCredit, createInvoiceForOrder, createCustomInvoice, updateInvoiceStatus, updateInvoiceDetails, deleteInvoiceRecord };
