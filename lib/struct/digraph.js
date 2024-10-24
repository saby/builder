/* eslint-disable max-classes-per-file */
/**
 * Модуль, предоставляющий структуру графа и методы для работы с ним.
 *
 * @author Krylov M.A.
 */
'use strict';

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

/**
 * Вспомогательный класс, реализующий методы для работы с кешем посещенных узлов графа.
 */
class TraversedCache {
   /**
    * Инициализировать новый инстанс.
    */
   constructor() {
      /**
       * Глобальный кеш посешенных вершин (кеш графа).
       * @type {Map<number, boolean>}
       */
      this.global = new Map();

      /**
       * Локальный кеш посещенных вершин (кеш текущей обрабатываемой вершины).
       * @type {Map<number, boolean>}
       */
      this.local = new Map();
   }

   /**
    * Пометить посещенную вершину графа.
    * @param {number} vertex Идентификатор вершины графа.
    */
   mark(vertex) {
      this.local.set(vertex, true);
   }

   /**
    * Проверить, является ли вершина посещенной.
    * @param {number} vertex Идентификатор вершины графа.
    * @returns {boolean} Возвращает true, если вершина уже была ранее обработана.
    */
   isMarked(vertex) {
      return (
         this.global.get(vertex) === true ||
         this.local.get(vertex) === true
      );
   }

   /**
    * Снять пометку посещенной вершины графа.
    * @param {number} vertex Идентификатор вершины графа.
    */
   unmark(vertex) {
      this.local.set(vertex, false);
   }

   /**
    * Записать все временные пометки в глобальный кеш.
    */
   flush() {
      this.local.forEach((_v, k) => this.global.set(k, true));
      this.local.clear();
   }
}

class Digraph {
   /**
    * Инициализировать новый инстанс графа.
    */
   constructor(mapper) {
      /**
       * Набор всех вершин графа, представленных как отображение вида "узел -> коллекция дочерних узлов".
       * @private
       * @type {Map<number, number[]>}
       */
      this._nodes = new Map();

      /**
       * Отображение пользовательских ключей в числовые идентификаторы для оптимизации работы.
       * @private
       * @type {Mapper}
       */
      this._mapper = mapper;
   }

   /**
    * Добавить новый узел и его связи с другими узлами.
    * @param {string} vertex Добавляемый узел.
    * @param {string[]} children Коллекция узлов, на которые ссылается добавляемый узел.
    * @throws {Error} Выбрасывает исключение, добавляемый узел уже существует.
    */
   put(vertex, children) {
      const vertexId = this._mapper.encode(vertex);

      if (this._nodes.has(vertexId)) {
         throw Object.assign(
            new Error(`Cannot put vertex: "${vertex}" is already in graph`),
            { vertex }
         );
      }

      this._nodes.set(vertexId, Object.freeze(children.map(this._mapper.encode.bind(this._mapper))));
   }

   /**
    * Модифицировать коллекцию узлов, на которые ссылается данный узел графа.
    * @param {string} vertex Существующий узел.
    * @param {string[]} children Новая коллекция узлов, на которые ссылается добавляемый узел.
    * @throws {Error} Выбрасывает исключение, модифицируемый узел не существует.
    */
   modify(vertex, children) {
      const vertexId = this._mapper.encode(vertex);

      if (!this._nodes.has(vertexId)) {
         throw Object.assign(
            new Error(`Cannot modify vertex: "${vertex}" is not in graph`),
            { vertex }
         );
      }

      this._nodes.set(vertexId, Object.freeze(children.map(this._mapper.encode.bind(this._mapper))));
   }

   /**
    * Получить коллекцию узлов, на которые ссылается данный узел.
    * @param {string} vertex Узел графа.
    * @returns {string[] | null} Возвращает коллекцию узлов, на которые ссылается данный узел,
    * либо null, если данный узел не содержится в графе.
    */
   get(vertex) {
      const vertexId = this._mapper.encode(vertex);

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
      const result = new Set();
      const cache = new TraversedCache();
      const vertexId = this._mapper.encode(vertex);

      if (this._nodes.has(vertexId)) {
         this._traverse(vertexId, [], cache, cVertex => result.add(cVertex));
      }

      return Array.from(result);
   }

