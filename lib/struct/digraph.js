/**
 * @author Krylov M.A.
 */
'use strict';

const Bimap = require('./bimap');

/**
 * Проверить, существует ли циклический путь, представляемый как кольцо, уже в массиве.
 * @param {Array<number[]>} array Коллекция циклических путей.
 * @param {number[]} cyclePath Проверяемый циклический путь.
 * @returns {boolean} Возвращает true, если циклический путь уже находится в массиве.
 */
function includesCyclePath(array, cyclePath) {
   for (const currentPath of array) {
      if (currentPath.length !== cyclePath.length) {
         continue;
      }

      for (let shift = 0; shift < currentPath.length; shift++) {
         if (cyclePath.every((element, index) => element === currentPath[(index + shift) % currentPath.length])) {
            return true;
         }
      }
   }

   return false;
}

class Digraph {
   /**
    * Инициализировать новый инстанс графа.
    */
   constructor() {
      /**
       * Набор всех вершин графа, представленных как отображение вида "узел -> коллекция дочерних узлов".
       * @private
       * @type {Map<number, number[]>}
       */
      this._nodes = new Map();

      /**
       * Кеш достижимых вершин графа, представленных как отображение вида "узел -> множество достижимых вершин"
       * @private
       * @type {Map<number, number[]>}
       */
      this._paths = new Map();

      /**
       * Отображение пользовательских ключей в числовые идентификаторы для оптимизации работы.
       * @private
       * @type {Bimap<string, number>}
       */
      this._mapper = new Bimap();
   }

   /**
    * Добавить новый узел и его связи с другими узлами.
    * @param {string} vertex Добавляемый узел.
    * @param {string[]} children Коллекция узлов, на которые ссылается добавляемый узел.
    * @throws {Error} Выбрасывает исключение, добавляемый узел уже существует.
    */
   put(vertex, children) {
      this._paths.clear();

      const vertexId = this._getVertexId(vertex);

      if (this._nodes.has(vertexId)) {
         throw Object.assign(
            new Error(`Cannot put vertex: "${vertex}" is already in graph`),
            { vertex }
         );
      }

      this._nodes.set(vertexId, Object.freeze(children.map(this._getVertexId.bind(this))));
   }

   /**
    * Модифицировать коллекцию узлов, на которые ссылается данный узел графа.
    * @param {string} vertex Существующий узел.
    * @param {string[]} children Новая коллекция узлов, на которые ссылается добавляемый узел.
    * @throws {Error} Выбрасывает исключение, модифицируемый узел не существует.
    */
   modify(vertex, children) {
      this._paths.clear();

      const vertexId = this._getVertexId(vertex);

      if (!this._nodes.has(vertexId)) {
         throw Object.assign(
            new Error(`Cannot modify vertex: "${vertex}" is not in graph`),
            { vertex }
         );
      }

      this._nodes.set(vertexId, Object.freeze(children.map(this._getVertexId.bind(this))));
   }

   /**
    * Получить коллекцию узлов, на которые ссылается данный узел.
    * @param {string} vertex Узел графа.
    * @returns {string[] | null} Возвращает коллекцию узлов, на которые ссылается данный узел,
    * либо null, если данный узел не содержится в графе.
    */
   get(vertex) {
      if (!this._mapper.has(vertex)) {
         return null;
      }

      const vertexId = this._getVertexId(vertex);

      if (this._nodes.has(vertexId)) {
         return this._translateVertexes(this._nodes.get(vertexId));
      }

      return null;
   }

   /**
    * Получить коллекцию всех достижимых узлов из данного узла.
    * @param {string} vertex Узел графа.
    * @throws {Error} Выбрасывает исключение, когда при обходе графа один из узлов не удалось найти,
    * либо при обходе графа обнаружен цикл.
    * @returns {string[] | null} Возвращает коллекцию всех достижимых узлов.
    */
   getDeep(vertex) {
      if (!this._mapper.has(vertex)) {
         return null;
      }

      const vertexId = this._getVertexId(vertex);

      return this._translateVertexes(this._getDeep(vertexId, []));
   }

   /**
    * Проверить, существует ли данный узел в графе.
    * @param {string} vertex Узел графа.
    * @returns {boolean} Возвращает true, если узел существует в графе.
    */
   has(vertex) {
      if (!this._mapper.has(vertex)) {
         return false;
      }

      const vertexId = this._getVertexId(vertex);

      return this._nodes.has(vertexId);
   }

