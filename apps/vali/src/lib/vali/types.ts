export interface Category {
  id: string;
  name: string;
  order: number;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCategoryInput {
  name: string;
}

export interface CategoryPatch {
  name?: string;
  order?: number;
  content?: string;
}

export interface Entry {
  id: string;
  title: string;
  aliases: string[];
  categoryId: string;
  order: number;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEntryInput {
  title: string;
  aliases?: string[];
  categoryId: string;
  content?: string;
}

export interface EntryPatch {
  title?: string;
  aliases?: string[];
  categoryId?: string;
  order?: number;
  content?: string;
}

export interface ImportResult {
  created: string[];
  skipped: string[];
}

export interface SearchResult {
  id: string;
  title: string;
  aliases: string[];
  categoryId: string;
  categoryName: string;
  updatedAt: string;
  rank: number;
}

export interface Reflection {
  date: string;
  content: string;
}

export interface ValiVault {
  categories: {
    list(): Category[];
    create(input: CreateCategoryInput): Category;
    update(id: string, patch: CategoryPatch): Category;
    delete(id: string): void;
  };
  entries: {
    list(categoryId?: string): Entry[];
    get(id: string): Entry;
    create(input: CreateEntryInput): Entry;
    update(id: string, patch: EntryPatch): Entry;
    delete(id: string): void;
    importTitles(categoryId: string, items: string[]): ImportResult;
    search(query: string): SearchResult[];
  };
  reflections: {
    listDates(): string[];
    get(date: string): Reflection;
    save(date: string, content: string): Reflection;
  };
}
