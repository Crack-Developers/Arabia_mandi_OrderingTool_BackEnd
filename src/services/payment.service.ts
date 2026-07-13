import Payment from '../models/Payment';

export const paymentService = {
  async getByBillId(billId: string) {
    return Payment.find({ billId }).sort({ createdAt: -1 });
  },
};
