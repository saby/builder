/* eslint-disable max-classes-per-file,consistent-return */
/**
 * Модуль, предоставляющий функционал для удаления повторяющихся css-классов из одного файла по снимку эталона.
 * @author Krylov M.A.
 */
'use strict';

const { parse, walk, generate } = require('css-tree');

/**
 * Удалить из структуры пустые узлы.
 * @param {Object} snapshot Древовидная структура css-классов.
 * @returns {Object|undefined} Очищенная структура.
 */
function removeEmpty(snapshot) {
   for (const atrule in snapshot) {
      if (snapshot.hasOwnProperty(atrule)) {
         if (snapshot[atrule] === null) {
            continue;
         }
         if (typeof snapshot[atrule] === 'string') {
            continue;
         }
         if (!removeEmpty(snapshot[atrule])) {
            delete snapshot[atrule];
         }
      }
   }

   return Object.keys(snapshot).length > 0 ? snapshot : undefined;
}

/**
 * Выполнить генерацию правила по ast узлу.
 * @param {Object} node Узел ast дерева.
 * @returns {string}
 */
function generateNode(node) {
   if (node.type === 'Atrule') {
      const semicolon = node.block ? '' : ';';

      switch (node.name) {
         case 'media':
         case 'supports':
         case 'layer':
         case 'namespace':
            return `@${node.name} ${generate(node.prelude)}${semicolon}`;
         default:
            // property, page
            return generate(node);
      }
   }

   return generate(node);
}

/**
 * Проверить, нужно ли узел ast дерева обработать как лист.
 * @param {Object} node Узел ast дерева.
 * @returns {boolean}
 */
function isLeaf(node) {
   return (
      node.type === 'Rule' ||
      (node.type === 'Atrule' && node.name === 'namespace') ||
      (node.type === 'Atrule' && node.name === 'keyframes') ||
      (node.type === 'Atrule' && node.name === 'property') ||
      (node.type === 'Atrule' && node.name === 'charset') ||
      (node.type === 'Atrule' && node.name === 'page') ||
      (node.type === 'Atrule' && node.name === 'layer' && !node.block)
   );
}

/**
 * Собрать все имена селекторов из узла.
 * @param {Object} ast Узел ast дерева.
 * @return {string[]}
 */
function collectClassSelectors(ast) {
   const classSelectors = [];

   if (ast.type === 'Rule') {
      walk(ast, {
         enter(node) {
            if (node.type === 'ClassSelector') {
               classSelectors.push(node.name.replace(/\\/gi, ''));
            }
         }
      });
   }

   return classSelectors;
}

/**
 * Выполнить генерацию листа.
 * @param {Object} node Узел ast дерева.
 * @returns {string[]} Возвращает массив значений [rule, value, line].
 */
function generateLeaf(node) {
   const line = generateNode(node);

   if (node.type === 'Rule') {
      const rule = generate(node.prelude);
      const value = generate(node.block);

      return [rule, value, line];
   }

   return [line, undefined, line];
}

/**
 * Клонировать узел css снимка.
 * @param {object} node Узел css снимка.
 * @returns {object} Клонированный узел css снимка.
 */
function cloneSnapshotNode(node) {
   const result = { };

   for (const key in node) {
      if (node.hasOwnProperty(key)) {
         const value = node[key];

         if (typeof value === 'string') {
            result[key] = value;

            continue;
         }

         result[key] = cloneSnapshotNode(value);
      }
   }

   return result;
}

/**
 * Объединить два css снимка.
 * @param {object} prev Первый css снимок, взятый из кеша.
 * @param {object} next Второй css снимок, содержащий новые данные.
 * @returns {object} Обновленный css снимок.
 */
function uniteSnapshots(prev, next) {
   const union = cloneSnapshotNode(prev);

   for (const key in next) {
      if (next.hasOwnProperty(key)) {
         const value = next[key];

         if (typeof value === 'string') {
            // Тут может быть перезапись. Берем актуальное из next.
            union[key] = value;

            continue;
         }

         if (typeof union[key] === 'undefined') {
            // Узел, которого нет в prev. Пишем
            union[key] = cloneSnapshotNode(value);

            continue;
         }

         // Такой узел есть и в prev, и в next. Необходимо объединить
         union[key] = uniteSnapshots(union[key], value);
      }
   }

   return union;
}

/**
 * Выполнить генерацию css текста по css снимку.
 * @param {object} snapshot Css снимок, по которому необходимо построить текст.
 * @param {TextBuilder} textBuilder Построитель текста.
 */
function createTextFromSnapshot(snapshot, textBuilder) {
   for (const key in snapshot) {
      if (snapshot.hasOwnProperty(key)) {
         const value = snapshot[key];

         if (typeof value === 'object') {
            textBuilder.enter(key);

            createTextFromSnapshot(value, textBuilder);

            textBuilder.leave();

            continue;
         }

         textBuilder.append(`${key}${value}`);
      }
   }
}

/**
 * Получить список селекторов классов из css снимка.
 * @param {object} snapshot Css снимок
 * @returns {string[]} Коллекция селекторов классов.
 */
function getClassSelectors(snapshot) {
   const classSelectors = [];

   for (const key in snapshot) {
      if (snapshot.hasOwnProperty(key)) {
         const value = snapshot[key];

         if (typeof value === 'object') {
            classSelectors.push(...getClassSelectors(value));

            continue;
         }

         const classSelector = key
            .replace(/^\./gi, '')
            .replace(/\\/gi, '');

         classSelectors.push(classSelector);
      }
   }

   return classSelectors;
}

/**
 * Класс, предоставляющий способ обхода структуры.
 */
