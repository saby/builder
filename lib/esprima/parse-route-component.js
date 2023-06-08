'use strict';

const { Syntax } = require('esprima-next');
const { traverse } = require('estraverse');

/**
 * Проверяет, соответствует ли левый операнд у "=" конструкции вида module.exports
 */
function isModuleExports(node) {
   return (
      node.type === Syntax.MemberExpression &&
      node.object &&
      node.object.name === 'module' &&
      node.property &&
      node.property.name === 'exports'
   );
}

/**
 * Анализирует объект с урлами роутингов.
 * Допустимы 2 вида:
 * {
 *    "/blah1.html": function() {...},
 *    ...
 * }
 *
 * {
 *    "/blah2.html": "js!SBIS3.Blah"
 * }
 *
 * Для первого варианта не заполняем поля isMasterPage и controller.
 * Для второго - заполним controller соответствующим роутингу модулем
 * */
function observeProperty(prop, routes, errors) {
   const isValidRoute = (
      prop.type === Syntax.Property &&
      prop.key &&
      prop.value &&
      prop.key.type === Syntax.Literal &&
      prop.key.value.indexOf &&
      prop.key.value.indexOf('/') === 0
   );

   if (isValidRoute) {
      if (prop.value.type !== Syntax.Literal) {
         routes[prop.key.value] = {
            controller: null
         };
      } else {
         routes[prop.key.value] = {
            controller: prop.value.value.toString()
         };
      }

      return true;
   }

   if (prop && prop.key && prop.key.hasOwnProperty('value')) {
      errors.push(prop.key.value.toString());
   }

   return false;
}

function getReturnValuesOfFunction(body) {
   const returnedObjects = [];
   let innerFunctionDeclaration = 0;
   let innerFunctionExpression = 0;

   traverse(body.right.body, {
      enter(node) {
         if (node.type === Syntax.FunctionDeclaration) {
            innerFunctionDeclaration++;
         }

         if (node.type === Syntax.FunctionExpression) {
            innerFunctionExpression++;
         }

         const hasReturnObject = (
            node.type === Syntax.ReturnStatement &&
            innerFunctionDeclaration === 0 &&
            innerFunctionExpression === 0 &&
            node.argument &&
            node.argument.type === Syntax.ObjectExpression &&
            node.argument.properties
         );

         if (hasReturnObject) {
            returnedObjects.push(node.argument.properties);
         }
      },
      leave(node) {
         if (node.type === Syntax.FunctionDeclaration) {
            innerFunctionDeclaration--;
         }

         if (node.type === Syntax.FunctionExpression) {
            innerFunctionExpression--;
         }
      }
   });

   return returnedObjects;
}

/**
 * Допустимый тип right - объект или синхронная функция.
 */
function parseAssignment(assignmentNode, routes) {
   const errors = [];
   if (!isModuleExports(assignmentNode.left)) {
      return;
   }

   if (assignmentNode.right.type === Syntax.ObjectExpression) {
      assignmentNode.right.properties.forEach((prop) => {
         observeProperty(prop, routes, errors);
      });
   } else if (assignmentNode.right.type === Syntax.FunctionExpression) {
      const returnObjectsFilter = array => (
         Array.isArray(array)
            ? array.every(prop => observeProperty(prop, routes, errors))
            : false
      );

      const returnedObjects = getReturnValuesOfFunction(assignmentNode).filter(returnObjectsFilter);

      if (!returnedObjects.length) {
         let details = '';
         if (errors.length) {
            details = `Список некорректных роутингов: ${errors.join(', ')}`;
         }

         throw new Error(
            'Некоторые роутинги не являются корректными. ' +
            `Роутинг должен задаваться строкой, которая начинается с символа "/". ${details}`
         );
      }
   } else {
      throw new Error('Экспортируется не объект и не функция');
   }
}

function parseRoutes(ast) {
   const routes = {};

   traverse(ast, {
      enter(node) {
         // Ищем оператор =
         if (node.type === Syntax.AssignmentExpression && node.operator === '=') {
            parseAssignment(node, routes);
         }
      }
   });

   return routes;
}

module.exports = parseRoutes;
