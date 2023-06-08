'use strict';

const { Syntax } = require('espree');
const { traverse } = require('estraverse'),
   defaultCatchAst = require('../../resources/error-callback-ast'),
   escodegen = require('../third-party/escodegen');

/**
 * new Promise(...).then() in AST-tree matches
 * ExpressionStatement with expression of CallExpression type.
 * Only in this case we can add custom errors catcher.
 * @param {Object} node - current AST-tree node
 * @returns {boolean|*}
 */
function isExpressionWithCall(node) {
   return (
      node.type === Syntax.ExpressionStatement &&
      node.expression && node.expression.type === Syntax.CallExpression
   );
}

/**
 * Recursively searches matching Promise with require in current
 * AST-tree.
 * @param {} promiseCallbacks
 * @param node
 * @returns {null|boolean|boolean|(null|boolean)}
 */
function recursiveSearchPromise(promiseCallbacks, node) {
   const callExprNode = node.callee;

   if (callExprNode.type !== Syntax.MemberExpression) {
      return null;
   }

   promiseCallbacks.add(callExprNode.property.name);

   const memberExprNode = callExprNode.object;
   switch (memberExprNode.type) {
      case Syntax.NewExpression:
         if (memberExprNode.callee && memberExprNode.callee.name === 'Promise') {
            let isPromiseWithRequire = false;

            traverse(memberExprNode, {
               enter(currentNode) {
                  if (
                     currentNode.expression && currentNode.expression.type === Syntax.CallExpression &&
                     currentNode.expression.callee && currentNode.expression.callee.name === 'require'
                  ) {
                     isPromiseWithRequire = true;
                     this.break();
                  }
               }
            });

            return isPromiseWithRequire;
         }

         return false;

      case Syntax.CallExpression:
         return recursiveSearchPromise(promiseCallbacks, memberExprNode);

      default:
         return null;
   }
}

/**
 * Walk through ast-tree by current promise tree path
 * and get current promise parent node
 * @param ast
 * @param treePath
 * @returns {{parent: *, lastProperty: *}}
 */
function getParentNodeByTreePath(ast, treePath) {
   let currentNode = ast;
   for (let i = 0; i < treePath.length - 1; i++) {
      currentNode = currentNode[treePath[i]];
   }

   return {
      parent: currentNode,
      lastProperty: treePath[treePath.length - 1]
   };
}

function modifyPromiseCatch(ast) {
   const nodesToBeReplaced = [];

   traverse(ast, {
      enter(node) {
         /**
          * If we have found promise with require and without callback catching errors,
          * add our callback and rewrite current module content.
          */
         if (isExpressionWithCall(node)) {
            const expressionCallback = new Set();
            const searchResult = recursiveSearchPromise(expressionCallback, node.expression);

            if (searchResult && !expressionCallback.has('catch')) {
               const resultedAst = JSON.parse(JSON.stringify(defaultCatchAst));

               resultedAst.callee.object = node.expression;
               nodesToBeReplaced.push({
                  treePath: this.path(),
                  resultedAst
               });
            }
         }
      }
   });

   if (nodesToBeReplaced.length === 0) {
      return undefined;
   }

   nodesToBeReplaced.reverse().forEach((node) => {
      const nodePath = node.treePath;
      const parentsPromises = nodesToBeReplaced.filter((testingNode) => {
         const testingNodePath = testingNode.treePath;
         return nodePath.toString().startsWith(testingNodePath.toString()) &&
            nodePath.length > testingNodePath.length;
      });

      // make sure parent promises will get actual code for nested promises
      if (parentsPromises.length > 0) {
         parentsPromises.forEach((currentParentPromise) => {
            const relativeTreePath = nodePath.slice(
               currentParentPromise.treePath.length + 1,
               nodePath.length
            );
            const { parent, lastProperty } = getParentNodeByTreePath(
               currentParentPromise.resultedAst.callee.object,
               relativeTreePath
            );

            parent[lastProperty] = node.resultedAst;
         });
      } else {
         const { parent, lastProperty } = getParentNodeByTreePath(ast, nodePath);
         parent[lastProperty] = node.resultedAst;
      }
   });

   return escodegen.generate(ast);
}

module.exports = modifyPromiseCatch;