class TreeCursor {
   /**
    * Инициализировать новый инстанс курсора.
    * @param {Object} initial Корневой узел древовидной структуры.
    */
   constructor(initial) {
      this.stack = [initial];
   }

   /**
    * Получить текущий просматриваемый узел.
    * @returns {Object}
    */
   get value() {
      return this.stack[this.stack.length - 1];
   }

   /**
    * Добавить лист.
    * @param {string} rule Лист, представляющий css-правило.
    * @param {string|undefined} value Определение css-правила.
    */
   add(rule, value) {
      this.value[rule] = typeof value === 'undefined' ? null : value;
   }

   /**
    * Проверить, имеется ли в текущем просматриваемом узле css-правило.
    * @param {string} rule Css-правило.
    * @returns {boolean}
    */
   has(rule) {
      return this.value.hasOwnProperty(rule);
   }

   /**
    * Войти в Atrule узел.
    * @param {string} atrule Css atrule представление.
    */
   enter(atrule) {
      if (!this.value.hasOwnProperty(atrule)) {
         this.value[atrule] = { };
      }

      this.stack.push(this.value[atrule]);
   }

   /**
    * Выйти из Atrule узла.
    */
   leave() {
      this.stack.pop();
   }
}

/**
 * Класс, предоставляющий методы построения css текста, игнорируя пустые Atrule узлы.
 */
class TextBuilder {
   /**
    * Инициализировать новый инстанс.
    * @param {boolean} prettyOutput Форматировать текст отступами.
    * @param {string} ident Размер отступов.
    */
   constructor(prettyOutput, ident = '  ') {
      this.buffer = [];
      this.line = '';
      this.offset = 0;
      this.prettyOutput = prettyOutput;
      this.ident = ident;
   }

   /**
    * Получить построенный текст.
    * @returns {string}
    */
   get text() {
      if (this.buffer.length > 0) {
         throw new Error('buffer was not properly flushed');
      }

      return this.line;
   }

   /**
    * Добавить css-правило.
    * @param {string} rule
    */
   append(rule) {
      this.line += this.format(rule);
   }

   /**
    * Войти в Atrule узел.
    * @param {string} atrule Atrule правило.
    */
   enter(atrule) {
      this.buffer.push(this.line);
      this.buffer.push(this.format(`${atrule}`));
      this.offset++;
      this.line = '';
   }

   /**
    * Выйти из Atrule узла.
    */
   leave() {
      this.offset--;

      if (this.line.length === 0) {
         this.buffer.pop();
         this.line = this.buffer.pop();

         return;
      }

      const t2 = this.buffer.pop();
      const t1 = this.buffer.pop();

      this.line = `${t1}${t2}{${this.line}${this.format('}')}`;
   }

   /**
    * Получить форматированную с отступами строку.
    * @param {string} string Строка с кодом.
    * @returns {string}
    */
   format(string) {
      if (!this.prettyOutput) {
         return `${string}`;
      }

      return `${this.ident.repeat(this.offset)}${string}\n`;
   }
}

/**
 * Класс, предоставляющий методы удаления повторяющихся css-классов по предоставленному снимку.
 */
class TailwindTreeShaker {
   /**
    * Инициализировать новый инстанс.
    * @param {Object} snapshot Снимок эталона, от повторения которых необходимо произвести очистку.
    * @param {boolean} prettyOutput Форматировать текст отступами.
    */
   constructor(snapshot = { }, prettyOutput = false) {
      this.snapshot = snapshot;
      this.prettyOutput = prettyOutput;

      this.classSelectors = [];
      this.root = { };
      this.text = '';
   }

   /**
    * Очистить содержимое css файла от повторяющихся классов.
    * @param {string} source Текст css файла.
    */
   shake(source) {
      const ast = parse(source);

      const cursor = new TreeCursor(this.root);
      const snapshotCursor = new TreeCursor(this.snapshot);
      const textBuilder = new TextBuilder(this.prettyOutput);
      const classSelectors = new Set();

      walk(ast, {
         enter(node) {
            if (isLeaf(node)) {
               const [rule, value, line] = generateLeaf(node);

               if (snapshotCursor.has(rule)) {
                  return this.skip;
               }

               collectClassSelectors(node)
                  .forEach(classSelector => classSelectors.add(classSelector));

               textBuilder.append(line);

               cursor.add(rule, value);

               return this.skip;
            }

            if (node.type === 'Atrule') {
               const atrule = `@${node.name} ${generateNode(node.prelude)}`;

               snapshotCursor.enter(atrule);
               cursor.enter(atrule);

               textBuilder.enter(atrule);
            }
         },
         leave(node) {
            if (isLeaf(node)) {
               return;
            }

            if (node.type === 'Atrule') {
               snapshotCursor.leave();
               cursor.leave();

               textBuilder.leave();
            }
         }
      });

      this.classSelectors = Array.from(classSelectors);
      this.root = removeEmpty(this.root);
      this.text = textBuilder.text;
   }

   /**
    * Дополнить снимок содержимым css файла.
    * @param {object} snapshot Css снимок.
    * @param {string} source Текст css файла.
    */
   update(snapshot, source) {
      this.shake(source);
      this.merge(snapshot);
   }

   /**
    * Объеденить текущее представление с css снимком.
    * @param {object} snapshot Css снимок.
    */
   merge(snapshot) {
      this.root = uniteSnapshots(snapshot, this.root);

      const textBuilder = new TextBuilder(this.prettyOutput);
      createTextFromSnapshot(this.root, textBuilder);
      this.text = textBuilder.text;

      this.classSelectors = Array.from(new Set(getClassSelectors(this.root)));
   }
}

module.exports = TailwindTreeShaker;
