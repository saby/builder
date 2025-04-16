/**
 * Модуль предоставляет хранилище для PageX файлов.
 *
 * @author Krylov M.A.
 */
'use strict';

const { prepareModules } = require('./utils');

function toJson(registry) {
   return {
      files: Array
         .from(registry.files)
         .map(([file, set]) => ([file, Array.from(set)])),
      pages: Array
         .from(registry.pages),
      invalidPages: Array
         .from(registry.ambiguousPages)
   };
}

function fromJson(json) {
   return {
      files: new Map(
         json.files
            .map(([file, set]) => ([file, new Set(set)]))
      ),
      pages: new Map(
         json.pages
      ),
      invalidPages: new Map(
         json.invalidPages
      )
   };
}

class FilesRegistry {
   /**
    * Инициализировать новый инстанс хранилища.
    * @param {Object} cache Прошлое состояние хранилища.
    */
   constructor(cache = null) {
      this.cache = cache;

      this.files = new Map();
      this.pages = new Map();
      this.ambiguousPages = new Map();
      this.deletedPages = new Map();
   }

   /**
    * Получить количество хранящихся файлов в хранилище.
    */
   get size() {
      return this.files.size;
   }

   /**
    * Получить JSON представление хранилища.
    * @return {Object}
    */
   get json() {
      return toJson(this);
   }

   /**
    * Добавить PageX файл в хранилище.
    * @param {string} filePath Путь до файла.
    * @param {Object[]} pages Коллекция страниц, определенных в файле.
    */
   add(filePath, pages) {
      if (this.files.has(filePath)) {
         throw new Error(`Файл ${filePath} уже добавлен в хранилище`);
      }

      const filePages = new Set();

      for (const page of pages) {
         if (this.ambiguousPages.has(page.id)) {
            this.ambiguousPages.get(page.id).push(filePath);

            continue;
         }

         if (this.pages.has(page.id)) {
            this.ambiguousPages.set(page.id, [
               this.pages.get(page.id).filePath,
               filePath
            ]);

            filePages.delete(page.id);

            this.pages.delete(page.id);

            continue;
         }

         filePages.add(page.id);

         this.pages.set(page.id, {
            id: page.id,
            type: page.type,
            modules: prepareModules(page.modules),
            filePath
         });
      }

      this.checkDeletedPages(filePath, filePages);

      this.files.set(filePath, filePages);
   }

   /**
    * Выполнить итерацию над всеми страницами, имеющимися в хранилище.
    * @param {Function} callback Обработчик, принимающий аргументы: id - идентификатор страницы,
    * value - данные о странице ({ id, type, modules, filePath }).
    */
   forEach(callback) {
      this.pages.forEach((value, id) => callback(id, value));
   }

   /**
    * Удалить PageX файл из хранилища.
    * @param {string} filePath Путь до файла.
    */
   delete(filePath) {
      if (!this.files.has(filePath)) {
         return;
      }

      this.files.get(filePath).forEach((id) => {
         const deletedPage = this.pages.get(id);

         this.deletedPages.set(id, deletedPage);
         this.pages.delete(id);
      });

      this.files.delete(filePath);
   }

   /**
    * Получить список удаленных (неактуальных) страниц.
    * @return {string[]} Коллекция удаленных (неактуальных) страниц
    */
   getDeletedPages() {
      if (!this.cache) {
         return [];
      }

      const deletedPages = new Set(this.deletedPages.keys());

      this.ambiguousPages.forEach((id) => {
         if (this.cache.pages.has(id)) {
            deletedPages.add(id);
         }
      });

      return Array.from(deletedPages);
   }

   /**
    * Проверить множество на удаленные (неактуальные) страницы, которые ранее были определены в PageX файле.
    * @param {string} filePath Путь до файла.
    * @param {Set<string>} filePages Множество идентификаторов страниц.
    */
   checkDeletedPages(filePath, filePages) {
      if (!this.cache) {
         return;
      }

      if (!this.cache.files.has(filePath)) {
         return;
      }

      this.cache.files.get(filePath).forEach((id) => {
         if (filePages.has(id)) {
            return;
         }

         const deletedPage = this.cache.pages.get(id);

         this.deletedPages.set(id, deletedPage);
      });
   }

   /**
    * Создать новое хранилище.
    * @param {Object?} jsonCache JSON представление хранилища.
    * @return {FilesRegistry} Инстанс хранилища.
    */
   static create(jsonCache) {
      if (!jsonCache) {
         return new FilesRegistry();
      }

      return new FilesRegistry(fromJson(jsonCache));
   }
}

module.exports = FilesRegistry;
