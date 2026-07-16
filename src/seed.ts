import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { connectDB } from './config/db';
import Branch from './models/Branch';
import Staff from './models/Staff';
import Section from './models/Section';
import Table from './models/Table';
import Category from './models/Category';
import MenuItem from './models/MenuItem';

const seed = async () => {
  await connectDB();

  // Clear only default demo data so user-created branches and tables are preserved
  const defaultCodes = ['BR-JUBILEE', 'BR-BANJARA', 'BR-GACHIBOWLI'];
  const defaultBranches = await Branch.find({ branchCode: { $in: defaultCodes } });
  const defaultBranchIds = defaultBranches.map(b => b._id);

  await Branch.deleteMany({ branchCode: { $in: defaultCodes } });
  await Staff.deleteMany({ username: { $in: ['admin', 'tariq.pos', 'ramesh.cashier', 'john.manager'] } });
  await Section.deleteMany({ branchId: { $in: defaultBranchIds } });
  await Table.deleteMany({ branchId: { $in: defaultBranchIds } });
  await Category.deleteMany({});
  await MenuItem.deleteMany({});

  console.log('🗑️  Cleared default demo data (preserved user created branches).');

  // ── Branches ──
  const branches = await Branch.insertMany([
    {
      branchCode: 'BR-JUBILEE',
      name: 'Arabian Mandi – Jubilee Hills Flagship',
      address: 'Road No. 36, Jubilee Hills, Hyderabad',
      phone: '+91 40 2355 8890',
      gst: '36AABCA1234F1Z5',
      taxes: { cgst: 2.5, sgst: 2.5, serviceCharge: 0 },
      receiptSettings: {
        invoicePrefix: 'INV-', headerText: 'Welcome to Arabian Mandhi!',
        footerText: 'Thank you for visiting! Please come again.',
        printLogo: false, autoPrintOnCheckout: true, useThermalFormat: true, paperWidth: '80mm',
      },
      timings: '12:00 PM – 11:30 PM', status: 'Active',
      managerName: 'Mohd Zaid Khan', managerId: 'MGR-2026-101',
    },
    {
      branchCode: 'BR-BANJARA',
      name: 'Arabian Mandi – Banjara Hills',
      address: 'Road No. 12, Banjara Hills, Hyderabad',
      phone: '+91 40 2344 7721',
      gst: '36AABCA1234F2Z4',
      taxes: { cgst: 2.5, sgst: 2.5, serviceCharge: 0 },
      receiptSettings: {
        invoicePrefix: 'INV-', headerText: 'Welcome to Arabian Mandhi!',
        footerText: 'Thank you for visiting! Please come again.',
        printLogo: false, autoPrintOnCheckout: true, useThermalFormat: true, paperWidth: '80mm',
      },
      timings: '12:00 PM – 11:30 PM', status: 'Active',
      managerName: 'Imran Qureshi', managerId: 'MGR-2026-102',
    },
    {
      branchCode: 'BR-GACHIBOWLI',
      name: 'Arabian Mandi – Gachibowli IT Hub',
      address: 'DLF Cyber City Road, Gachibowli',
      phone: '+91 40 2998 3311',
      gst: '36AABCA1234F3Z3',
      taxes: { cgst: 2.5, sgst: 2.5, serviceCharge: 0 },
      receiptSettings: {
        invoicePrefix: 'INV-', headerText: 'Welcome to Arabian Mandhi!',
        footerText: 'Thank you for visiting! Please come again.',
        printLogo: false, autoPrintOnCheckout: true, useThermalFormat: true, paperWidth: '80mm',
      },
      timings: '11:30 AM – 12:00 AM', status: 'Active',
      managerName: 'Hamza Al-Khatib', managerId: 'MGR-2026-103',
    },
  ]);
  console.log(`✅ ${branches.length} branches seeded.`);

  // ── Staff ──
  const staffData = [
    {
      employeeCode: 'EMP-001', name: 'Admin User', email: 'admin@arabianmandi.com',
      phone: '+91 98765 43210', role: 'Super Admin', branchId: branches[0]._id,
      active: true, designation: 'Chain Owner & Super Admin',
      username: 'admin', password: await bcrypt.hash('Password@123', 12),
      branchAccess: 'All Branches',
    },
    {
      employeeCode: 'EMP-102', name: 'Mohammed Tariq', email: 'tariq.reception@arabianmandi.com',
      phone: '+91 98765 11111', role: 'Receptionist', branchId: branches[0]._id,
      active: true, designation: 'Front Desk Receptionist (POS)',
      username: 'tariq.pos', password: await bcrypt.hash('POS#Tariq2026', 12),
      branchAccess: 'Arabian Mandi – Jubilee Hills Flagship',
    },
    {
      employeeCode: 'EMP-103', name: 'Ramesh', email: 'ramesh.cashier@arabianmandi.com',
      phone: '+91 98765 22222', role: 'Cashier', branchId: branches[1]._id,
      active: true, designation: 'Lead Billing Cashier',
      username: 'ramesh.cashier', password: await bcrypt.hash('Mandi#Ramesh99', 12),
      branchAccess: 'Arabian Mandi – Banjara Hills',
    },
    {
      employeeCode: 'EMP-104', name: 'John Doe', email: 'johndoe@arabianmandi.com',
      phone: '+91 98765 33333', role: 'Manager', branchId: branches[0]._id,
      active: true, designation: 'Branch Executive Manager',
      username: 'john.manager', password: await bcrypt.hash('Jubilee@2026', 12),
      branchAccess: 'Arabian Mandi – Jubilee Hills Flagship',
    },
  ];
  const staff = await Staff.insertMany(staffData);
  console.log(`✅ ${staff.length} staff members seeded.`);

  // ── Sections ──
  const sections = await Section.insertMany([
    { branchId: branches[0]._id, name: 'Majlis VIP Dining', printerId: 'ptr-majlis' },
    { branchId: branches[0]._id, name: 'Family Dining Hall', printerId: 'ptr-kitchen-main' },
    { branchId: branches[0]._id, name: 'Courtyard & Cafe', printerId: 'ptr-cafe' },
  ]);
  console.log(`✅ ${sections.length} sections seeded.`);

  // ── Tables ──
  const tables = await Table.insertMany([
    { branchId: branches[0]._id, sectionId: sections[0]._id, tableNumber: 'M-1', capacity: 6, status: 'Available' },
    { branchId: branches[0]._id, sectionId: sections[0]._id, tableNumber: 'M-2 (Royal Majlis)', capacity: 8, status: 'Available' },
    { branchId: branches[0]._id, sectionId: sections[0]._id, tableNumber: 'M-3', capacity: 6, status: 'Available' },
    { branchId: branches[0]._id, sectionId: sections[0]._id, tableNumber: 'M-4', capacity: 6, status: 'Available' },
    { branchId: branches[0]._id, sectionId: sections[1]._id, tableNumber: 'T-10', capacity: 4, status: 'Available' },
    { branchId: branches[0]._id, sectionId: sections[1]._id, tableNumber: 'T-11', capacity: 4, status: 'Available' },
    { branchId: branches[0]._id, sectionId: sections[1]._id, tableNumber: 'T-12', capacity: 4, status: 'Available' },
    { branchId: branches[0]._id, sectionId: sections[1]._id, tableNumber: 'T-13', capacity: 6, status: 'Available' },
    { branchId: branches[0]._id, sectionId: sections[2]._id, tableNumber: 'C-01', capacity: 2, status: 'Available' },
    { branchId: branches[0]._id, sectionId: sections[2]._id, tableNumber: 'C-02', capacity: 2, status: 'Available' },
  ]);
  console.log(`✅ ${tables.length} tables seeded.`);

  // ── Categories ──
  const categories = await Category.insertMany([
    { name: 'Starters', displayOrder: 1, active: true },
    { name: 'Main Course', displayOrder: 2, active: true },
    { name: 'Desserts', displayOrder: 3, active: true },
    { name: 'Beverages', displayOrder: 4, active: true },
    { name: 'Sides', displayOrder: 5, active: true },
  ]);
  console.log(`✅ ${categories.length} categories seeded.`);

  // ── Menu Items ──
  const menuItems = await MenuItem.insertMany([
    {
      categoryId: categories[1]._id, name: 'Arabian Chicken Faham Mandi', // Main Course
      description: 'Charcoal grilled marinated whole chicken served over saffron aromatic Mandi rice with shattah sauce',
      available: true, active: true, badge: 'Bestseller',
      variants: [{ name: 'Half (2 Persons)', price: 620 }, { name: 'Full (4 Persons)', price: 1150 }, { name: 'Royal Family Platter (6 Persons)', price: 1750 }],
      addons: [{ name: 'Extra Mandi Rice', price: 160 }, { name: 'Extra Boiled Egg (2 Pcs)', price: 50 }, { name: 'Shattah Spicy Tomato Sauce', price: 40 }],
    },
    {
      categoryId: categories[1]._id, name: 'Mutton Juicy Shank Mandi', // Main Course
      description: 'Slow-cooked fall-off-the-bone tender lamb shanks spiced with traditional Yemeni hawaij',
      available: true, active: true, badge: 'Chef Special',
      variants: [{ name: 'Half (1 Shank - 2 Persons)', price: 780 }, { name: 'Full (2 Shanks - 4 Persons)', price: 1480 }, { name: 'Grand Majlis Feast (4 Shanks)', price: 2750 }],
      addons: [{ name: 'Extra Fried Onions & Nuts', price: 90 }, { name: 'Extra Mandi Rice', price: 160 }],
    },
    {
      categoryId: categories[1]._id, name: 'Mixed Arabian Seafood Mandi', // Main Course
      description: 'Grilled Kingfish and Jumbo Prawns cooked over charcoal with smoky spiced Mandi rice',
      available: true, active: true,
      variants: [{ name: 'Half (2 Persons)', price: 890 }, { name: 'Full (4 Persons)', price: 1650 }],
      addons: [{ name: 'Garlic Toum Dip', price: 60 }],
    },
    {
      categoryId: categories[0]._id, name: 'Charcoal Mutton Seekh Kebab Platter', // Starters
      description: 'Minced lamb spiced with Arabian herbs skewered over open charcoal fire',
      available: true, active: true,
      variants: [{ name: 'Regular (4 Skewers)', price: 440 }, { name: 'Large Platter (8 Skewers)', price: 820 }],
      addons: [],
    },
    {
      categoryId: categories[0]._id, name: 'Traditional Yemeni Mutton Marag Soup', // Starters
      description: 'Rich spiced mutton broth simmered for 6 hours with black pepper and cardamom',
      available: true, active: true,
      variants: [{ name: 'Regular Bowl', price: 180 }], addons: [],
    },
    {
      categoryId: categories[0]._id, name: 'Crispy Falafel with Hummus & Pita', // Starters
      description: 'Fresh chickpea falafels served with smooth olive oil hummus and warm Arabic bread',
      available: true, active: true,
      variants: [{ name: 'Plate (6 Pcs)', price: 260 }],
      addons: [{ name: 'Extra Warm Pita Bread (2 Pcs)', price: 50 }],
    },
    {
      categoryId: categories[2]._id, name: 'Authentic Nablus Cheese Kunafa', // Desserts
      description: 'Warm spun pastry layered with stretchy sweet Nabulsi cheese and pistachios',
      available: true, active: true, badge: 'Must Try',
      variants: [{ name: 'Single Slice', price: 240 }, { name: 'Sharing Pan (3-4 Persons)', price: 680 }],
      addons: [{ name: 'Extra Pistachio & Rose Syrup', price: 60 }],
    },
    {
      categoryId: categories[3]._id, name: 'Mint Spiced Sulaimani Tea', // Beverages
      description: 'Traditional Arabian black tea infused with cardamom, saffron, and fresh mint leaves',
      available: true, active: true,
      variants: [{ name: 'Cup', price: 80 }, { name: 'Traditional Dallah Pot (4 Cups)', price: 280 }],
      addons: [],
    },
  ]);
  console.log(`✅ ${menuItems.length} menu items seeded.`);

  console.log('\n🎉 Database seeded successfully!\n');
  console.log('Login credentials:');
  console.log('  Admin:        username=admin        password=Password@123');
  console.log('  Receptionist: username=tariq.pos     password=POS#Tariq2026');
  console.log('  Cashier:      username=ramesh.cashier password=Mandi#Ramesh99');
  console.log('  Manager:      username=john.manager  password=Jubilee@2026\n');

  await mongoose.disconnect();
  process.exit(0);
};

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
