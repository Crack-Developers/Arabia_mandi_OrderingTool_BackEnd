import Section from '../models/Section';

export const sectionService = {
  async getAll(branchId?: string) {
    const filter = branchId ? { branchId } : {};
    return Section.find(filter).sort({ name: 1 });
  },

  async create(data: any) {
    const section = new Section(data);
    return section.save();
  },

  async update(id: string, data: any) {
    const section = await Section.findByIdAndUpdate(id, data, { new: true, runValidators: true });
    if (!section) throw { statusCode: 404, message: 'Section not found.' };
    return section;
  },

  async delete(id: string) {
    const section = await Section.findByIdAndDelete(id);
    if (!section) throw { statusCode: 404, message: 'Section not found.' };
    return section;
  },
};