   /**
    * Удалить узел из графа.
    * @param {string} vertex Узел графа.
    * @returns {boolean} Возвращает true, если узел был удален из графа.
    */
   delete(vertex) {
      if (!this._mapper.has(vertex)) {
         return false;
      }

      const vertexId = this._getVertexId(vertex);

      if (this._nodes.has(vertexId)) {
         this._nodes.delete(vertexId);
         this._paths.clear();

         return true;
      }

      return false;
   }

   /**
    * Проверяет достижимость всех вершин.
    * <pre>
    *     Поскольку метод put позволяет добавлять узлы со ссылками на потенциально несуществующие узлы,
    *     то необходима проверка, что все узлы графа были определены и граф в целом определен корректно.
    * </pre>
    * @returns {Array<[string, string[]]>} Возвращает массив вершин, которые не были определены в графе.
    */
   testLostVertexes() {
      const lostVertexes = new Map();

      this._nodes.forEach((children, vertex) => children.forEach((child) => {
         if (this._nodes.has(child)) {
            return;
         }

         const name = this._mapper.iGet(child);

         if (!lostVertexes.has(name)) {
            lostVertexes.set(name, []);
         }

         lostVertexes.get(name).push(this._mapper.iGet(vertex));
      }));

      return Array.from(lostVertexes);
   }

   /**
    * Проверяет наличие циклических зависимостей.
    * @returns {Array<string[]>} Возвращает коллекцию всех существующих путей циклических зависимостей.
    */
   testCycles() {
      const cycles = [];

      this._nodes.forEach((_children, vertex) => {
         this._getDeep(vertex, [], (cyclePath) => {
            if (!includesCyclePath(cycles, cyclePath)) {
               cycles.push(cyclePath);
            }
         });
      });

      return cycles.map(this._translateVertexes.bind(this));
   }

   /**
    * Выполнить сбор всех дочерних узлов графа.
    * @param {number} vertex Узел графа.
    * @param {number[]} stack Стек узлов, которые находятся в обработке.
    * @param {Function?} onCycle Функция-обработчик циклов графа.
    * @throws {Error} Выбрасывает исключение, когда при обходе графа один из узлов не удалось найти,
    * либо, если не задана функция-обработчик, при обходе графа обнаружен цикл.
    * @returns {number[]} Возвращает коллекцию всех достижимых узлов.
    * @private
    */
   _getDeep(vertex, stack, onCycle) {
      if (stack.includes(vertex)) {
         const cyclePath = [...stack.slice(stack.indexOf(vertex)), vertex];

         this._paths.clear();

         if (typeof onCycle === 'function') {
            onCycle(cyclePath);

            return [];
         }

         const cyclePathStr = this._translateVertexes(cyclePath);

         throw Object.assign(
            new Error(`Cannot access node due to cycle: ${cyclePathStr.join(' -> ')}`),
            {
               vertex: this._mapper.iGet(vertex),
               cyclePath: cyclePathStr
            }
         );
      }

      if (this._paths.has(vertex)) {
         return this._paths.get(vertex);
      }

      if (!this._nodes.has(vertex)) {
         const vertexStr = this._mapper.iGet(vertex);

         throw Object.assign(
            new Error(`Cannot find vertex: "${vertexStr}" does not exist in graph`),
            {
               vertex: vertexStr
            }
         );
      }

      const vertexes = [];

      this._nodes.get(vertex)
         .forEach(child => vertexes.push(...this._getDeep(child, [...stack, vertex], onCycle), child));

      const uniqueVertexes = Array.from(new Set(vertexes));

      this._paths.set(vertex, uniqueVertexes);

      return uniqueVertexes;
   }

   /**
    * Получить уникальный идентификатор узла графа по его текстовому имени.
    * @param {string} vertex Узел графа.
    * @return {number} Уникальный идентификатор узла в графе.
    * @private
    */
   _getVertexId(vertex) {
      if (!this._mapper.has(vertex)) {
         this._mapper.set(vertex, this._mapper.size);
      }

      return this._mapper.get(vertex);
   }

   /**
    * Отобразить коллекцию идентификаторов узлов графа в их текстовые имена.
    * @param {number[]} vertexes Коллекция идентификаторов узлов графа.
    * @return {string[]} Коллекция имен узлов графа.
    * @private
    */
   _translateVertexes(vertexes) {
      return vertexes.map(this._mapper.iGet.bind(this._mapper));
   }
}

module.exports = Digraph;
