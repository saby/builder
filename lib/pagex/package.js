/**
 * Модуль предоставляет класс для работы с пакетом.
 *
 * @author Krylov M.A.
 */
'use strict';

function stringSorter(a, b) {
   if (a < b) {
      return -1;
   }

   if (a > b) {
      return 1;
   }

   return 0;
}

function toSortedArray(iterable) {
   return Array.from(iterable).sort(stringSorter);
}

class Package {
   constructor() {
      this.locales = new Set();
      this.styles = new Set();
      this.scripts = new Set();
   }

   add(moduleName) {
      if (moduleName.startsWith('i18n!')) {
         return this.locales.add(moduleName);
      }

      if (moduleName.startsWith('css!')) {
         return this.styles.add(moduleName);
      }

      return this.scripts.add(moduleName);
   }

   has(moduleName) {
      return (
         this.locales.has(moduleName) ||
         this.styles.has(moduleName) ||
         this.scripts.has(moduleName)
      );
   }

   toJSON() {
      return {
         locales: toSortedArray(this.locales),
         styles: toSortedArray(this.styles),
         scripts: toSortedArray(this.scripts)
      };
   }

   static createWithModules(iterable) {
      const pkg = new Package();

      for (const moduleName of iterable) {
         pkg.add(moduleName);
      }

      return pkg;
   }
}

module.exports = Package;
