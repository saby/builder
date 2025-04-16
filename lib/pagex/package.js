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

class Package {
   constructor() {
      this.i18n = new Set();
      this.css = new Set();
      this.js = new Set();
   }

   add(moduleName) {
      if (moduleName.startsWith('i18n!')) {
         return this.i18n.add(moduleName);
      }

      if (moduleName.startsWith('css!')) {
         return this.css.add(moduleName);
      }

      return this.js.add(moduleName);
   }

   has(moduleName) {
      return (
         this.i18n.has(moduleName) ||
         this.css.has(moduleName) ||
         this.js.has(moduleName)
      );
   }

   toJSON() {
      return {
         i18n: Array.from(this.i18n).sort(stringSorter),
         css: Array.from(this.css).sort(stringSorter),
         js: Array.from(this.js).sort(stringSorter)
      };
   }
}

module.exports = Package;
