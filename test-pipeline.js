const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config({ path: './.env' });
const Order = require('./dist/models/Order').default || require('./dist/models/Order');

async function testDishSummary() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  const start = new Date('2026-08-08T00:00:00.000+05:30');
  const end = new Date('2026-08-08T23:59:59.999+05:30');
  const isoStart = start.toISOString();
  const isoEnd = end.toISOString();
  
  const dateFilter = {
    $or: [
      { createdAt: { $gte: start, $lte: end } },
      { createdAt: { $gte: isoStart, $lte: isoEnd } },
    ]
  };
  
  const orderMatch = { ...dateFilter, status: { $nin: ['Cancelled', 'cancelled'] } };

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
      $addFields: {
        resolvedCategory: {
          $ifNull: [{ $arrayElemAt: ['$categoryData.name', 0] }, 'General Menu'],
        },
      },
    },
    {
      $group: {
        _id: {
          name: '$items.name',
          variantName: { $ifNull: ['$items.variantName', 'Standard'] },
          category: '$resolvedCategory',
        },
        qtySold: { $sum: '$items.quantity' },
        menuItemCore: { $first: { $ifNull: [{ $arrayElemAt: ['$menuItemData.core', 0] }, null] } },
        revenue: {
          $sum: {
            $let: {
              vars: {
                lineTotal: {
                  $multiply: [
                    { $ifNull: ['$items.price', 0] },
                    { $ifNull: ['$items.quantity', 0] },
                  ],
                },
                taxRate: { $ifNull: ['$items.taxRate', 0] },
              },
              in: {
                $add: [
                  '$$lineTotal',
                  { $multiply: ['$$lineTotal', { $divide: ['$$taxRate', 100] }] },
                ],
              },
            },
          },
        },
      }
    }
  ];

  try {
    const itemsResult = await Order.aggregate(aggPipeline);
    console.log("Items Result:", itemsResult);
  } catch (err) {
    console.error("Aggregation Error:", err);
  }
  
  process.exit(0);
}
testDishSummary();
