import mongoose from 'mongoose';
import Category from '../models/Category';
import MenuItem from '../models/MenuItem';

export const menuService = {
  // ── Categories ──
  async getAllCategories() {
    const count = await Category.countDocuments();
    if (count === 0) {
      await Category.insertMany([
        { name: 'Mandi Meat Platters', displayOrder: 1, active: true },
        { name: 'Arabian Starters & Grills', displayOrder: 2, active: true },
        { name: 'Kunafa & Desserts', displayOrder: 3, active: true },
        { name: 'Beverages & Mocktails', displayOrder: 4, active: true },
      ]);
    }
    return Category.find().sort({ displayOrder: 1 });
  },

  async createCategory(data: any) {
    const category = new Category(data);
    return category.save();
  },

  async updateCategory(id: string, data: any) {
    const category = await Category.findByIdAndUpdate(id, data, { new: true, runValidators: true });
    if (!category) throw { statusCode: 404, message: 'Category not found.' };
    return category;
  },

  async deleteCategory(id: string) {
    const category = await Category.findByIdAndDelete(id);
    if (!category) throw { statusCode: 404, message: 'Category not found.' };
    return category;
  },

  // ── Menu Items ──
  async getAllMenuItems(categoryId?: string) {
    const filter = categoryId ? { categoryId } : {};
    return MenuItem.find(filter).sort({ name: 1 });
  },

  async getMenuItemById(id: string) {
    const item = await MenuItem.findById(id);
    if (!item) throw { statusCode: 404, message: 'Menu item not found.' };
    return item;
  },

  async createMenuItem(data: any) {
    let categoryId = data.categoryId;
    if (!categoryId || !mongoose.Types.ObjectId.isValid(String(categoryId))) {
      let cat = await Category.findOne();
      if (!cat) {
        cat = await Category.create({ name: 'Mandi Meat Platters', displayOrder: 1, active: true });
      }
      categoryId = cat._id;
    }
    const item = new MenuItem({ ...data, categoryId });
    return item.save();
  },

  async updateMenuItem(id: string, data: any) {
    const item = await MenuItem.findByIdAndUpdate(id, data, { new: true, runValidators: true });
    if (!item) throw { statusCode: 404, message: 'Menu item not found.' };
    return item;
  },

  async deleteMenuItem(id: string) {
    const item = await MenuItem.findByIdAndDelete(id);
    if (!item) throw { statusCode: 404, message: 'Menu item not found.' };
    return item;
  },

  async toggleAvailability(id: string) {
    const item = await MenuItem.findById(id);
    if (!item) throw { statusCode: 404, message: 'Menu item not found.' };

    item.available = !item.available;
    return item.save();
  },
};
