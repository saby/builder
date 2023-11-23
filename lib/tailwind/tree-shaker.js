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
   }

   /**
    * Очистить содержимое css файла от повторяющихся классов.
    * @param {string} source Текст css файла.
    */
   shake(source) {
      const ast = parse(source);

      const root = { };
      const textBuilder = new TextBuilder(this.prettyOutput);

      const cursor = new TreeCursor(root);
      const snapshotCursor = new TreeCursor(this.snapshot);

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
      this.root = removeEmpty(root);
      this.text = textBuilder.text;
   }
}

module.exports = TailwindTreeShaker;
