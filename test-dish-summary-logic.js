const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config({ path: './.env' });
const Order = require('./dist/models/Order').default || require('./dist/models/Order');
const Bill = require('./dist/models/Bill').default || require('./dist/models/Bill');
const Payment = require('./dist/models/Payment').default || require('./dist/models/Payment');
const MenuItem = require('./dist/models/MenuItem').default || require('./dist/models/MenuItem');

async function testDishSummary() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  const tStart = new Date('2026-08-07T18:30:00.000Z');
  const tEnd = new Date('2026-08-08T18:29:59.999Z');
  
  const dateFilter = {
    $or: [
      { createdAt: { $gte: tStart, $lte: tEnd } },
      { createdAt: { $gte: tStart.toISOString(), $lte: tEnd.toISOString() } },
    ]
  };

  const payments = await Payment.find(dateFilter).select('orderId').lean();
  const bills = await Bill.find(dateFilter).select('orderId').lean();
  
  const transactionOrderIds = [
    ...payments.map(p => p.orderId),
    ...bills.map(b => b.orderId)
  ].filter(Boolean);
  
  const orderDateFilter = {
    $or: [
      { _id: { $in: transactionOrderIds } },
      { completedAt: { $gte: tStart, $lte: tEnd } },
      { completedAt: { $gte: tStart.toISOString(), $lte: tEnd.toISOString() } },
      { 
        createdAt: { $gte: tStart, $lte: tEnd },
        status: { $nin: ['Paid', 'paid', 'PAID', 'Completed', 'completed', 'Settled', 'settled', 'Billed', 'billed'] }
      },
      { 
        createdAt: { $gte: tStart.toISOString(), $lte: tEnd.toISOString() },
        status: { $nin: ['Paid', 'paid', 'PAID', 'Completed', 'completed', 'Settled', 'settled', 'Billed', 'billed'] }
      }
    ]
  };

  const orderMatch = { $and: [orderDateFilter, { status: { $nin: ['Cancelled', 'cancelled'] } }] };
  
  const aggPipeline = [
    { $match: orderMatch },
    { $unwind: '$items' },
    {
      $lookup: {
        from: 'menuitems',
        localField: 'items.menuItemId',
        foreignField: '_id',
        as: 'menuItemData',
      },
    },
    {
      $lookup: {
        from: 'categories',
        localField: 'menuItemData.0.categoryId',
        foreignField: '_id',
        as: 'categoryData',
      },
    },
    {
      $group: {
        _id: { $ifNull: ['$items.menuItemId', '$items._id'] },
        name: { $first: { $ifNull: ['$items.name', 'Unknown Item'] } },
        category: { $first: { $ifNull: [{ $arrayElemAt: ['$categoryData.name', 0] }, 'Uncategorized'] } },
        qtySold: { $sum: { $ifNull: ['$items.quantity', { $ifNull: ['$items.qty', 1] }] } },
        revenue: {
          $sum: {
            $let: {
              vars: {
                effectivePrice: {
                  $let: {
                    vars: {
                      matchedVariant: {
                        $arrayElemAt: [
                          {
                            $filter: {
                              input: { $ifNull: [{ $arrayElemAt: ['$menuItemData.variants', 0] }, []] },
                              as: 'v',
                              cond: { $eq: ['$$v.name', '$items.variantName'] }
                            }
                          },
                          0
                        ]
                      }
                    },
                    in: {
                      $cond: [
                        { $gt: ['$items.price', 0] },
                        '$items.price',
                        { $ifNull: ['$$matchedVariant.price', 0] }
                      ]
                    }
                  }
                },
                qty: { $ifNull: ['$items.quantity', { $ifNull: ['$items.qty', 1] }] },
                taxRate: { $ifNull: ['$items.taxRate', 0] },
              },
              in: {
                $let: {
                  vars: {
                    lineTotal: { $multiply: ['$$effectivePrice', '$$qty'] }
                  },
                  in: {
                    $add: [
                      '$$lineTotal',
                      { $multiply: ['$$lineTotal', { $divide: ['$$taxRate', 100] }] },
                    ]
                  }
                }
              },
            },
          },
        },
      },
    },
    { $sort: { qtySold: -1, revenue: -1 } }
  ];

  const itemsResult = await Order.aggregate(aggPipeline);
  console.log('itemsResult:', itemsResult);
  
  const menuItem = await MenuItem.findById('94ff562d-36db-4055-b8ac-2a56313b78f6').lean();
  console.log('MenuItem:', JSON.stringify(menuItem, null, 2));
  
  process.exit(0);
}
testDishSummary();
