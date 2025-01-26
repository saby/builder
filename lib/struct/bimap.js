/**
 * Модуль, предоставляющий двунаправленный словарь.
 *
 * @author Krylov M.A.
 */
'use strict';

class Bimap {
   constructor(iterable) {
      this._map = new Map();
      this._iMap = new Map();

      if (iterable) {
         for (const [key, value] of iterable) {
            this._map.set(key, value);
            this._iMap.set(value, key);
         }
      }
   }

   get size() {
      return this._map.size;
   }

   set(key, value) {
      this._map.set(key, value);
      this._iMap.set(value, key);
   }

   get(key) {
      return this._map.get(key);
   }

   has(key) {
      return this._map.has(key);
   }

   delete(key) {
      if (!this._map.has(key)) {
         return false;
      }

      this._iMap.delete(this._map.get(key));

      return this._map.delete(key);
   }

   iGet(value) {
      return this._iMap.get(value);
   }

   iHas(value) {
      return this._iMap.has(value);
   }

   iDelete(value) {
      if (!this._iMap.has(value)) {
         return false;
      }

      this._map.delete(this._iMap.get(value));

      return this._iMap.delete(value);
   }

   entries() {
      this._map.entries();
   }

   forEach(callbackFn, thisArg) {
      return this._map.forEach(callbackFn, thisArg);
   }

   keys() {
      return this._map.keys();
   }

   values() {
      return this._map.values();
   }

   clear() {
      this._map.clear();
      this._iMap.clear();
   }

   [Symbol.iterator]() {
      return this._map[Symbol.iterator]();
   }
}

module.exports = Bimap;