   /**
    * Проверить, существует ли данный узел в графе.
    * @param {string} vertex Узел графа.
    * @returns {boolean} Возвращает true, если узел существует в графе.
    */
   has(vertex) {
      const vertexId = this._mapper.encode(vertex);

      return this._nodes.has(vertexId);
   }

   /**
    * Удалить узел из графа.
    * @param {string} vertex Узел графа.
    * @returns {boolean} Возвращает true, если узел был удален из графа.
    */
   delete(vertex) {
      const vertexId = this._mapper.encode(vertex);

      if (this._nodes.has(vertexId)) {
         this._nodes.delete(vertexId);

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

         const name = this._mapper.decode(child);

         if (!lostVertexes.has(name)) {
            lostVertexes.set(name, []);
         }

         lostVertexes.get(name).push(this._mapper.decode(vertex));
      }));

      return Array.from(lostVertexes);
   }

   /**
    * Проверяет наличие циклических зависимостей.
    * @param {Function} onCycle Обработчик циклических зависимостей.
    */
   testCycles(onCycle) {
      const cycles = [];
      const cache = new TraversedCache();

      this._nodes.forEach((_children, vertex) => {
         if (cache.isMarked(vertex)) {
            return;
         }

         this._traverse(vertex, [], cache, undefined, (cyclePath) => {
            if (!includesCyclePath(cycles, cyclePath)) {
               cycles.push(cyclePath);

               onCycle(this._translateVertexes(cyclePath));
            }
         });

         cache.flush();
      });
   }

   /**
    * Сериализовать состояние графа.
    * @returns {object}
    */
   toJSON() {
      return {
         class: 'Digraph',
         state: {
            nodes: Array.from(this._nodes),
            mapper: Array.from(this._mapper)
         }
      };
   }

   /**
    * Выполнить обход в глубину.
    * @param {number} vertex Узел графа, для которого выполняется обход в глубину.
    * @param {number[]} stack Текущий стек просматриваемых узлов графа.
    * @param {TraversedCache} cache Коллекция посещенных узлов.
    * @param {Function?} onEnter Обработчик узлов.
    * @param {Function?} onCycle Обработчик циклических зависимостей.
    * @private
    */
   _traverse(vertex, stack, cache, onEnter, onCycle) {
      if (!this._nodes.has(vertex)) {
         const vertexStr = this._mapper.decode(vertex);

         throw Object.assign(
            new Error(`Cannot find vertex: "${vertexStr}" does not exist in graph`),
            {
               vertex: vertexStr
            }
         );
      }

      if (stack.includes(vertex)) {
         this._onCycleErrorHandler(vertex, stack, cache, onCycle);

         return;
      }

      if (cache.isMarked(vertex)) {
         return;
      }

      cache.mark(vertex);

      this._nodes.get(vertex).forEach((cVertex) => {
         if (typeof onEnter === 'function') {
            onEnter(this._mapper.decode(cVertex), cVertex, stack);
         }

         this._traverse(cVertex, [...stack, vertex], cache, onEnter, onCycle);
      });
   }

   /**
    * Отобразить коллекцию идентификаторов узлов графа в их текстовые имена.
    * @param {number[]} vertexes Коллекция идентификаторов узлов графа.
    * @return {string[]} Коллекция имен узлов графа.
    * @private
    */
   _translateVertexes(vertexes) {
      return vertexes.map(this._mapper.decode.bind(this._mapper));
   }

   /**
    * Обработчик циклических зависимостей.
    * @param {number} vertex Узел графа, для которого выполняется обход в глубину.
    * @param {number[]} stack Текущий стек просматриваемых узлов графа.
    * @param {TraversedCache} cache Коллекция посещенных узлов.
    * @param {Function?} onCycle Обработчик циклических зависимостей.
    * @private
    */
   _onCycleErrorHandler(vertex, stack, cache, onCycle) {
      const cyclePath = stack.slice(stack.indexOf(vertex));

      stack.forEach(v => cache.unmark(v));

      if (typeof onCycle === 'function') {
         onCycle(cyclePath);

         return;
      }

      const cyclePathStr = this._translateVertexes(cyclePath);

      throw Object.assign(
         new Error(`Cannot access node due to cycle: ${[...cyclePathStr, cyclePathStr[0]].join(' -> ')}`),
         {
            vertex: this._mapper.decode(vertex),
            cyclePath: cyclePathStr
         }
      );
   }
}

module.exports = Digraph;
