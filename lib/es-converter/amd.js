/**
 * @author Krylov M.A.
 */

'use strict';

const { Syntax } = require('esprima-next');
const common = require('./common');
const parseDefineArguments = require('./define-parser');

function getDepsSequence(value) {
   if (typeof value === 'string') {
      return value;
   }

   if (Array.isArray(value)) {
      const elements = value.map(v => `"${v}"`).join(', ');
      return `[${elements}]`;
   }

   return '';
}

function formatDefine(moduleName, dependencies, factory) {
   const args = [];

   if (typeof moduleName === 'string') {
      args.push(`"${moduleName}"`);
   }

   const stringDependencies = getDepsSequence(dependencies);
   if (stringDependencies) {
      args.push(stringDependencies);
   }

   args.push(factory);

   return `define(${args.join(', ')})`;
}

function format(components) {
   const defineStatement = formatDefine(
      components.moduleName,
      components.dependencies || components.dependenciesCall,
      components.factory
   );

   return `${defineStatement};`;
}

const ScriptStructure = {
   type: Syntax.Program,
   props: ['body'],
   body: [{
      type: Syntax.ExpressionStatement,
      props: ['expression'],
      parse(node, storage) {
         storage.root = node;
         storage.originModule = 'amd';
      },
      expression: {
         type: Syntax.CallExpression,
         parse(node, storage) {
            parseDefineArguments(node.arguments, storage);
         },
         props: ['callee'],
         callee: {
            type: Syntax.Identifier,
            test(node) {
               return node.name === 'define';
            }
         },
         test(node) {
            const lastArgument = node.arguments[node.arguments.length - 1];

            return (
               node.arguments.length > 0 &&
               (
                  lastArgument.type === Syntax.FunctionExpression ||
                  lastArgument.type === Syntax.CallExpression ||
                  lastArgument.type === Syntax.ArrowFunctionExpression
               )
            );
         }
      }
   }]
};

/**
 * Parse if program matches following structure:
 *    define(..., function() { ... });
 * @param {Program} program Parsed source file.
 */
function parse(program) {
   return common.parse(program, ScriptStructure);
}

module.exports = {
   parse,
   format,
   formatDefine
};
