import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  reference: { type: String, unique: true, required: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
  invoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice' },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'NGN' },
  status: { type: String, default: 'pending' },
  authorizationUrl: String,
  accessCode: String,
  paidAt: Date,
}, { timestamps: true });
export default mongoose.model('Payment', schema);
