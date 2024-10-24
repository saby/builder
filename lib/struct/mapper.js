/**
 * Модуль, предоставляющий вспомогательный класс для отображения строк в числовые идентификаторы.
 *
 * @author Krylov M.A.
 */
'use strict';

const Bimap = require('./bimap');

class Mapper {
   /**
    * Инициализировать новый инстанс.
    */
   constructor() {
      /**
       * Отображение пользовательских ключей в числовые идентификаторы для оптимизации работы.
       * @private
       * @type {Bimap<string, number>}
       */
      this._bimap = new Bimap();
   }

   /**
    * Отобразить строку в уникальный числовой идентификатор.
    * @param {string} value Строка.
    * @return {number} Уникальный числовой идентификатор, соответствующий строке.
    */
   encode(value) {
      if (!this._bimap.has(value)) {
         this._bimap.set(value, this._bimap.size);
      }

      return this._bimap.get(value);
   }

   /**
    * Отобразить уникальный числовой идентификатор в исходную строку.
    * @param {number} id Уникальный числовой идентификатор, соответствующий строке.
    * @return {string} Строка.
    */
   decode(id) {
      return this._bimap.iGet(id);
   }

   /**
    * Сериализовать состояние графа.
    * @returns {object}
    */
   toJSON() {
      return this._bimap;
   }
}

module.exports = Mapper;
