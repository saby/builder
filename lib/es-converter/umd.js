/**
 * @author Krylov M.A.
 */

'use strict';

const { Syntax } = require('espree');
const common = require('./common');
const parseDefineArguments = require('./define-parser');
const amd = require('./amd');

function getIdentSequence(value) {
   if (typeof value === 'string') {
      return value;
   }

   if (Array.isArray(value) && value.length > 0) {
      return value.join(',');
   }

   return '';
}

const wrap = (factoryArguments, defineStatement, factory) => (`(function (factory) {
   if (typeof module === "object" && typeof module.exports === "object") {
      var v = factory(${factoryArguments});
      if (v !== undefined) module.exports = v;
   }
   else if (typeof define === "function" && define.amd) {
      ${defineStatement};
   }
})(${factory});`);

function format(components) {
   const defineStatement = amd.formatDefine(
      components.moduleName,
      components.dependencies,
      'factory'
   );
   const factoryArguments = getIdentSequence(components.factoryArguments);

   return wrap(
      factoryArguments,
      defineStatement,
      components.factory
   );
}

const ScriptStructure = {
   type: Syntax.Program,
   props: ['body'],
   body: [{
      type: Syntax.ExpressionStatement,
      props: ['expression'],
      parse(node, storage) {
         storage.root = node;
         storage.originModule = 'umd';
      },
      expression: {
         type: Syntax.CallExpression,
         props: ['callee', 'arguments'],
         callee: {
            type: Syntax.FunctionExpression,
            props: ['params', 'body'],
            params: [{
               type: Syntax.Identifier,
               test(node) {
                  return node.name === 'factory';
               }
            }],
            body: {
               type: Syntax.BlockStatement,
               props: ['body'],
               body: [{
                  type: Syntax.IfStatement,
                  props: ['consequent', 'alternate'],
                  consequent: {
                     type: Syntax.BlockStatement,
                     props: ['body'],
                     body: [{
                        type: Syntax.VariableDeclaration,
                        props: ['declarations'],
                        test(node) {
                           return node.kind === 'var';
                        },
                        declarations: [{
                           type: Syntax.VariableDeclarator,
                           test(node) {
                              return (
                                 node.init.type === Syntax.CallExpression &&
                                 node.init.callee.type === Syntax.Identifier &&
                                 node.init.callee.name === 'factory' &&
                                 node.init.arguments.every(v => v.type === Syntax.Identifier)
                              );
                           },
                           parse(node, storage) {
                              storage.factoryArguments = node.init.arguments.map(v => v.name);
                           }
                        }]
                     }]
                  },
                  alternate: {
                     type: Syntax.IfStatement,
                     props: ['consequent'],
                     consequent: {
                        type: Syntax.BlockStatement,
                        props: ['body'],
                        body: [{
                           type: Syntax.ExpressionStatement,
                           props: ['expression'],
                           expression: {
                              type: Syntax.CallExpression,
                              props: ['callee'],
                              parse(node, storage) {
                                 parseDefineArguments(node.arguments, storage, true);
                              },
                              callee: {
                                 type: Syntax.Identifier,
                                 test(node) {
                                    return node.name === 'define';
                                 }
                              }
                           }
                        }]
                     }
                  }
               }]
            }
         },
         arguments: [{
            parse(node, storage) {
               storage.factory = node;
            },
            type: [Syntax.FunctionExpression, Syntax.ArrowFunctionExpression]
         }]
      }
   }]
};

/**
 * Parse if program matches following structure:
 *    (function (factory) {
 *       ...
 *       define([...],factory);
 *       ...
 *    })(function (...) {
 *       ...
 *    });
 * @param {Program} program Parsed source file.
 */
function parse(program) {
   return common.parse(program, ScriptStructure);
}

module.exports = {
   parse,
   format
};
