/**
 * В данном модуле реализован метод нормализации зависимостей
 * скомпилированного JS кода (разрешение относительных путей) в формате UMD.
 */

'use strict';

const { Syntax } = require('espree');
const { traverse } = require('estraverse');
const { path } = require('../platform/path');

const {
   wrapWithQuotes,
   createFactoryArgument
} = require('./common');

const IN_MODULE_LOADER_SCHEMA = [
   Syntax.Program,
   Syntax.ExpressionStatement,
   Syntax.CallExpression,
   Syntax.FunctionExpression,
   Syntax.BlockStatement,
   Syntax.IfStatement
];

function isInModuleLoaderFunction(stack) {
   return IN_MODULE_LOADER_SCHEMA.every((type, index) => type === stack[index]);
}

const IN_MODULE_SCHEMA = [
   Syntax.Program,
   Syntax.ExpressionStatement,
   Syntax.CallExpression,
   Syntax.FunctionExpression,
   Syntax.BlockStatement
];

function isInModuleBody(stack) {
   return IN_MODULE_SCHEMA.every((type, index) => type === stack[index]);
}

function isCallExpression(node, calleeName) {
   return node.type === Syntax.CallExpression &&
      node.callee.type === Syntax.Identifier &&
      node.callee.name === calleeName;
}

function resolveModuleId(id, filePath) {
   if (id.startsWith('./') || id.startsWith('../')) {
      return path.join(path.dirname(filePath), id);
   }

   return id;
}

function getModuleSubstitutions(ast, filePath) {
   const moduleSubstitutions = [];

   let isFactoryProcessed = false;

   const stack = [];
   traverse(ast, {
      enter(node) {
         stack.push(node.type);

         if (isInModuleLoaderFunction(stack) && !isFactoryProcessed) {
            // A place where we call factory function.
            // Here we must replace require with global.requirejs
            if (isCallExpression(node, 'factory')) {
               for (const arg of node.arguments) {
                  if (arg.type !== Syntax.Identifier) {
                     return;
                  }

                  moduleSubstitutions.push({
                     range: arg.range,
                     value: createFactoryArgument(arg.name, v => v)
                  });
               }

               isFactoryProcessed = true;
               return;
            }
         }

         if (isInModuleBody(stack)) {
            if (isCallExpression(node, 'require') && node.arguments.length > 0) {
               // A place where we might require module with its relative path.
               // TODO: Typescript compiler resolves importing module paths for only define function call.
               const moduleIdNode = node.arguments[0];

               if (moduleIdNode.type === Syntax.Literal) {
                  const newValue = resolveModuleId(moduleIdNode.value, filePath);

                  // Modify ast
                  moduleIdNode.value = newValue;

                  moduleSubstitutions.push({
                     range: moduleIdNode.range,
                     value: wrapWithQuotes(newValue)
                  });
               }
            }
         }
      },
      leave() {
         stack.pop();
      }
   });

   return moduleSubstitutions;
}

function modifyDependencies(ast, sourceCode, filePath) {
   const moduleSubstitutions = getModuleSubstitutions(ast, filePath);

   if (!sourceCode || moduleSubstitutions.length === 0) {
      return {
         text: sourceCode
      };
   }

   // Modify original source text from the end
   moduleSubstitutions.sort((a, b) => a.range[0] - b.range[0]);

   let resultSource = sourceCode;
   for (let i = moduleSubstitutions.length - 1; i >= 0; --i) {
      const task = moduleSubstitutions[i];

      resultSource = resultSource.slice(0, task.range[0]) + task.value + resultSource.slice(task.range[1]);
   }

   return {
      text: resultSource
   };
}

module.exports = modifyDependencies;
