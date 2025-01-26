/**
 * Модуль, предоставляющий функционал для модификации js файла:
 * Если файл содержит обнаруженные tailwind классы, то вставляется зависимость
 * от сгенерированного помодульного файла tailwind.css.
 * @author Krylov M.A.
 */
'use strict';

const { Syntax } = require('espree');
const { traverse } = require('estraverse');

const { parseCode } = require('../espree/common');
const parseDefineArguments = require('../es-converter/define-parser');

function containsTailwindClasses(program, tailwindInfo) {
   let result = false;

   if (!tailwindInfo) {
      return result;
   }

   traverse(program, {
      enter(node) {
         if (node.type !== Syntax.Literal) {
            return;
         }

         if (typeof node.value !== 'string') {
            return;
         }

         if (tailwindInfo.selectors.some(selector => node.value.includes(selector))) {
            result = true;

            this.break();
         }
      }
   });

   return result;
}

function findDefineNode(program) {
   let defineNode;

   traverse(program, {
      enter(node, parent) {
         if (parent && parent.type === Syntax.CallExpression && node.type === Syntax.Identifier && node.name === 'define') {
            defineNode = parent;
         }
      }
   });

   return defineNode;
}

function modify(sourceCode, tailwindInfo, ESVersion, dependenciesList) {
   const program = parseCode(sourceCode, {
      comment: true,
      loc: true,
      ecmaVersion: ESVersion
   });

   if (!containsTailwindClasses(program, tailwindInfo)) {
      return sourceCode;
   }

   const defineNode = findDefineNode(program);
   if (!defineNode) {
      return sourceCode;
   }

   const storage = { };
   parseDefineArguments(defineNode.arguments, storage, true);

   if (storage.dependenciesCallback) {
      // Такие кейсы не обрабатываем.
      // Вместо массива с завимостями здесь функция.
      return sourceCode;
   }

   if (Array.isArray(dependenciesList)) {
      if (dependenciesList.indexOf(tailwindInfo.dependency) === -1) {
         dependenciesList.push(tailwindInfo.dependency);
      }
   }

   if (storage.dependenciesNode) {
      // Зависимости уже есть. Добавим нужную в конец.
      const index = storage.dependenciesNode.end - 1;
      const comma = storage.dependencies.length > 0 ? ', ' : '';
      const injection = `${comma}"${tailwindInfo.dependency}"`;

      return sourceCode.slice(0, index) + injection + sourceCode.slice(index);
   }

   // Зависимостей нет. Вставим
   const factoryNode = defineNode.arguments[defineNode.arguments.length - 1];
   const index = factoryNode.start;
   const injection = `["${tailwindInfo.dependency}"], `;

   return sourceCode.slice(0, index) + injection + sourceCode.slice(index);
}

module.exports = modify;
