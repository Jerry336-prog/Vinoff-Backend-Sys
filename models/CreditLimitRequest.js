import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  previousLimit: { type: Number, required: true, min: 0 },
  requestedLimit: { type: Number, required: true, min: 0 },
  limitVersion: { type: Number, required: true, default: 0 },
  reason: { type: String, required: true, maxlength: 1000, trim: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'superseded'], default: 'pending', index: true },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: Date,
  reviewNote: { type: String, default: '', maxlength: 1000 },
}, { timestamps: true });
schema.index({ customer: 1 }, { unique: true, partialFilterExpression: { status: 'pending' } });
export default mongoose.model('CreditLimitRequest', schema);
